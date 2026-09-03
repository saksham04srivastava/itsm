"""SMTP transport for the portal.

Everything that touches the SMTP password or a socket lives here. Nothing in
this module is called from a request handler except send_test(), which the
settings screen invokes deliberately.
"""
import base64
import hashlib
import os
import re
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Read directly from the environment rather than importing from main, which
# imports this module. Keep the default in sync with main.py.
DEFAULT_SECRET = "change-me-in-production"
SECRET_KEY = os.environ.get("SECRET_KEY", DEFAULT_SECRET)

MAX_SUBJECT = 200
MAX_ERROR = 500
EMAIL_RE = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[A-Za-z]{2,}$")


def secret_key_is_weak() -> bool:
    """True when the SMTP password is encrypted with the shipped default key."""
    return SECRET_KEY == DEFAULT_SECRET


def _fernet() -> Fernet:
    # HKDF rather than a bare hash: it is the right primitive for deriving a
    # subkey, and the info label keeps this key distinct from JWT signing.
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"advantal-email-v1",
        info=b"smtp-password-encryption",
    ).derive(SECRET_KEY.encode())
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_password(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_password(ciphertext: str) -> Optional[str]:
    """Return the password, or None if it cannot be read.

    None means "SECRET_KEY changed since this was saved". Callers must treat
    that as not-configured rather than raising, or every send and every read of
    the settings screen turns into a 500 until someone notices.
    """
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        return None


def config_fingerprint(s) -> str:
    """Hash of the fields that decide where mail actually goes.

    Verification is bound to this, so changing the host or credentials after a
    successful test invalidates the verified state instead of carrying it over.
    """
    parts = [
        (s.host or "").strip().lower(),
        str(s.port or ""),
        (s.security or "").strip().lower(),
        "1" if s.verify_tls else "0",
        (s.username or "").strip(),
        (s.password_ciphertext or ""),
        (s.from_email or "").strip().lower(),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def valid_address(value: str) -> bool:
    if not value:
        return False
    value = value.strip()
    if len(value) > 254 or "\r" in value or "\n" in value:
        return False
    return bool(EMAIL_RE.match(value))


def header_safe(value: str, limit: int = MAX_SUBJECT) -> str:
    """Strip CR/LF and truncate before a value enters a mail header.

    Ticket titles and uploaded filenames reach Subject lines and are entirely
    user-controlled, so this is a header-injection control, not tidying.
    """
    clean = (value or "").replace("\r", " ").replace("\n", " ").strip()
    clean = re.sub(r"\s+", " ", clean)
    return clean[:limit]


def scrub(text: str, secret: Optional[str]) -> str:
    """Remove the SMTP password from anything about to be stored or returned."""
    out = (text or "")[:MAX_ERROR]
    if secret:
        out = out.replace(secret, "***")
    return out


class PermanentSendError(Exception):
    """The message will never be accepted; do not retry."""


class TransientSendError(Exception):
    """A temporary condition; retry with backoff."""


def classify(exc: Exception) -> Exception:
    """Map an smtplib exception onto retry semantics."""
    if isinstance(exc, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused,
                        smtplib.SMTPNotSupportedError)):
        return PermanentSendError(str(exc))
    if isinstance(exc, smtplib.SMTPResponseException):
        code = getattr(exc, "smtp_code", 0) or 0
        if 500 <= code < 600:
            return PermanentSendError(f"{code} {getattr(exc, 'smtp_error', b'')!r}")
        return TransientSendError(f"{code} {getattr(exc, 'smtp_error', b'')!r}")
    if isinstance(exc, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError,
                        socket.timeout, ssl.SSLError, OSError)):
        return TransientSendError(str(exc))
    return TransientSendError(str(exc))


def connect(settings) -> smtplib.SMTP:
    """Open an authenticated SMTP connection from a settings row.

    Raises PermanentSendError / TransientSendError, never a raw smtplib error.
    """
    password = decrypt_password(settings.password_ciphertext or "")
    if password is None:
        raise PermanentSendError(
            "Stored SMTP password cannot be decrypted (SECRET_KEY changed). Re-enter it."
        )

    host = (settings.host or "").strip()
    if not host:
        raise PermanentSendError("No SMTP host configured")
    port = int(settings.port or 0) or 587
    timeout = max(5, min(int(settings.timeout_seconds or 20), 60))
    security = (settings.security or "starttls").lower()

    context = ssl.create_default_context()
    if not settings.verify_tls:
        # Deliberate: an internal bank relay commonly uses a private CA. The UI
        # marks this as reducing security.
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    try:
        if security == "ssl":
            client = smtplib.SMTP_SSL(host, port, timeout=timeout, context=context)
        else:
            client = smtplib.SMTP(host, port, timeout=timeout)
            client.ehlo()
            if security == "starttls":
                client.starttls(context=context)
                client.ehlo()

        if (settings.username or "").strip():
            client.login(settings.username.strip(), password or "")
        return client
    except Exception as exc:  # noqa: BLE001 - re-raised as a classified error
        raise classify(exc) from exc


def build_message(settings, to_email: str, to_name: str, subject: str,
                  text_body: str, html_body: str,
                  ticket_id: str = "", event_type: str = "") -> EmailMessage:
    """Compose one message for exactly one recipient.

    Never sets Cc or Bcc: customer recipients and SPOC recipients must not see
    each other's addresses, and one customer must never see another's.
    """
    msg = EmailMessage()
    from_email = (settings.from_email or "").strip()
    from_name = header_safe(settings.from_name or "Advantal Support", 80)

    msg["From"] = formataddr((from_name, from_email))
    msg["To"] = formataddr((header_safe(to_name, 80), to_email.strip()))
    msg["Subject"] = header_safe(subject, MAX_SUBJECT)
    if (settings.reply_to or "").strip():
        msg["Reply-To"] = settings.reply_to.strip()

    domain = from_email.split("@")[-1] if "@" in from_email else "advantal-support"
    msg["Message-ID"] = make_msgid(domain=domain)
    if ticket_id:
        # Synthetic thread root so every mail about a ticket groups into one
        # conversation in Outlook and Gmail.
        root = f"<ticket.{header_safe(ticket_id, 80)}@{domain}>"
        msg["References"] = root
        msg["In-Reply-To"] = root
    msg["Auto-Submitted"] = "auto-generated"
    msg["X-Auto-Response-Suppress"] = "All"
    if event_type:
        msg["X-Advantal-Event"] = header_safe(event_type, 60)

    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    return msg


def send_message(client: smtplib.SMTP, msg: EmailMessage) -> None:
    try:
        client.send_message(msg)
    except Exception as exc:  # noqa: BLE001 - re-raised as a classified error
        raise classify(exc) from exc


def send_one(settings, to_email: str, to_name: str, subject: str,
             text_body: str, html_body: str, ticket_id: str = "",
             event_type: str = "") -> None:
    """Open a connection, send a single message, close. Used by the test send."""
    client = connect(settings)
    try:
        send_message(client, build_message(settings, to_email, to_name, subject,
                                           text_body, html_body, ticket_id, event_type))
    finally:
        try:
            client.quit()
        except Exception:
            pass


def describe_error(exc: Exception) -> Tuple[str, bool]:
    """(message, permanent) for storing in the delivery log."""
    classified = exc if isinstance(exc, (PermanentSendError, TransientSendError)) else classify(exc)
    return str(classified)[:MAX_ERROR], isinstance(classified, PermanentSendError)
