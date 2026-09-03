"""Email bodies for ticket activity.

string.Template plus html.escape - no jinja2, no new dependency. Every value
that reaches the HTML is escaped; every value that reaches a header is
CRLF-stripped by mailer.header_safe before use.
"""
from html import escape
from string import Template
from typing import Dict, List, Tuple

TEMPLATE_VERSION = "v1"

# Served to the frontend so the settings screen renders its own toggle list.
# Adding an event here is the only change needed for it to appear in the UI.
EVENT_TYPES: List[Dict[str, str]] = [
    {"key": "ticket_created", "label": "Ticket raised",
     "description": "A new ticket is created by a customer or an agent."},
    {"key": "ticket_updated", "label": "Status or progress changed",
     "description": "A ticket's status or completion percentage is updated."},
    {"key": "milestone_done", "label": "Milestone completed",
     "description": "A milestone on a ticket is marked as done."},
    {"key": "chat_message", "label": "Conversation update",
     "description": "Someone posts a message on a ticket."},
    {"key": "chat_attachment", "label": "File attached",
     "description": "A file is attached to a ticket conversation."},
    {"key": "signoff_uploaded", "label": "Signoff uploaded",
     "description": "A signoff document is uploaded against a ticket."},
    {"key": "ticket_deleted", "label": "Ticket deleted",
     "description": "A ticket is removed from the portal."},
]

EVENT_KEYS = [e["key"] for e in EVENT_TYPES]
EVENT_LABELS = {e["key"]: e["label"] for e in EVENT_TYPES}

NO_ATTACHMENT_NOTICE = (
    "This file is not attached to this email. Sign in to the Advantal Support "
    "portal to view or download it."
)

_HTML_SHELL = Template("""\
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>$subject</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #d8dee9;border-radius:10px;overflow:hidden;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
    <tr><td style="background:#155eef;padding:16px 24px;">
      <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:.2px;">Advantal Support</span>
      <span style="color:#c7d8ff;font-size:12px;"> &nbsp;|&nbsp; $event_label</span>
    </td></tr>
    <tr><td style="padding:24px;">
      <h1 style="margin:0 0 6px;font-size:19px;line-height:1.3;color:#152033;">$headline</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#62708a;">$intro</p>
      $body_block
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:18px 0;font-size:13px;">
        $detail_rows
      </table>
      $cta_block
    </td></tr>
    <tr><td style="background:#f8fafc;border-top:1px solid #e7ecf5;padding:14px 24px;font-size:11.5px;color:#8b98ad;line-height:1.6;">
      $footer_reason<br>
      Advantal Support &middot; automated notification, please do not reply to this address.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
""")

_ROW = Template("""\
<tr>
  <td style="padding:7px 12px 7px 0;color:#8b98ad;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eef2f7;width:150px;">$label</td>
  <td style="padding:7px 0;color:#152033;font-weight:600;vertical-align:top;border-bottom:1px solid #eef2f7;">$value</td>
</tr>""")

_NOTE = Template("""\
<div style="background:#f8fafc;border:1px solid #e7ecf5;border-left:3px solid #155eef;border-radius:6px;padding:12px 14px;margin:0 0 4px;font-size:13.5px;line-height:1.6;color:#33405a;">
$content
</div>""")

_CTA = Template("""\
<div style="margin:22px 0 4px;">
  <a href="$url" style="display:inline-block;background:#155eef;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:6px;">Open the portal</a>
  <div style="margin-top:8px;font-size:12px;color:#8b98ad;">Search for <strong>$ticket_id</strong> once signed in.</div>
</div>""")


def _rows(pairs: List[Tuple[str, str]]) -> str:
    return "".join(
        _ROW.safe_substitute(label=escape(str(label)), value=escape(str(value or "Not set")))
        for label, value in pairs if value not in (None, "")
    )


def _clip(value: str, limit: int) -> str:
    text = str(value or "")
    return text if len(text) <= limit else text[:limit] + "..."


def _html_para(value: str) -> str:
    """Escape, then turn newlines into <br> - escape first, always."""
    return escape(value or "").replace("\n", "<br>")


def _detail_pairs(p: Dict) -> List[Tuple[str, str]]:
    progress = p.get("progress")
    return [
        ("Ticket", p.get("ticket_id", "")),
        ("Title", p.get("title", "")),
        ("Customer", p.get("company_name", "")),
        ("Product", p.get("product_name", "")),
        ("Status", str(p.get("status", "")).replace("_", " ")),
        ("Priority", p.get("priority", "")),
        ("Progress", f"{progress}%" if progress not in (None, "") else ""),
        ("Due date", p.get("due_date", "")),
        ("Assigned to", p.get("assignee_name", "")),
    ]


def _subject_and_body(event: str, p: Dict) -> Tuple[str, str, str, str]:
    """Return (subject, headline, intro, html body block)."""
    tid = p.get("ticket_id", "")
    title = p.get("title", "")
    actor = p.get("actor_name", "Someone")

    if event == "ticket_created":
        block = ""
        if p.get("description"):
            block = _NOTE.safe_substitute(content=_html_para(_clip(p["description"], 1000)))
        return (f"[{tid}] New ticket raised: {title}",
                "A new ticket has been raised",
                f"{actor} raised this ticket. The support team has been notified.",
                block)

    if event == "ticket_updated":
        bits, changes = [], []
        if p.get("old_status") != p.get("new_status"):
            old = str(p.get("old_status", "")).replace("_", " ")
            new = str(p.get("new_status", "")).replace("_", " ")
            bits.append(f"Status {old} &rarr; {new}")
            changes.append(f"Status changed from {old} to {new}.")
        if p.get("old_progress") != p.get("new_progress"):
            bits.append(f"Progress {p.get('old_progress')}% &rarr; {p.get('new_progress')}%")
            changes.append(f"Progress moved from {p.get('old_progress')}% to {p.get('new_progress')}%.")
        subject_tail = ("Status updated to " + str(p.get("new_status", "")).replace("_", " ")
                        if p.get("old_status") != p.get("new_status")
                        else f"Progress updated to {p.get('new_progress')}%")
        return (f"[{tid}] {subject_tail}",
                "This ticket has been updated",
                f"{actor} updated the ticket.",
                _NOTE.safe_substitute(content="<br>".join(escape(c) for c in changes)))

    if event == "milestone_done":
        done, total = p.get("done_count", 0), p.get("total_count", 0)
        content = (f"<strong>{escape(str(p.get('milestone_title', '')))}</strong> is complete."
                   f"<br>{done} of {total} milestones done.")
        return (f"[{tid}] Milestone completed: {p.get('milestone_title', '')}",
                "A milestone has been completed",
                f"{actor} marked a milestone as done.",
                _NOTE.safe_substitute(content=content))

    if event == "chat_message":
        role = p.get("author_role", "")
        who = f"{actor}{' - ' + role if role else ''}"
        return (f"[{tid}] New message from {actor}",
                "New update on this ticket",
                f"{who} posted an update.",
                _NOTE.safe_substitute(content=_html_para(_clip(p.get("message_body", ""), 2000))))

    if event in ("chat_attachment", "signoff_uploaded"):
        is_signoff = event == "signoff_uploaded"
        filename = p.get("filename", "")
        caption = p.get("caption") or p.get("description") or ""
        size_kb = round((p.get("size") or 0) / 1024)
        content = (f"<strong>{escape(filename)}</strong>"
                   f"{f' &middot; {size_kb} KB' if size_kb else ''}")
        if caption:
            content += f"<br>{_html_para(_clip(caption, 600))}"
        content += (f"<br><span style=\"color:#8b98ad;font-size:12.5px;\">"
                    f"{escape(NO_ATTACHMENT_NOTICE)}</span>")
        label = "Signoff uploaded" if is_signoff else "File attached"
        return (f"[{tid}] {label}: {filename}",
                "Signoff document uploaded" if is_signoff else "A file was attached",
                f"{actor} uploaded {filename}.",
                _NOTE.safe_substitute(content=content))

    if event == "ticket_deleted":
        return (f"[{tid}] Ticket deleted by {actor}",
                "This ticket has been deleted",
                f"{actor} removed this ticket from the portal. Its final details are below.",
                "")

    return (f"[{tid}] Ticket update", "Ticket update", f"{actor} updated this ticket.", "")


def render(event: str, payload: Dict) -> Tuple[str, str, str]:
    """Return (subject, text_body, html_body) for one event."""
    p = payload or {}
    subject, headline, intro, body_block = _subject_and_body(event, p)

    pairs = _detail_pairs(p)
    portal_url = p.get("ticket_url") or p.get("portal_url") or ""
    cta = ""
    if portal_url and event != "ticket_deleted":
        cta = _CTA.safe_substitute(url=escape(portal_url, quote=True),
                                   ticket_id=escape(p.get("ticket_id", "")))

    if p.get("audience") == "spoc":
        reason = f"You are receiving this because you support {p.get('product_name') or 'this product'}."
    else:
        reason = f"You are receiving this because you are a member of {p.get('company_name') or 'this organisation'}."

    html = _HTML_SHELL.safe_substitute(
        subject=escape(subject),
        event_label=escape(EVENT_LABELS.get(event, "Notification")),
        headline=escape(headline),
        intro=escape(intro),
        body_block=body_block,
        detail_rows=_rows(pairs),
        cta_block=cta,
        footer_reason=escape(reason),
    )

    lines = [headline, "", intro, ""]
    for label, value in pairs:
        if value not in (None, ""):
            lines.append(f"{label}: {value}")
    for key, label in (("description", "Description"), ("message_body", "Message"),
                       ("caption", "Caption"), ("milestone_title", "Milestone")):
        if p.get(key):
            lines += ["", f"{label}:", _clip(p[key], 2000)]
    if event in ("chat_attachment", "signoff_uploaded"):
        lines += ["", NO_ATTACHMENT_NOTICE]
    if portal_url and event != "ticket_deleted":
        lines += ["", f"Open the portal: {portal_url}", f"Search for {p.get('ticket_id', '')}"]
    lines += ["", reason, "Advantal Support - automated notification."]

    return subject, "\n".join(lines), html


def render_test(portal_url: str = "") -> Tuple[str, str, str]:
    """The verification email sent from the settings screen."""
    return render("ticket_created", {
        "ticket_id": "TEST-0001",
        "title": "SMTP configuration test",
        "company_name": "Advantal Support",
        "product_name": "Portal notifications",
        "status": "open",
        "priority": "medium",
        "progress": 0,
        "actor_name": "Advantal Support",
        "assignee_name": "Not assigned",
        "description": ("This is a test message confirming that the portal can reach your "
                        "SMTP server. If you received it, notifications are ready to enable."),
        "portal_url": portal_url,
        "audience": "admin",
    })
