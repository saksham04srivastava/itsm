"""Turns ticket activity into queued email.

notify() is called from request handlers. It must never raise and never touch
the caller's database session - a problem with mail configuration must not be
able to fail a ticket operation.
"""
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy import or_

from database import SessionLocal
from models import EMAIL_SETTINGS_ID, EmailOutbox, EmailSettings, Ticket, User
import email_templates as templates
from mailer import config_fingerprint, header_safe, valid_address

# The person who acts is normally not told about their own action. The one
# exception is raising a ticket, where an acknowledgement to the raiser is
# expected behaviour rather than noise.
INCLUDE_ACTOR = {"ticket_created"}


def get_or_create_settings(db) -> EmailSettings:
    """Fetch the singleton settings row, creating it on first use."""
    s = db.query(EmailSettings).filter(EmailSettings.id == EMAIL_SETTINGS_ID).first()
    if s:
        return s
    s = EmailSettings(id=EMAIL_SETTINGS_ID, events={})
    db.add(s)
    try:
        db.commit()
    except Exception:
        # Another worker or request inserted it first.
        db.rollback()
        s = db.query(EmailSettings).filter(EmailSettings.id == EMAIL_SETTINGS_ID).first()
    return s


def sending_allowed(s: Optional[EmailSettings]) -> bool:
    """Enabled, verified, and still pointing at the server that was verified."""
    if not s or not s.enabled or not s.verified_at:
        return False
    return bool(s.config_fingerprint) and s.config_fingerprint == config_fingerprint(s)


def snapshot_ticket(t: Ticket) -> Dict:
    """Copy everything the templates and recipient lookup need into a plain dict.

    Taking a snapshot means the caller can commit, refresh or delete the ticket
    afterwards without the notification losing access to its own data.
    """
    product = t.product
    company = t.company
    return {
        "ticket_id": t.id,
        "title": t.title or "",
        "description": t.description or "",
        "status": t.status or "",
        "priority": t.priority or "",
        "type": t.type or "",
        "progress": t.progress if t.progress is not None else 0,
        "due_date": t.due_date or "",
        "company_id": t.company_id,
        "company_name": (company.name if company else None) or t.customer or "",
        "product_id": t.product_id,
        "product_name": product.name if product else "",
        "escalation_user_ids": list(product.escalation_user_ids or []) if product else [],
        "assigned_to": t.assigned_to or "",
        "created_by": t.created_by or "",
    }


def _recipients(db, snap: Dict, actor_id: str, include_actor: bool) -> List[Dict]:
    """Active users of the ticket's customer plus the product's SPOCs."""
    clauses = []
    # Guard both: super admins have company_id = None, so an unguarded
    # comparison against None would mail every super admin on every event.
    if snap.get("company_id"):
        clauses.append(User.company_id == snap["company_id"])
    escalation_ids = snap.get("escalation_user_ids") or []
    if escalation_ids:
        clauses.append(User.id.in_(escalation_ids))
    if not clauses:
        return []

    rows = (db.query(User.id, User.name, User.email)
              .filter(User.active == True, or_(*clauses))  # noqa: E712
              .all())

    spoc_ids = set(escalation_ids)
    out, seen_ids, seen_emails = [], set(), set()
    for uid, name, email in rows:
        if uid in seen_ids:
            continue
        if uid == actor_id and not include_actor:
            continue
        addr = (email or "").strip()
        key = addr.lower()
        if key and key in seen_emails:
            continue
        seen_ids.add(uid)
        if key:
            seen_emails.add(key)
        out.append({
            "id": uid,
            "name": name or "",
            "email": addr,
            "audience": "spoc" if uid in spoc_ids else "customer",
        })
    return out


def notify(event: str, snap: Dict, actor: Optional[User] = None,
           extra: Optional[Dict] = None) -> None:
    """Queue one email per recipient for an event. Never raises."""
    try:
        db = SessionLocal()
        try:
            settings = get_or_create_settings(db)
            if not sending_allowed(settings):
                return
            if not (settings.events or {}).get(event):
                return

            actor_id = actor.id if actor else ""
            people = _recipients(db, snap, actor_id, event in INCLUDE_ACTOR)
            if not people:
                return

            assignee_name = ""
            if snap.get("assigned_to"):
                row = db.query(User.name).filter(User.id == snap["assigned_to"]).first()
                assignee_name = row[0] if row else ""

            base = dict(snap)
            base.update(extra or {})
            base["actor_name"] = (actor.name if actor else "") or "The portal"
            base["assignee_name"] = assignee_name
            base["portal_url"] = settings.portal_url or ""
            # Kept distinct from portal_url so deep links become a one-line
            # change once the SPA has routing.
            base["ticket_url"] = settings.portal_url or ""

            now = datetime.utcnow()
            for person in people:
                payload = dict(base)
                payload["audience"] = person["audience"]
                subject, _text, _html = templates.render(event, payload)

                invalid = not valid_address(person["email"])
                db.add(EmailOutbox(
                    id=f"em_{uuid.uuid4().hex}",
                    event_type=event,
                    ticket_id=snap.get("ticket_id") or None,
                    to_email=person["email"][:254],
                    to_name=person["name"][:120],
                    to_user_id=person["id"],
                    audience=person["audience"],
                    subject=header_safe(subject),
                    payload=payload,
                    template_version=templates.TEMPLATE_VERSION,
                    # Recorded rather than dropped: "why didn't this person get
                    # it" has to be answerable from the log.
                    status="cancelled" if invalid else "queued",
                    last_error="Invalid recipient address" if invalid else "",
                    attempts=0,
                    next_attempt_at=now,
                    actor_id=actor_id,
                    actor_name=base["actor_name"][:120],
                    created_at=now,
                ))
            db.commit()
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - notification must never break a request
        print(f"[notify] {event} for {snap.get('ticket_id')} failed to queue: {exc}")
