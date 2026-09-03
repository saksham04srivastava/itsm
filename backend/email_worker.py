"""Background worker that drains the email outbox.

Runs as a single daemon thread inside the API process. Claiming is done with
FOR UPDATE SKIP LOCKED, so if this ever moves to its own container - or the API
is scaled to more than one replica - no message is sent twice.
"""
import os
import random
import socket
import threading
import traceback
from datetime import datetime, timedelta

from sqlalchemy import text

from database import SessionLocal
from models import EmailOutbox
import email_templates as templates
import mailer
from notifications import get_or_create_settings, sending_allowed

POLL_SECONDS = 5
BATCH_SIZE = 20
LEASE_SECONDS = 300
EXPIRE_HOURS = 24
BACKOFF_BASE = 60
BACKOFF_CAP = 1800
AUTH_FAILURES_BEFORE_UNVERIFY = 3

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"

_stop = threading.Event()
_thread = None
_auth_failures = 0


def _backoff_seconds(attempts: int) -> int:
    delay = min(BACKOFF_BASE * (3 ** max(0, attempts - 1)), BACKOFF_CAP)
    return int(delay * random.uniform(0.8, 1.2))


def _reclaim_expired(db) -> None:
    """Return rows abandoned by a crashed worker to the queue."""
    db.execute(text("""
        UPDATE email_outbox
           SET status='queued', locked_at=NULL, locked_by=''
         WHERE status='sending'
           AND locked_at < (NOW() AT TIME ZONE 'UTC') - make_interval(secs => :lease)
    """), {"lease": LEASE_SECONDS})
    db.commit()


def _expire_stale(db) -> None:
    """Drop anything that has sat queued long enough to be meaningless."""
    db.execute(text("""
        UPDATE email_outbox
           SET status='cancelled', last_error='Expired before it could be sent'
         WHERE status='queued'
           AND created_at < (NOW() AT TIME ZONE 'UTC') - make_interval(hours => :hrs)
    """), {"hrs": EXPIRE_HOURS})
    db.commit()


def _claim(db, limit: int):
    """Atomically take up to `limit` due rows.

    attempts is incremented here rather than on failure, so a crash mid-send
    still burns an attempt and cannot loop forever.
    """
    rows = db.execute(text("""
        UPDATE email_outbox
           SET status='sending',
               locked_at=(NOW() AT TIME ZONE 'UTC'),
               locked_by=:worker,
               attempts=attempts+1
         WHERE id IN (
               SELECT id FROM email_outbox
                WHERE status='queued'
                  AND next_attempt_at <= (NOW() AT TIME ZONE 'UTC')
                ORDER BY next_attempt_at ASC, created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT :n)
        RETURNING id
    """), {"worker": WORKER_ID, "n": limit}).fetchall()
    db.commit()
    ids = [r[0] for r in rows]
    if not ids:
        return []
    return db.query(EmailOutbox).filter(EmailOutbox.id.in_(ids)).all()


def _release(db, item: EmailOutbox, error: str, max_attempts: int, permanent: bool) -> None:
    if permanent or item.attempts >= max_attempts:
        item.status = "failed"
    else:
        item.status = "queued"
        item.next_attempt_at = datetime.utcnow() + timedelta(seconds=_backoff_seconds(item.attempts))
    item.last_error = error
    item.locked_at = None
    item.locked_by = ""


def _run_cycle(db) -> int:
    global _auth_failures

    _reclaim_expired(db)
    _expire_stale(db)

    settings = get_or_create_settings(db)
    if not sending_allowed(settings):
        return 0

    batch = _claim(db, BATCH_SIZE)
    if not batch:
        return 0

    max_attempts = max(1, min(int(settings.max_attempts or 5), 10))
    password = mailer.decrypt_password(settings.password_ciphertext or "")

    try:
        client = mailer.connect(settings)
    except Exception as exc:  # noqa: BLE001
        message, permanent = mailer.describe_error(exc)
        message = mailer.scrub(message, password)
        if "auth" in message.lower() or "535" in message:
            _auth_failures += 1
            if _auth_failures >= AUTH_FAILURES_BEFORE_UNVERIFY:
                # Stop hammering a credential the server keeps rejecting.
                settings.verified_at = None
                print("[email-worker] repeated authentication failures; verification cleared")
        for item in batch:
            _release(db, item, message, max_attempts, permanent)
        db.commit()
        return 0

    _auth_failures = 0
    sent = 0
    try:
        for item in batch:
            try:
                subject, text_body, html_body = templates.render(item.event_type, item.payload or {})
                msg = mailer.build_message(
                    settings, item.to_email, item.to_name,
                    item.subject or subject, text_body, html_body,
                    ticket_id=item.ticket_id or "", event_type=item.event_type,
                )
                mailer.send_message(client, msg)
                item.status = "sent"
                item.sent_at = datetime.utcnow()
                item.last_error = ""
                item.locked_at = None
                item.locked_by = ""
                sent += 1
            except (mailer.TransientSendError, mailer.PermanentSendError) as exc:
                message, permanent = mailer.describe_error(exc)
                _release(db, item, mailer.scrub(message, password), max_attempts, permanent)
                if isinstance(exc, mailer.TransientSendError):
                    # The connection itself is suspect - stop using it and let
                    # the rest of the batch retry on the next cycle.
                    raise
            except Exception as exc:  # noqa: BLE001 - a bad payload must not stall the queue
                _release(db, item, mailer.scrub(f"Render/send error: {exc}", password),
                         max_attempts, True)
    except mailer.TransientSendError:
        for item in batch:
            if item.status == "sending":
                _release(db, item, "Connection lost mid-batch", max_attempts, False)
    finally:
        db.commit()
        try:
            client.quit()
        except Exception:
            pass
    return sent


def _loop() -> None:
    print(f"[email-worker] started as {WORKER_ID}")
    while not _stop.is_set():
        db = None
        try:
            db = SessionLocal()
            processed = _run_cycle(db)
        except Exception:  # noqa: BLE001 - the loop must never die
            processed = 0
            traceback.print_exc()
        finally:
            if db is not None:
                db.close()
        # Drain straight through while there is work; otherwise idle.
        if processed < BATCH_SIZE:
            _stop.wait(POLL_SECONDS)
    print("[email-worker] stopped")


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="email-outbox-worker", daemon=True)
    _thread.start()


def stop(timeout: float = 10) -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout)
