"""
Automation bot: signs in to Zoho People with Playwright, retrieving the
one-time passcode (OTP) from a Gmail inbox over IMAP when Zoho asks for one.

Auth model: Gmail address + 16-character app password. App passwords require
2-Step Verification on the Google account and are generated at
https://myaccount.google.com/apppasswords - your normal Google password will not
work over IMAP. IMAP must also be enabled in Gmail settings
(Settings -> See all settings -> Forwarding and POP/IMAP -> Enable IMAP).

Only stdlib is used for mail (imaplib + email), so there is no OAuth dance and
nothing to refresh - the app password is valid until you revoke it.

Environment variables (a local .env is loaded if present):
    ZOHO_EMAIL          Zoho account email / mobile number
    ZOHO_PASSWORD       Zoho password (omit only for passwordless/OTP-only logins)
    GMAIL_ADDRESS       Full Gmail address the OTP is delivered to
    GMAIL_APP_PASSWORD  16-character app password (spaces are stripped)

Optional:
    FORM_URL       Sign-in URL (default: Zoho accounts sign-in for Zoho People)
    HEADLESS       "false" to watch the browser locally (default: headless)
    OTP_TIMEOUT    Seconds to wait for the OTP mail to arrive (default: 120)
    OTP_SENDER     Only accept mail from this address (default: "zohoaccounts")
    STEALTH        "false" to disable playwright-stealth masking (default: on)
    TRACE          "off" to disable Playwright tracing, "failure" to keep the
                   trace only when the run fails (default: "on" in CI, "off"
                   locally). Written to trace.zip; open with
                   `playwright show-trace trace.zip`.
    PROXY_SERVER   e.g. "http://residential.example.com:8000" - routes all
                   browser traffic through a proxy. Optional credentials:
    PROXY_USERNAME / PROXY_PASSWORD
    PROXY_BYPASS   Comma-separated hosts to exclude from the proxy
"""

from __future__ import annotations

import email
import imaplib
import json
import logging
import mimetypes
import os
import random
import re
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from playwright.sync_api import (
    Error as PlaywrightError,
    Page,
    TimeoutError as PlaywrightTimeoutError,
    sync_playwright,
)

# ---------------------------------------------------------------------------
# Configuration & logging
# ---------------------------------------------------------------------------

load_dotenv()  # no-op in CI, convenient locally

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("bot")

IMAP_HOST = "imap.gmail.com"
IMAP_PORT = 993

MAIL_ENV_VARS = ("GMAIL_ADDRESS", "GMAIL_APP_PASSWORD")
DEFAULT_OTP_SENDER = "zohoaccounts"
OTP_PATTERN = re.compile(r"\b(\d{6,8})\b")
OTP_FOOTER_MARKER = re.compile(r"Regards,|Zoho Corporation|didn.?t initiate", re.I)
OTP_CLOCK_SKEW = timedelta(seconds=60)


class AutomationError(RuntimeError):
    """A logical failure. Retrying will not help - do not retry at the job level."""


class TransientError(AutomationError):
    """
    Infrastructure flake (DNS, proxy, runner network, mail delivery lag).

    Exits with EXIT_TRANSIENT so the workflow can retry the whole job. Never
    raised for a decision the bot made on purpose - a 9.5h safety abort or a
    bad credential must stay a hard failure, or a retry loop would grind
    against Zoho's abuse filters.
    """


EXIT_OK = 0
EXIT_PERMANENT = 1
EXIT_TRANSIENT = 75  # EX_TEMPFAIL; the workflow retries only on this code

# Playwright/OS errors that mean "the network moved", not "the page changed".
TRANSIENT_MARKERS = re.compile(
    r"net::ERR_|ERR_PROXY|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|"
    r"ERR_TIMED_OUT|ERR_INTERNET_DISCONNECTED|ECONNRESET|ECONNREFUSED|ETIMEDOUT|"
    r"Temporary failure in name resolution|getaddrinfo|Connection reset|"
    r"socket hang up|browser has been closed",
    re.I,
)


def classify_exit_code(exc: BaseException) -> int:
    """Decide whether the job is worth retrying."""
    if isinstance(exc, TransientError):
        return EXIT_TRANSIENT
    if isinstance(exc, AutomationError):
        return EXIT_PERMANENT  # explicit logical failure; a retry repeats it
    if TRANSIENT_MARKERS.search(str(exc)):
        return EXIT_TRANSIENT
    return EXIT_PERMANENT


def require_env(*names: str) -> dict[str, str]:
    """Fetch required env vars, failing fast with a single clear message."""
    values, missing = {}, []
    for name in names:
        value = os.getenv(name)
        if not value:
            missing.append(name)
        else:
            values[name] = value
    if missing:
        raise AutomationError(
            "Missing required environment variable(s): " + ", ".join(missing)
        )
    return values


# ---------------------------------------------------------------------------
# Gmail over IMAP: OTP retrieval
# ---------------------------------------------------------------------------

_HTML_TAGS = re.compile(r"<[^>]+>")


def _decode_part(part: Message) -> str:
    payload = part.get_payload(decode=True)
    if not payload:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _message_text(msg: Message) -> str:
    try:
        subject = str(make_header(decode_header(msg.get("Subject", ""))))
    except Exception:
        subject = msg.get("Subject", "") or ""

    plain, html = "", ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_maintype() == "multipart":
                continue
            content_type = part.get_content_type()
            if content_type == "text/plain" and not plain:
                plain = _decode_part(part)
            elif content_type == "text/html" and not html:
                html = _decode_part(part)
    else:
        if msg.get_content_type() == "text/html":
            html = _decode_part(msg)
        else:
            plain = _decode_part(msg)

    body = plain or _HTML_TAGS.sub(" ", html)
    return f"{subject}\n{body}"


def _connect_imap() -> imaplib.IMAP4_SSL:
    env = require_env(*MAIL_ENV_VARS)
    password = env["GMAIL_APP_PASSWORD"].replace(" ", "")

    log.info("Connecting to %s as %s...", IMAP_HOST, env["GMAIL_ADDRESS"])
    mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    try:
        mail.login(env["GMAIL_ADDRESS"], password)
    except imaplib.IMAP4.error as exc:
        raise AutomationError(
            f"IMAP login failed: {exc}. Check 2-Step Verification and App Password."
        ) from exc

    mail.select("inbox", readonly=True)
    log.info("IMAP login OK; inbox selected (read-only).")
    return mail


def extract_otp(text: str) -> Optional[str]:
    footer = OTP_FOOTER_MARKER.search(text)
    body = text[: footer.start()] if footer else text
    match = OTP_PATTERN.search(body)
    return match.group(1) if match else None


def _sent_at(msg: Message) -> Optional[datetime]:
    raw = msg.get("Date")
    if not raw:
        return None
    try:
        sent = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    return sent if sent.tzinfo else sent.replace(tzinfo=timezone.utc)


def _search_for_otp(
    mail: imaplib.IMAP4_SSL,
    sender: Optional[str],
    min_date: Optional[datetime] = None,
) -> Optional[str]:
    mail.noop()
    criteria: list[str] = []
    if sender:
        criteria += ["FROM", f'"{sender}"']
    if min_date:
        since = (min_date - timedelta(days=1)).strftime("%d-%b-%Y")
        criteria += ["SINCE", since]

    status, messages = mail.search(None, *(criteria or ["ALL"]))
    if status != "OK":
        raise AutomationError(f"IMAP search failed with status {status}.")

    for message_id in reversed(messages[0].split()):
        status, msg_data = mail.fetch(message_id, "(BODY.PEEK[])")
        if status != "OK":
            continue

        for response_part in msg_data:
            if not isinstance(response_part, tuple):
                continue
            msg = email.message_from_bytes(response_part[1])

            if min_date:
                sent = _sent_at(msg)
                if sent and sent < min_date:
                    log.debug("Ignoring older message (sent %s, need >= %s).", sent, min_date)
                    continue

            otp = extract_otp(_message_text(msg))
            if otp:
                log.info("OTP found in message from %r", msg.get("From"))
                return otp

    return None


def fetch_otp_from_gmail(
    timeout: int = 120,
    poll_interval: int = 5,
    sender: Optional[str] = None,
    min_date: Optional[datetime] = None,
) -> str:
    mail: Optional[imaplib.IMAP4_SSL] = None
    deadline = time.monotonic() + timeout
    attempt = 0
    if min_date is None:
        min_date = datetime.now(timezone.utc)
    min_date -= OTP_CLOCK_SKEW

    log.info("Polling Gmail for OTP...")
    try:
        while time.monotonic() < deadline:
            attempt += 1
            try:
                if mail is None:
                    mail = _connect_imap()
                otp = _search_for_otp(mail, sender, min_date)
                if otp:
                    return otp
            except imaplib.IMAP4.error as exc:
                log.warning("IMAP error attempt %s: %s. Reconnecting.", attempt, exc)
                mail = None
            except OSError as exc:
                log.warning("Network error attempt %s: %s. Retrying.", attempt, exc)
                mail = None

            time.sleep(poll_interval)
    finally:
        if mail is not None:
            try:
                mail.close()
                mail.logout()
            except Exception:
                pass

    # Mail delivery lag is a flake, not a logic error - worth one job retry.
    raise TransientError(f"No OTP received within {timeout}s.")


# ---------------------------------------------------------------------------
# Playwright: Zoho People Sign-in & Attendance
# ---------------------------------------------------------------------------

DEFAULT_FORM_URL = "https://accounts.zoho.in/signin?servicename=zohopeople"
SIGNED_IN_URL_PATTERN = re.compile(r"people\.zoho\.[a-z.]+|accounts\.zoho\.[a-z.]+/home")

EMAIL_INPUT = ["#login_id", 'input[name="LOGIN_ID"]', 'input[type="email"]']
NEXT_BUTTON = ["#nextbtn", 'button:has-text("Next")', 'button[type="submit"]']
PASSWORD_INPUT = ["#password", 'input[name="PASSWORD"]', 'input[type="password"]']
OTP_INPUT = [
    "input.customOtp",
    "input.mfa_email_otp",
    'input[autocomplete="one-time-code"]',
    "#otpcode",
    "#verifycode",
    'input[name="otpcode"]',
    'input[placeholder*="code" i]',
    'input[placeholder*="OTP" i]',
]
VERIFY_BUTTON = [
    "#verifyotp",
    'button:has-text("Verify")',
    'button:has-text("Sign in")',
    "#nextbtn",
]
CAPTCHA_INPUT = ["#captcha", "#bcaptcha", "#verifycaptcha"]

# Overlays Zoho People throws up after login: work-policy prompts, product
# announcements, surveys, feature tours. Ordered most specific first so a
# "Work from Home"/"At Office" confirmation is answered rather than dismissed.
WORK_POLICY_BUTTONS = [
    'button:has-text("At Office")',
    'button:has-text("Work From Office")',
    'button:has-text("At office")',
    '[role="button"]:has-text("At Office")',
]
MODAL_DISMISS_BUTTONS = [
    'button:has-text("Skip")',
    'button:has-text("Not now")',
    'button:has-text("Maybe later")',
    'button:has-text("Remind me later")',
    'button:has-text("Dismiss")',
    'button:has-text("Got it")',
    'button:has-text("Close")',
    'button:has-text("No thanks")',
    ".zpeople_popup_close",
    ".dialog-close",
    ".modal-header .close",
    '[aria-label="Close"]',
    '[data-dismiss="modal"]',
    ".ui-dialog-titlebar-close",
    "#closePopup",
]

# Never click these even if the text matches - they log us out, navigate away,
# or change account security settings.
MODAL_CLICK_DENYLIST = re.compile(
    r"sign\s*out|log\s*out|delete|cancel\s+check|"
    r"enable\s+mfa|verify|change\s+configuration|security\s+key|authenticator",
    re.I,
)

# ---------------------------------------------------------------------------
# Zoho accounts interstitial: "Re-enable MFA for better security"
# ---------------------------------------------------------------------------
#
# A full page (not a modal) served on accounts.zoho.* after OTP verification,
# before the dashboard. It offers "Enable MFA", "Verify", "Change Configuration"
# and "Delete Configuration" - every one of which mutates account security - and
# a "Remind in 2 weeks" link, which is the only safe way past it.
#
# Deferring is a real state change on the account, so it is deliberately narrow:
# we click nothing unless a recognised defer control is on screen, and the
# denylist is checked on the resolved label before every click.

MFA_PROMPT_MARKERS = [
    ':text("Re-enable MFA")',
    ':text("Enable MFA for better security")',
    ':text("You\'ve previously configured MFA")',
]
MFA_DEFER_CONTROLS = [
    'a:has-text("Remind in 2 weeks")',
    'button:has-text("Remind in 2 weeks")',
    ':text("Remind in 2 weeks")',
    ':text("Remind me in 2 weeks")',
    ':text("Remind me later")',
    ':text("Skip for now")',
    ':text("Do this later")',
]
# Belt and braces: even if a defer selector somehow resolves to one of these,
# refuse. Enabling MFA would lock the bot out of the account permanently.
MFA_NEVER_CLICK = re.compile(
    r"enable\s+mfa|verify|delete\s+configuration|change\s+configuration|"
    r"security\s+key|oneauth",
    re.I,
)


def mfa_prompt_visible(page: Page) -> bool:
    return _first_visible(page, MFA_PROMPT_MARKERS + MFA_DEFER_CONTROLS, timeout=0) is not None


def defer_mfa_prompt(page: Page) -> bool:
    """Click 'Remind in 2 weeks' on the MFA nag. Returns True if we clicked."""
    control = _first_visible(page, MFA_DEFER_CONTROLS, timeout=0)
    if control is None:
        return False

    try:
        label = (control.inner_text() or "").strip()
    except PlaywrightError:
        return False

    if MFA_NEVER_CLICK.search(label):
        log.error("Refusing to click %r on the MFA page - it would alter account security.", label[:60])
        return False

    try:
        human_pause(page, "deferring the MFA prompt")
        control.click(timeout=5_000)
    except (PlaywrightError, PlaywrightTimeoutError) as exc:
        log.warning("Could not defer the MFA prompt: %s", exc)
        return False

    log.info("Deferred Zoho's MFA prompt via %r.", label[:40])
    page.wait_for_timeout(1_500)
    return True


def _settle_after_signin(page: Page, timeout: int = 90_000) -> None:
    """
    Wait for the dashboard, stepping past interstitials that sit in front of it.

    The MFA page is served on an accounts.zoho URL that can itself satisfy
    SIGNED_IN_URL_PATTERN, so reaching a "signed in" URL is not sufficient -
    the prompt has to be gone as well.
    """
    deadline = time.monotonic() + timeout / 1000
    deferred = 0

    while time.monotonic() < deadline:
        if mfa_prompt_visible(page):
            if defer_mfa_prompt(page):
                deferred += 1
                if deferred > 3:
                    raise AutomationError(
                        "Zoho kept showing the MFA prompt after 3 deferrals."
                    )
                continue
            raise AutomationError(
                "Zoho is asking to re-enable MFA and no 'Remind in 2 weeks' "
                "control was clickable. Complete or dismiss it manually once."
            )

        if SIGNED_IN_URL_PATTERN.search(page.url):
            return

        page.wait_for_timeout(500)

    raise AutomationError(f"Sign-in did not settle on a dashboard; stuck at {page.url}.")


def _safe_click(locator, what: str) -> bool:
    """Click a modal control without letting a stale/detached node kill the run."""
    try:
        if not locator.is_visible():
            return False
        label = (locator.inner_text() or locator.get_attribute("aria-label") or "").strip()
        if label and MODAL_CLICK_DENYLIST.search(label):
            log.warning("Refusing to click %r (denylisted).", label[:60])
            return False
        locator.click(timeout=2_000)
        log.info("Dismissed overlay via %s%s", what, f" ({label[:40]!r})" if label else "")
        return True
    except (PlaywrightError, PlaywrightTimeoutError):
        return False


def dismiss_modals(page: Page, rounds: int = 3) -> int:
    """
    Clear blocking overlays before we look for the punch button.

    Each selector is probed with a short timeout, so a page with no modals
    costs well under a second. Runs a few rounds because Zoho sometimes
    stacks a survey behind an announcement.
    """
    dismissed = 0

    # Zoho's MFA interstitial is a full page, not an overlay, and the only safe
    # control on it is "Remind in 2 weeks" - see defer_mfa_prompt, which
    # re-checks the label against MFA_NEVER_CLICK before touching anything.
    if mfa_prompt_visible(page) and defer_mfa_prompt(page):
        dismissed += 1

    for attempt in range(rounds):
        clicked = False

        # Work-policy prompt first: it wants an answer, not a close button.
        for selector in WORK_POLICY_BUTTONS:
            if _safe_click(page.locator(selector).first, f"work-policy {selector}"):
                clicked = True
                dismissed += 1
                break

        if not clicked:
            for selector in MODAL_DISMISS_BUTTONS:
                if _safe_click(page.locator(selector).first, selector):
                    clicked = True
                    dismissed += 1
                    break

        if not clicked:
            # Last resort: a generic overlay with no recognised control. Escape
            # closes most Zoho dialogs; harmless if nothing is open.
            if attempt == 0:
                try:
                    page.keyboard.press("Escape")
                except PlaywrightError:
                    pass
            break

        page.wait_for_timeout(600)

    if dismissed:
        log.info("Dismissed %d overlay(s) before proceeding.", dismissed)
    else:
        log.info("No blocking overlays detected.")
    return dismissed

ACTION_DELAY_MIN = float(os.getenv("ACTION_DELAY_MIN", "0.8"))
ACTION_DELAY_MAX = float(os.getenv("ACTION_DELAY_MAX", "2.4"))


def human_pause(page: Optional[Page] = None, what: str = "the next action") -> None:
    low, high = ACTION_DELAY_MIN, ACTION_DELAY_MAX
    if high < low:
        low, high = high, low
    if high <= 0:
        return

    delay = random.uniform(low, high)
    log.info("Pausing %.1fs before %s.", delay, what)
    if page is not None:
        try:
            page.wait_for_timeout(delay * 1000)
            return
        except PlaywrightError:
            pass
    time.sleep(delay)


def _first_visible(page: Page, selectors: list[str], timeout: int = 15_000):
    deadline = time.monotonic() + timeout / 1000
    while True:
        for selector in selectors:
            locator = page.locator(selector).first
            try:
                if locator.is_visible():
                    return locator
            except PlaywrightError:
                continue
        if time.monotonic() >= deadline:
            return None
        page.wait_for_timeout(250)


def _require_visible(page: Page, selectors: list[str], what: str, timeout: int = 15_000):
    locator = _first_visible(page, selectors, timeout)
    if locator is None:
        raise AutomationError(f"Could not find {what} within {timeout // 1000}s.")
    return locator


def _wait_hidden(page: Page, selectors: list[str], what: str, timeout: int = 20_000) -> None:
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if _first_visible(page, selectors, timeout=0) is None:
            return
        page.wait_for_timeout(250)
    raise AutomationError(f"{what} remained visible after {timeout // 1000}s.")


def _fill_verified(page: Page, locator, value: str, what: str) -> None:
    human_pause(page, f"entering {what}")
    locator.click()
    locator.fill(value)
    page.wait_for_timeout(200)

    if locator.input_value() != value:
        locator.fill("")
        locator.press_sequentially(value, delay=40)
        page.wait_for_timeout(200)

    if locator.input_value() != value:
        raise AutomationError(f"Could not enter {what}.")
    log.info("Entered %s.", what)


def _otp_boxes(page: Page) -> list:
    locator = page.locator(", ".join(OTP_INPUT))
    boxes = []
    for index in range(locator.count()):
        box = locator.nth(index)
        try:
            if box.is_visible():
                boxes.append(box)
        except PlaywrightError:
            continue
    return boxes


def _read_otp_boxes(page: Page) -> str:
    try:
        return "".join(box.input_value() for box in _otp_boxes(page))
    except PlaywrightError:
        return ""


def fill_otp(page: Page, otp: str) -> None:
    boxes = _otp_boxes(page)
    if not boxes:
        raise AutomationError("OTP field missing.")

    human_pause(page, "entering OTP")
    boxes[0].focus()
    page.keyboard.type(otp, delay=60)
    page.wait_for_timeout(300)

    if _read_otp_boxes(page) == otp:
        return

    boxes = _otp_boxes(page)
    if len(boxes) == 1:
        boxes[0].fill(otp)
    elif len(boxes) >= len(otp):
        for box, digit in zip(boxes, otp):
            box.fill(digit)
    page.wait_for_timeout(300)


def _check_for_captcha(page: Page) -> None:
    if _first_visible(page, CAPTCHA_INPUT, timeout=0) is not None:
        raise AutomationError("Zoho CAPTCHA encountered.")


def _masked_mail_patterns(address: str) -> list[re.Pattern]:
    local, _, domain = address.partition("@")
    if not local or not domain:
        raise AutomationError(f"Invalid email: {address!r}")
    head, dom = re.escape(local[:2]), re.escape(domain[:2])
    return [
        re.compile(rf"{head}[\w*.+-]*@{dom}\*+\.", re.I),
        re.compile(rf"@{dom}\*+\.", re.I),
    ]


def _choose_otp_delivery(page: Page, gmail_address: str, timeout: int = 8_000) -> bool:
    patterns = _masked_mail_patterns(gmail_address)
    deadline = time.monotonic() + timeout / 1000

    while True:
        if SIGNED_IN_URL_PATTERN.search(page.url):
            return False
        if _first_visible(page, OTP_INPUT, timeout=0) is not None:
            return False

        for pattern in patterns:
            option = page.get_by_text(pattern).first
            try:
                if not option.is_visible():
                    continue
                human_pause(page, "picking delivery address")
                option.click()
                page.wait_for_timeout(2_000)
                return True
            except PlaywrightError:
                continue

        if time.monotonic() >= deadline:
            return False
        page.wait_for_timeout(250)


def _await_otp_or_dashboard(page: Page, timeout: int = 45_000):
    deadline = time.monotonic() + timeout / 1000
    while True:
        if SIGNED_IN_URL_PATTERN.search(page.url):
            return None
        otp_field = _first_visible(page, OTP_INPUT, timeout=0)
        if otp_field is not None:
            return otp_field
        if time.monotonic() >= deadline:
            raise AutomationError(f"Dashboard/OTP timeout at {page.url}.")
        page.wait_for_timeout(500)


# ---------------------------------------------------------------------------
# Session reuse: skip email/password/OTP when a stored Zoho session is alive
# ---------------------------------------------------------------------------
#
# Zoho sessions typically survive 7-30 days depending on org policy. Reusing one
# removes the slowest and most fragile leg of the run (IMAP round-trip for the
# OTP) and stops us hammering Zoho's OTP endpoint twice a day, which is what
# trips abuse heuristics.
#
# SECURITY: the storage state contains live session cookies - anyone holding it
# is logged in as you, no OTP required. It is therefore encrypted at rest with
# STATE_KEY (a repo secret) before anything touches the Actions cache, because
# cache entries on a PUBLIC repo are readable by workflows from forked PRs.
# Without STATE_KEY we refuse to persist in CI at all. See README.

STATE_DIR = Path(os.getenv("STATE_DIR", "bot"))
STATE_BLOB = STATE_DIR / "encrypted_state.enc"  # what CI caches (encrypted)
STATE_PLAIN = STATE_DIR / "plain_state.json"    # local-only convenience
STATE_MAX_AGE_DAYS = float(os.getenv("STATE_MAX_AGE_DAYS", "7"))


def _state_cipher():
    """Fernet instance from STATE_KEY, or None when unset/unavailable."""
    key = (os.getenv("STATE_KEY") or "").strip()
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet  # type: ignore
    except ImportError:
        log.warning("STATE_KEY set but `cryptography` is not installed.")
        return None
    try:
        return Fernet(key.encode())
    except Exception as exc:
        log.warning("STATE_KEY is not a valid Fernet key (%s).", exc)
        return None


def session_reuse_enabled() -> bool:
    if os.getenv("SESSION_REUSE", "true").lower() in ("false", "0", "off"):
        return False
    # In CI, refuse to write session cookies anywhere unencrypted.
    if os.getenv("GITHUB_ACTIONS") == "true" and _state_cipher() is None:
        log.info("Session reuse disabled in CI: STATE_KEY is not configured.")
        return False
    return True


def load_storage_state() -> Optional[str]:
    """
    Return a path Playwright can pass as `storage_state`, or None.

    Discards state that is unreadable, undecryptable, or older than
    STATE_MAX_AGE_DAYS - a stale cookie jar just means we sign in normally.
    """
    if not session_reuse_enabled():
        return None

    cipher = _state_cipher()
    source = STATE_BLOB if STATE_BLOB.exists() else STATE_PLAIN
    if not source.exists():
        log.info("No stored session found; signing in from scratch.")
        return None

    try:
        payload = source.read_bytes()
        if source == STATE_BLOB:
            if cipher is None:
                log.warning("Found encrypted session but no usable STATE_KEY; ignoring.")
                return None
            payload = cipher.decrypt(payload)
        wrapper = json.loads(payload.decode("utf-8"))
        saved_at = datetime.fromisoformat(wrapper["savedAt"])
        state = wrapper["state"]
    except Exception as exc:
        log.warning("Stored session unreadable (%s); signing in from scratch.", exc)
        return None

    age = datetime.now(timezone.utc) - saved_at
    if age > timedelta(days=STATE_MAX_AGE_DAYS):
        log.info("Stored session is %.1f days old (max %.1f); discarding.",
                 age.total_seconds() / 86400, STATE_MAX_AGE_DAYS)
        return None

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    handoff = STATE_DIR / "_active_state.json"
    handoff.write_text(json.dumps(state), encoding="utf-8")
    log.info("Loaded stored session (%.1f hours old).", age.total_seconds() / 3600)
    return str(handoff)


def save_storage_state(context) -> None:
    if not session_reuse_enabled():
        return

    try:
        state = context.storage_state()
    except Exception as exc:
        log.warning("Could not export session state: %s", exc)
        return

    wrapper = json.dumps(
        {"savedAt": datetime.now(timezone.utc).isoformat(), "state": state}
    ).encode("utf-8")

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    cipher = _state_cipher()
    try:
        if cipher is not None:
            STATE_BLOB.write_bytes(cipher.encrypt(wrapper))
            # Never leave a plaintext cookie jar behind once we can encrypt.
            STATE_PLAIN.unlink(missing_ok=True)
            log.info("Session state saved (encrypted) -> %s", STATE_BLOB)
        else:
            STATE_PLAIN.write_bytes(wrapper)
            log.info("Session state saved (PLAINTEXT, local only) -> %s", STATE_PLAIN)
    except Exception as exc:
        log.warning("Could not persist session state: %s", exc)
    finally:
        (STATE_DIR / "_active_state.json").unlink(missing_ok=True)


def discard_storage_state() -> None:
    """Drop a session Zoho no longer accepts so the next run does not retry it."""
    for path in (STATE_BLOB, STATE_PLAIN, STATE_DIR / "_active_state.json"):
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
    log.info("Cleared stored session.")


def dashboard_url_for(form_url: str) -> str:
    """accounts.zoho.in/signin?... -> https://people.zoho.in/ (same data centre)."""
    host = urllib.parse.urlsplit(form_url).hostname or "accounts.zoho.in"
    people = re.sub(r"^accounts\.", "people.", host)
    return f"https://{people}/"


def _looks_signed_in(page: Page) -> bool:
    if not SIGNED_IN_URL_PATTERN.search(page.url):
        return False
    # The MFA interstitial lives on an accounts.zoho URL that can match the
    # pattern, so a matching URL alone does not mean we reached the dashboard.
    if mfa_prompt_visible(page):
        return False
    # A stale cookie often still lands on a people.zoho URL that then bounces to
    # the sign-in form, so confirm no credential field is on screen.
    return _first_visible(page, EMAIL_INPUT + PASSWORD_INPUT, timeout=0) is None


def ensure_signed_in(page: Page, form_url: str, state_path: Optional[str]) -> bool:
    """
    Land on the dashboard, reusing a stored session when one is still valid.

    Returns True when the session was reused (no OTP spent).
    """
    if state_path:
        dashboard = dashboard_url_for(form_url)
        log.info("Trying stored session against %s", dashboard)
        try:
            page.goto(dashboard, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(2_500)
        except (PlaywrightError, PlaywrightTimeoutError) as exc:
            raise TransientError(f"Could not reach the dashboard: {exc}") from exc

        # Zoho can serve the MFA nag on a reused session too.
        if mfa_prompt_visible(page):
            log.info("MFA prompt served on a reused session; deferring it.")
            defer_mfa_prompt(page)
            page.wait_for_timeout(2_000)

        if _looks_signed_in(page):
            log.info("Stored session accepted - skipping password and OTP entirely.")
            return True

        log.info("Stored session rejected (at %s); falling back to full sign-in.", page.url)
        discard_storage_state()

    sign_in(page, form_url)
    return False


def sign_in(page: Page, form_url: str) -> None:
    env = require_env("ZOHO_EMAIL")
    zoho_email = env["ZOHO_EMAIL"]
    zoho_password = os.getenv("ZOHO_PASSWORD")

    log.info("Navigating to %s", form_url)
    human_pause(what="opening sign-in page")
    try:
        page.goto(form_url, wait_until="domcontentloaded", timeout=60_000)
    except (PlaywrightError, PlaywrightTimeoutError) as exc:
        raise TransientError(f"Could not reach the sign-in page: {exc}") from exc

    sign_in_link = _first_visible(page, ['a:has-text("Sign In")'], timeout=3_000)
    if sign_in_link is not None:
        human_pause(page, "clicking Sign In")
        sign_in_link.click()

    email_field = _require_visible(page, EMAIL_INPUT, "email field")
    _fill_verified(page, email_field, zoho_email, "email address")
    next_button = _require_visible(page, NEXT_BUTTON, "Next button")
    human_pause(page, "clicking Next")
    next_button.click()

    _wait_hidden(page, EMAIL_INPUT, "email field")
    _check_for_captcha(page)

    password_field = _first_visible(page, PASSWORD_INPUT, timeout=10_000)
    if password_field is not None:
        if not zoho_password:
            raise AutomationError("ZOHO_PASSWORD missing.")
        _fill_verified(page, password_field, zoho_password, "password")
        sign_in_button = _require_visible(page, NEXT_BUTTON, "Sign in button")
        human_pause(page, "clicking Sign in")
        sign_in_button.click()
        _wait_hidden(page, PASSWORD_INPUT, "password field")

    requested_at = datetime.now(timezone.utc)
    _check_for_captcha(page)

    gmail_address = os.getenv("GMAIL_ADDRESS")
    if gmail_address:
        _choose_otp_delivery(page, gmail_address)

    otp_field = _await_otp_or_dashboard(page)
    if otp_field is not None:
        otp = fetch_otp_from_gmail(
            timeout=int(os.getenv("OTP_TIMEOUT", "120")),
            sender=os.getenv("OTP_SENDER") or DEFAULT_OTP_SENDER,
            min_date=requested_at,
        )
        fill_otp(page, otp)

        # Only look for Verify while the OTP field is still on screen. Zoho's
        # MFA interstitial also carries a "Verify" button, and if the OTP
        # auto-submitted we would otherwise click it and start re-verifying MFA.
        if _first_visible(page, OTP_INPUT, timeout=0) is not None:
            verify_button = _first_visible(page, VERIFY_BUTTON, timeout=3_000)
            if verify_button is not None:
                try:
                    human_pause(page, "clicking Verify")
                    verify_button.click(timeout=10_000)
                except PlaywrightError:
                    pass
        else:
            log.info("OTP field already gone; Zoho auto-submitted the code.")

        _settle_after_signin(page)

    try:
        page.wait_for_load_state("domcontentloaded", timeout=30_000)
    except PlaywrightTimeoutError:
        pass

    # The prompt can also appear on a password-only sign-in, where the OTP
    # branch above never ran.
    if mfa_prompt_visible(page):
        _settle_after_signin(page)

    if not SIGNED_IN_URL_PATTERN.search(page.url):
        raise AutomationError("Bounced from dashboard.")

    log.info("Signed in successfully: %s", page.url)


def randomize_start() -> None:
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule":
        already_waited = os.environ.get("DISPATCH_DELAY_MS", "")
        if already_waited.isdigit() and int(already_waited) > 0:
            log.info("Manual dispatch already waited; skipping delay.")
        return

    max_seconds = scheduled_jitter_seconds()
    if max_seconds <= 0:
        return

    delay_seconds = random.randint(0, max_seconds)
    log.info("Scheduled run: sleeping %ds...", delay_seconds)
    time.sleep(delay_seconds)


TOTAL_TIME_SELECTOR = "#totalInTime"
ATT_STATUS_SELECTOR = "#att_status"
REQUIRED_MINUTES = 9 * 60 + 30


# ---------------------------------------------------------------------------
# Network interception: read attendance straight from Zoho's XHR payloads
# ---------------------------------------------------------------------------
#
# The dashboard widget is populated by a background fetch. Reading that JSON is
# immune to CSS/DOM churn, so we prefer it and fall back to scraping #totalInTime
# only when no usable payload arrives.

ATTENDANCE_URL_HINT = re.compile(
    r"attendance|checkin|check_in|punch|timetracker|atttrack|getAttEntry", re.I
)

# Keys whose value is a worked-duration. Zoho has used several spellings across
# releases, so match on shape rather than an exact list.
_DURATION_KEY = re.compile(
    r"(total|worked|elapsed|payable|present)[_a-z]*(time|hours?|hrs|duration|sec)", re.I
)
_STATUS_KEY = re.compile(
    r"^(att(endance)?_?)?status$|checkinstatus|punchstatus|"
    r"emp(loyee)?status|currentstatus|att_?state|punchstate|"
    r"^state$|statusmessage|status_?(text|label|str)",
    re.I,
)
# Values that are a status code rather than a label ("0"/"1") tell us nothing.
_STATUS_VALUE_OK = re.compile(r"[a-z]{2,}", re.I)
_HHMM = re.compile(r"^(\d{1,3})[:hH](\d{1,2})(?:[:mM](\d{1,2}))?$")

MAX_PAYLOAD_BYTES = 2_000_000


def _duration_to_seconds(value) -> Optional[int]:
    """Coerce a Zoho duration value (seconds, minutes, or "HH:MM[:SS]") to seconds."""
    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        total = int(value)
        if total <= 0:
            return None
        # Heuristic: a plain number large enough to be epoch-millis is not a
        # duration. Values under ~24h are seconds; we never see minutes-only
        # fields large enough to collide meaningfully with a workday.
        if total > 86_400 * 2:
            return None
        # Under a minute is ambiguous - "totalHours": 9 means 9 hours, not 9
        # seconds. Rather than guess the unit, ignore it and let the DOM answer.
        if total < 60:
            return None
        return total

    if isinstance(value, str):
        text = value.strip()
        match = _HHMM.match(text)
        if match:
            hours = int(match.group(1))
            minutes = int(match.group(2))
            seconds = int(match.group(3) or 0)
            if hours > 48 or minutes > 59 or seconds > 59:
                return None
            return hours * 3600 + minutes * 60 + seconds
        if text.isdigit():
            return _duration_to_seconds(int(text))

    return None


def _walk_payload(node, depth: int = 0):
    """Yield (key, value) pairs from arbitrarily nested JSON, depth-capped."""
    if depth > 8:
        return
    if isinstance(node, dict):
        for key, value in node.items():
            yield key, value
            yield from _walk_payload(value, depth + 1)
    elif isinstance(node, list):
        for item in node[:50]:
            yield from _walk_payload(item, depth + 1)


def duration_candidates(payload) -> list[tuple[str, int, object]]:
    """
    Every (key, seconds, raw_value) in the payload that looks like a duration.

    More than one usually matches, and they do not all mean the same thing -
    Zoho's `totalSecs` counts only *closed* punch pairs, so while a session is
    still running it under-reports the day by the length of that session. The
    full list is logged so a wrong pick can be diagnosed from one run's output
    instead of by guessing at the schema.
    """
    found: list[tuple[str, int, object]] = []
    seen: set[str] = set()
    for key, value in _walk_payload(payload):
        if not isinstance(key, str) or key in seen or not _DURATION_KEY.search(key):
            continue
        candidate = _duration_to_seconds(value)
        if candidate is not None:
            seen.add(key)
            found.append((key, candidate, value))
    return found


def extract_attendance_from_payload(
    payload,
) -> tuple[Optional[int], Optional[str], Optional[str], Optional[str]]:
    """
    Pull (seconds, raw, status, duration_key) out of a decoded JSON attendance
    response.

    Returns all-None when the payload carries nothing usable, which is the
    common case - most intercepted responses are unrelated.
    """
    seconds: Optional[int] = None
    raw: Optional[str] = None
    status: Optional[str] = None
    duration_key: Optional[str] = None

    candidates = duration_candidates(payload)
    if candidates:
        duration_key, seconds, value = candidates[0]
        raw = value if isinstance(value, str) else None

    for key, value in _walk_payload(payload):
        if not isinstance(key, str):
            continue

        if (
            status is None
            and _STATUS_KEY.search(key)
            and isinstance(value, str)
            and _STATUS_VALUE_OK.search(value)
        ):
            status = value.strip()
            log.debug("Status from payload key %r = %r", key, value)

    if seconds is not None and not raw:
        hours, remainder = divmod(seconds, 3600)
        raw = f"{hours:02d}:{remainder // 60:02d}:{remainder % 60:02d}"

    return seconds, raw, status, duration_key


def _payload_key_names(payload, limit: int = 60) -> list[str]:
    """Distinct key names in a payload, for diagnostics. Keys only, no values."""
    names: list[str] = []
    for key, _ in _walk_payload(payload):
        if isinstance(key, str) and key not in names:
            names.append(key)
            if len(names) >= limit:
                break
    return names


class AttendanceInterceptor:
    """Records the most recent attendance-shaped JSON response seen on the page."""

    def __init__(self) -> None:
        self.seconds: Optional[int] = None
        self.raw: Optional[str] = None
        self.status: Optional[str] = None
        self.seen_urls: list[str] = []
        self.hits = 0

    def attach(self, page: Page) -> None:
        page.on("response", self._on_response)

    def _on_response(self, response) -> None:
        # Handler exceptions are swallowed by Playwright but would still spam
        # the log, and a bad payload must never take down the run.
        try:
            url = response.url
            if not ATTENDANCE_URL_HINT.search(url):
                return

            content_type = (response.headers or {}).get("content-type", "")
            if "json" not in content_type.lower():
                return

            body = response.body()
            if len(body) > MAX_PAYLOAD_BYTES:
                log.debug("Skipping oversized payload from %s", url[:120])
                return

            payload = json.loads(body.decode("utf-8", errors="replace"))
        except Exception:
            return

        self.seen_urls.append(url.split("?")[0][:160])

        try:
            seconds, raw, status, duration_key = extract_attendance_from_payload(payload)
            candidates = duration_candidates(payload)
        except Exception as exc:
            log.debug("Payload parse failed for %s: %s", url[:120], exc)
            return

        if seconds is None and status is None:
            return

        self.hits += 1
        if seconds is not None:
            self.seconds, self.raw = seconds, raw
        if status is not None:
            self.status = status
        log.info(
            "Intercepted attendance payload from %s (seconds=%s from %r, status=%s)",
            url.split("?")[0][-60:],
            seconds,
            duration_key,
            status,
        )
        if len(candidates) > 1:
            log.info(
                "Duration fields in payload: %s",
                ", ".join(f"{key}={secs}s" for key, secs, _ in candidates),
            )

        # When half the payload parsed, print the key names (never the values -
        # these responses carry employee data) so the missing pattern can be
        # fixed from the log instead of by guessing at Zoho's schema.
        if status is None or seconds is None:
            missing = "status" if status is None else "duration"
            log.info(
                "No %s field matched. Keys present: %s",
                missing,
                ", ".join(_payload_key_names(payload)) or "(none)",
            )

    def snapshot(self) -> Optional["AttendanceSnapshot"]:
        if self.seconds is None and self.status is None:
            return None
        return AttendanceSnapshot(self.status, self.seconds, self.raw, origin="api")

    def log_summary(self) -> None:
        if self.hits:
            return
        if self.seen_urls:
            log.info(
                "Saw %d attendance-shaped request(s) but parsed none: %s",
                len(self.seen_urls),
                ", ".join(dict.fromkeys(self.seen_urls))[:400],
            )
        else:
            log.info("No attendance XHR intercepted; DOM scraping is the only source.")


# Populated in run(); read by read_attendance().
INTERCEPTOR: Optional[AttendanceInterceptor] = None


class AttendanceSnapshot:
    def __init__(
        self,
        status: Optional[str],
        seconds: Optional[int],
        raw: Optional[str],
        settled: bool = True,
        origin: str = "dom",
    ):
        self.status = status
        self.seconds = seconds
        self.raw = raw
        self.settled = settled
        self.origin = origin  # "api" (intercepted XHR) or "dom" (scraped widget)
        # Both raw readings are kept on merged snapshots. `seconds` above is the
        # one worth reporting; the checkout guard separately takes the smallest
        # of these, so a disagreement can never punch out early.
        self.dom_seconds: Optional[int] = None
        self.api_seconds: Optional[int] = None

    def guard_seconds(self) -> Optional[int]:
        """Smallest elapsed reading available - what the 9.5h rule must use."""
        readings = [
            value
            for value in (self.seconds, self.dom_seconds, self.api_seconds)
            if value is not None
        ]
        return min(readings) if readings else None

    @property
    def minutes(self) -> Optional[int]:
        return None if self.seconds is None else self.seconds // 60

    def describe(self) -> str:
        if self.seconds is None:
            return f"status={self.status or 'unknown'}, time unreadable [{self.origin}]"
        h, rem = divmod(self.seconds, 3600)
        return (
            f"status={self.status or 'unknown'}, "
            f"logged {h}h {rem // 60}m ({self.raw}) [{self.origin}]"
        )


def _parse_timer_spans(page: Page) -> tuple[Optional[int], Optional[str]]:
    container = page.locator(TOTAL_TIME_SELECTOR).first
    container.wait_for(state="attached", timeout=10_000)

    spans = container.locator("span")
    parts = [
        (spans.nth(index).inner_text() or "").strip()
        for index in range(spans.count())
    ]
    parts = [part for part in parts if re.fullmatch(r"\d{1,3}", part)]

    if not parts:
        text = (container.inner_text() or "").strip()
        match = re.match(r"(\d{1,3})\s*[:hH]\s*(\d{1,2})(?:\s*[:mM]\s*(\d{1,2}))?", text)
        if not match:
            return None, text or None
        parts = [g for g in match.groups() if g is not None]

    hours = int(parts[0])
    minutes = int(parts[1]) if len(parts) > 1 else 0
    seconds = int(parts[2]) if len(parts) > 2 else 0
    raw = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return hours * 3600 + minutes * 60 + seconds, raw


WIDGET_SETTLE_TIMEOUT = 20

# How far the API and DOM elapsed readings may drift before one is treated as
# wrong rather than merely stale. A few minutes is normal clock lag between the
# payload landing and the widget being scraped.
DISAGREEMENT_TOLERANCE = 300


def _read_attendance_once(page: Page) -> AttendanceSnapshot:
    status: Optional[str] = None
    try:
        status_el = page.locator(ATT_STATUS_SELECTOR).first
        status_el.wait_for(state="attached", timeout=10_000)
        status = (status_el.inner_text() or "").strip() or None
    except (PlaywrightError, PlaywrightTimeoutError):
        pass

    try:
        seconds, raw = _parse_timer_spans(page)
    except (PlaywrightError, PlaywrightTimeoutError):
        seconds, raw = None, None

    return AttendanceSnapshot(status, seconds, raw)


def read_attendance(page: Page) -> AttendanceSnapshot:
    deadline = time.monotonic() + WIDGET_SETTLE_TIMEOUT
    snapshot = _read_attendance_once(page)

    while not (snapshot.status and snapshot.seconds):
        if time.monotonic() >= deadline:
            snapshot.settled = bool(snapshot.status) or bool(snapshot.seconds)
            break
        page.wait_for_timeout(1_000)
        snapshot = _read_attendance_once(page)

    # Merge the intercepted API payload with the scraped widget. The API is the
    # better default - it survives DOM changes, and it backfills whichever field
    # the widget did not render - but it does not get to overrule a widget
    # reading that plainly contradicts it. See the disagreement branch below.
    api = INTERCEPTOR.snapshot() if INTERCEPTOR is not None else None
    if api is not None:
        # On a real disagreement the widget wins: it is the number Zoho shows the
        # employee, and it is the one that counts the still-running session. The
        # API's day total omits the open punch pair, so it reads hours short
        # while checked in - which is exactly when this runs.
        disagrees = (
            snapshot.seconds is not None
            and api.seconds is not None
            and abs(snapshot.seconds - api.seconds) > DISAGREEMENT_TOLERANCE
        )
        use_api_seconds = api.seconds is not None and not disagrees

        merged = AttendanceSnapshot(
            status=api.status or snapshot.status,
            seconds=api.seconds if use_api_seconds else snapshot.seconds,
            raw=api.raw if use_api_seconds else snapshot.raw,
            settled=True,
            origin="api" if use_api_seconds else "api+dom",
        )
        if disagrees:
            log.warning(
                "API and DOM disagree on elapsed time (api=%ss, dom=%ss); "
                "trusting DOM - the API total excludes the running session.",
                api.seconds,
                snapshot.seconds,
            )
        merged.dom_seconds = snapshot.seconds
        merged.api_seconds = api.seconds
        # State both readings explicitly. The 9.5h guard depends on at least one
        # of them, so "which source actually produced a number" is the first
        # thing worth knowing when a check-out behaves oddly.
        log.info(
            "Sources: api=%ss, dom=%s, status=%r (%s); elapsed taken from %s, "
            "9.5h guard uses %ss",
            api.seconds,
            f"{snapshot.seconds}s" if snapshot.seconds is not None else "unreadable",
            merged.status,
            "api" if api.status else "dom",
            "api" if use_api_seconds else "dom",
            merged.guard_seconds(),
        )
        snapshot = merged
    elif INTERCEPTOR is not None:
        INTERCEPTOR.log_summary()
        log.info(
            "Sources: api=none, dom=%s",
            f"{snapshot.seconds}s" if snapshot.seconds is not None else "unreadable",
        )

    log.info("Attendance: %s", snapshot.describe())
    return snapshot


_WARNED: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    """Telegram alert that fires at most once per run - two punches, one nag."""
    if key in _WARNED:
        return
    _WARNED.add(key)
    send_telegram_msg(message)


def report_attendance(snapshot: AttendanceSnapshot, source: str) -> None:
    base = (os.getenv("CONTROL_CENTER_URL") or "").rstrip("/")
    if not base:
        return

    body = json.dumps(
        {
            "status": snapshot.status,
            "loggedSeconds": snapshot.seconds,
            "rawTime": snapshot.raw,
            "readVia": snapshot.origin,
            "source": source,
            "runId": os.getenv("DISPATCH_RUN_ID") or None,
        }
    ).encode("utf-8")

    request = urllib.request.Request(f"{base}/api/attendance", data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    secret = os.getenv("DISPATCH_SECRET")
    if secret:
        # Both headers: some CDNs strip Authorization before it reaches the app.
        request.add_header("Authorization", f"Bearer {secret}")
        request.add_header("X-Dispatch-Secret", secret)

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            log.info("Reported attendance to dashboard (HTTP %s).", response.status)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            # Silently dropping this is bad: the dashboard's 9.5h display goes
            # stale and nothing on screen says why. Name the exact cause.
            cause = (
                "DISPATCH_SECRET is not set for this workflow, so no "
                "Authorization header was sent"
                if not secret
                else "the workflow's DISPATCH_SECRET does not match the one "
                "deployed with the dashboard"
            )
            log.error("Dashboard rejected the attendance snapshot (401): %s.", cause)
            _warn_once(
                "dashboard-401",
                f"⚠️ Dashboard rejected the attendance snapshot (401): {cause}. "
                f"Punching still works; the dashboard reading is stale.",
            )
        else:
            log.warning(
                "Could not report attendance to dashboard (HTTP %s): %s", exc.code, exc
            )
    except Exception as exc:
        log.warning("Could not report attendance to dashboard: %s", exc)


def verify_checkout_eligibility(page: Page) -> None:
    snapshot = read_attendance(page)

    if snapshot.seconds is None:
        # FAIL CLOSED. This used to warn and check out anyway, which is how a
        # 2h27m day got punched out at 12:31: the timer was unreadable, so the
        # 9.5h rule was simply skipped. An unverified check-out is a payroll
        # problem; a missed one is a two-second manual fix.
        if os.getenv("ALLOW_UNVERIFIED_CHECKOUT", "").lower() in ("true", "1", "yes"):
            log.warning("Timer unreadable but ALLOW_UNVERIFIED_CHECKOUT is set; proceeding.")
            send_telegram_msg("⚠️ Checking out WITHOUT 9.5h verification (override set).")
            return
        raise AutomationError(
            "SAFETY ABORT: could not read elapsed time from either the API or the "
            "widget, so the 9.5-hour rule cannot be verified. Refusing to check out. "
            "Check out manually, or set ALLOW_UNVERIFIED_CHECKOUT=true to override."
        )

    # When both the API payload and the widget produced a number, trust the
    # smaller one. Under-reading costs a retry; over-reading punches out early.
    total_minutes = snapshot.guard_seconds() // 60
    hours, minutes = divmod(total_minutes, 60)

    if total_minutes >= REQUIRED_MINUTES:
        log.info("Safety check passed: 9.5 hour requirement met (%dh %dm).", hours, minutes)
        return

    shortfall = REQUIRED_MINUTES - total_minutes
    now = _ist_now()
    eligible_at = now + timedelta(minutes=shortfall)
    deadline = _ist_at(CHECKOUT_DEADLINE)

    # The evening cron is a fixed time, but eligibility depends on when you
    # actually checked in. Check in at 10:04 and 9.5h lands at 19:34, after the
    # 19:17 window - so wait it out rather than abandoning the check-out.
    can_wait = shortfall <= MAX_CHECKOUT_WAIT_MIN and eligible_at <= deadline

    if not can_wait:
        reason = (
            f"that is {shortfall - MAX_CHECKOUT_WAIT_MIN:.0f} min beyond the "
            f"{MAX_CHECKOUT_WAIT_MIN} min the job can wait"
            if shortfall > MAX_CHECKOUT_WAIT_MIN
            else f"which is past the {CHECKOUT_DEADLINE} deadline"
        )
        send_telegram_msg(
            f"🚫 Not checking out: only {hours}h {minutes}m logged, 9.5h needs "
            f"{shortfall} more minutes (eligible {eligible_at.strftime('%H:%M')} IST) - "
            f"{reason}. Check out manually when you are ready."
        )
        raise AutomationError(
            f"SAFETY ABORT: Attempting to check out too early. "
            f"Only {hours}h {minutes}m elapsed. 9.5 hours ({REQUIRED_MINUTES}m) required. "
            f"Eligible at {eligible_at.strftime('%H:%M')} IST - {reason}."
        )

    log.info(
        "Short by %d min. Waiting until %s IST (deadline %s) before checking out.",
        shortfall, eligible_at.strftime("%H:%M"), CHECKOUT_DEADLINE,
    )
    send_telegram_msg(
        f"⏳ Holding the check-out: {hours}h {minutes}m logged, waiting "
        f"{shortfall} min until 9.5h at {eligible_at.strftime('%H:%M')} IST."
    )

    # +1 min of slack so a rounding-down read does not put us back under.
    page.wait_for_timeout(int((shortfall + 1) * 60_000))

    try:
        page.reload(wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(3_000)
    except (PlaywrightError, PlaywrightTimeoutError) as exc:
        raise TransientError(f"Could not refresh the page after waiting: {exc}") from exc

    dismiss_modals(page, rounds=2)
    recheck = read_attendance(page)
    if recheck.seconds is None:
        raise AutomationError(
            "SAFETY ABORT: elapsed time became unreadable after waiting; not checking out."
        )

    final_minutes = recheck.guard_seconds() // 60
    if final_minutes < REQUIRED_MINUTES:
        raise AutomationError(
            f"SAFETY ABORT: still only {final_minutes // 60}h {final_minutes % 60}m "
            f"after waiting. Not checking out."
        )

    log.info(
        "Safety check passed after waiting: %dh %dm.", final_minutes // 60, final_minutes % 60
    )


def run_status_check(page: Page) -> None:
    log.info("STATUS_CHECK: reading attendance widget...")
    snapshot = read_attendance(page)
    report_attendance(snapshot, source="STATUS_CHECK")


def _punch_label_pattern(target_text: str) -> re.Pattern:
    """
    "Check-in" -> /check\\s*-?\\s*in\\b/i

    Matches Check-in, Check In, CheckIn and Check_in. The trailing \\b keeps
    "Check-in" from matching a "Check-in Time" column header, and the two
    directions never collide because "in" and "out" are anchored separately.
    """
    direction = "out" if "out" in target_text.lower() else "in"
    return re.compile(rf"\bcheck[\s_-]*{direction}\b", re.I)


PUNCH_LOOKUP_TIMEOUT = 15  # seconds to keep re-probing every strategy


def _punch_button(page: Page, target_text: str):
    """
    Find the punch button without depending on any class name or ID.

    Ordered most-precise to most-structural. The later strategies exist because
    Zoho ships Webpack builds with generated class names (`css-1x9a2b`) and has
    stripped readable IDs before; accessible role + visible text is what
    survives, since a human still has to read the button.
    """
    page.wait_for_load_state("domcontentloaded")
    pattern = _punch_label_pattern(target_text)

    def build() -> list[tuple[str, object]]:
        return [
        # 1. Exact accessible name - unambiguous when Zoho keeps the label as-is.
        ("exact role", page.get_by_role("button", name=target_text, exact=True)),
        # 2. Same role, tolerant of spacing/casing drift ("Check In", "CheckIn").
        ("fuzzy role", page.get_by_role("button", name=pattern)),
        # 3. ARIA-labelled control that renders as a div rather than a <button>.
        ("aria-label", page.locator(f'[aria-label*="{target_text}" i]')),
        # 4. Legacy IDs, still the fastest hit when they are present.
        ("legacy id", page.locator("#checkIn" if "in" in target_text.lower()
                                   and "out" not in target_text.lower() else "#checkOut")),
        # 5. Any clickable element whose visible text matches.
        ("clickable text", page.locator(
            'button, [role="button"], input[type="submit"], a'
        ).filter(has_text=pattern)),
        # 6. Layout-relative: the control sitting next to the attendance widget.
        #    Immune to DOM restructuring as long as the visual arrangement holds.
        ("near attendance widget", page.locator(
            f'button:near(:text("Attendance")), [role="button"]:near(:text("Attendance"))'
        ).filter(has_text=pattern)),
        # 7. Last resort: the text node itself, clicking whatever renders it.
        ("bare text", page.get_by_text(pattern)),
        ]

    # Poll all strategies cheaply rather than blocking on each one in turn:
    # count() does not wait, so a strategy that matches nothing costs ~nothing.
    # Seven blocking waits would otherwise burn ~30s before the first fallback
    # even gets a look in, and nearly a minute before we could screenshot.
    deadline = time.monotonic() + PUNCH_LOOKUP_TIMEOUT
    while True:
        for label, locator in build():
            try:
                if locator.count() == 0:  # type: ignore[union-attr]
                    continue
                candidate = locator.first  # type: ignore[union-attr]
                if not candidate.is_visible():
                    continue
                log.info("Found %s button via %s strategy.", target_text, label)
                return candidate
            except (PlaywrightError, PlaywrightTimeoutError):
                continue

        if time.monotonic() >= deadline:
            break
        page.wait_for_timeout(500)  # widget may still be rendering

    raise AutomationError(
        f"Could not locate the {target_text} button by role, text, id, aria-label "
        f"or layout. Zoho's dashboard markup has probably changed - check the trace."
    )


def _confirm_punch(page: Page, target_text: str, timeout: int = 20_000) -> None:
    """The punch is confirmed when the button we clicked stops being offered."""
    deadline = time.monotonic() + timeout / 1000
    pattern = _punch_label_pattern(target_text)

    while time.monotonic() < deadline:
        try:
            remaining = page.get_by_role("button", name=pattern).count()
        except PlaywrightError:
            remaining = 1  # transient DOM churn; keep waiting
        if remaining == 0:
            log.info("Confirmed: %s button is gone.", target_text)
            return
        page.wait_for_timeout(500)

    page.screenshot(path="failure.png", full_page=True)
    raise AutomationError(f"The {target_text} button stayed on screen; punch unconfirmed.")


# Attendance states, kept distinct because "never checked in today" and
# "checked in then out again" demand opposite handling in the evening.
STATE_IN = "in"          # currently checked in
STATE_OUT = "out"        # checked in earlier, now checked out
STATE_NEVER = "never"    # no check-in recorded today
STATE_UNKNOWN = "unknown"

# Ordered: the first match wins, so the "Yet to Check-in" negation is tested
# before the bare "check-in" it contains.
_STATUS_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"yet\s+to\s+check|not\s+checked\s*-?\s*in|no\s+check\s*-?\s*in", re.I), STATE_NEVER),
    (re.compile(r"absent|leave|holiday|weekly\s+off", re.I), STATE_NEVER),
    (re.compile(r"checked\s*-?\s*out|punch(ed)?\s*-?\s*out|^\s*out\s*$", re.I), STATE_OUT),
    (re.compile(r"checked\s*-?\s*in|punch(ed)?\s*-?\s*in|present|^\s*in\s*$", re.I), STATE_IN),
]


def classify_status(status: Optional[str]) -> str:
    """
    Map Zoho's status label onto a state.

    Substring matching is not safe here: "Yet to Check-in" contains "in" and
    not "out", so a naive test reads *not checked in* as *checked in* and would
    aim a morning cron at Check-out. Order and word boundaries do the work.
    """
    if not status or not status.strip():
        return STATE_UNKNOWN
    for pattern, state in _STATUS_RULES:
        if pattern.search(status):
            return state
    log.warning("Unrecognised attendance status %r; treating as unknown.", status[:60])
    return STATE_UNKNOWN


# IST hour before this is treated as the morning (check-in) half of the day.
# The crons fire at 09:19 and 19:17 IST, so the boundary is nowhere near either.
MORNING_CUTOFF_HOUR = 14

# --- Attendance policy -----------------------------------------------------
# Check in between 08:00 and 10:30, check out by 20:00, and Zoho must show
# 9.5 hours. The 30-minute lunch break is inserted automatically by Zoho and is
# counted inside that 9.5, so 9.5 total = 9 hours of actual work. The shift is
# not fixed at 09:00-18:30; only the windows below matter.
CHECKIN_EARLIEST = os.getenv("CHECKIN_EARLIEST", "08:00")
CHECKIN_LATEST = os.getenv("CHECKIN_LATEST", "10:30")
CHECKOUT_DEADLINE = os.getenv("CHECKOUT_DEADLINE", "20:00")
# How long the bot may hold the job open waiting to become eligible.
MAX_CHECKOUT_WAIT_MIN = int(os.getenv("MAX_CHECKOUT_WAIT_MIN", "40"))


def _ist_at(hhmm: str) -> datetime:
    """Today's IST datetime for an "HH:MM" string."""
    hour, _, minute = hhmm.partition(":")
    return _ist_now().replace(
        hour=int(hour), minute=int(minute or 0), second=0, microsecond=0
    )


def _intent_from_cron() -> Optional[str]:
    """
    Which punch the firing cron was for.

    Stronger than reading the wall clock: a 09:19 window is a check-in even if
    GitHub starts it late. This is precisely what went wrong on 3 Aug - the
    morning cron ran at 12:31 and the old logic, which chose from the *status*
    rather than from the schedule, turned it into a check-out.
    """
    expression = (os.getenv("SCHEDULED_CRON") or "").strip()
    if not expression:
        return None
    target = _cron_target_utc(expression, datetime.now(timezone.utc))
    if target is None:
        return None
    return "Check-in" if target.astimezone(IST).hour < MORNING_CUTOFF_HOUR else "Check-out"


def decide_punch(snapshot: AttendanceSnapshot) -> tuple[Optional[str], Optional[str]]:
    """
    Decide what to punch. Returns (target_text, skip_reason).

    Intent comes from the dispatched action, or failing that from the time of
    day in IST - not from the status label. Status is used to *veto* a punch
    (duplicate, or nothing to check out of), never to invert the intent, so a
    status Zoho renames cannot flip a morning run into a check-out.
    """
    dashboard_action = os.environ.get("DISPATCH_ACTION")
    state = classify_status(snapshot.status)

    cron_intent = _intent_from_cron()

    if dashboard_action == "ACTION_ALPHA":
        target, origin = "Check-in", "dispatched ACTION_ALPHA"
    elif dashboard_action == "ACTION_BETA":
        target, origin = "Check-out", "dispatched ACTION_BETA"
    elif cron_intent is not None:
        # The schedule that fired decides, not the clock when it happened to run.
        target, origin = cron_intent, f"cron window ({os.getenv('SCHEDULED_CRON')})"
    else:
        hour = _ist_now().hour
        target = "Check-in" if hour < MORNING_CUTOFF_HOUR else "Check-out"
        origin = f"time of day ({hour:02d}:xx IST)"

    log.info(
        "Intent: %s from %s | status=%r -> state=%s",
        target, origin, snapshot.status, state,
    )

    if target == "Check-in" and state == STATE_IN:
        return None, "already checked in"

    if target == "Check-in":
        now = _ist_now()
        if now < _ist_at(CHECKIN_EARLIEST):
            return None, (
                f"it is before the {CHECKIN_EARLIEST} check-in window "
                f"(now {now.strftime('%H:%M')} IST)"
            )
        if now > _ist_at(CHECKIN_LATEST):
            # Late attendance still beats none, so punch - but say so loudly,
            # because 9.5h from here finishes after the check-out deadline.
            finish = (now + timedelta(minutes=REQUIRED_MINUTES)).strftime("%H:%M")
            log.warning(
                "Checking in at %s, past the %s window. 9.5h completes at %s, "
                "after the %s deadline.",
                now.strftime("%H:%M"), CHECKIN_LATEST, finish, CHECKOUT_DEADLINE,
            )
            _warn_once(
                "late-checkin",
                f"⚠️ Checking in at {now.strftime('%H:%M')} IST, past the "
                f"{CHECKIN_LATEST} window. 9.5h would complete at {finish}, after "
                f"the {CHECKOUT_DEADLINE} check-out deadline.",
            )

    if target == "Check-out":
        if state == STATE_OUT:
            return None, "already checked out"
        if state == STATE_NEVER:
            # Nothing to check out of - the morning punch never landed. Punching
            # anything here would be wrong, and the button will not exist.
            return None, "no check-in recorded today, so there is nothing to check out"

    return target, None


def punch_attendance(page: Page) -> None:
    """Read state first to avoid duplicate punches, then execute punch."""
    snapshot = read_attendance(page)
    dashboard_action = os.environ.get("DISPATCH_ACTION")

    target_text, skip_reason = decide_punch(snapshot)

    if target_text is None:
        log.info("Standing down: %s.", skip_reason)
        send_telegram_msg(
            f"ℹ️ No punch at {_ist_now().strftime('%H:%M')} IST - {skip_reason}.\n"
            f"{snapshot.describe()}"
        )
        report_attendance(snapshot, source=dashboard_action or "PUNCH")
        return

    if target_text == "Check-out":
        log.info("Executing 9.5-hour safety check before checking out...")
        verify_checkout_eligibility(page)

    # Clear anything that drifted in while we were reading the widget - a modal
    # here intercepts the click and the run times out looking for the button.
    dismiss_modals(page, rounds=2)

    try:
        button = _punch_button(page, target_text)
        human_pause(page, f"clicking {target_text}")
        button.click()
        log.info("Clicked %s; waiting for confirmation...", target_text)
    except AutomationError:
        # _punch_button exhausted every strategy; its message already says so.
        # Capture the screen anyway - it is what gets pushed to Telegram.
        page.screenshot(path="failure.png", full_page=True)
        raise
    except (PlaywrightError, PlaywrightTimeoutError) as exc:
        page.screenshot(path="failure.png", full_page=True)
        raise AutomationError(f"Failed to find or click the {target_text} button.") from exc

    _confirm_punch(page, target_text)

    page.wait_for_timeout(2_000)
    page.screenshot(path="success.png", full_page=True)
    final = read_attendance(page)
    report_attendance(final, source=dashboard_action or "PUNCH")

    send_telegram_msg(
        f"✅ {target_text} confirmed at {_ist_now().strftime('%H:%M')} IST.\n"
        f"{final.describe()}",
        photo="success.png",
    )


IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_JITTER_MINUTES = 25


def _ist_now() -> datetime:
    return datetime.now(IST)


def _dashboard_get(path: str) -> Optional[dict]:
    base = (os.getenv("CONTROL_CENTER_URL") or "").rstrip("/")
    if not base:
        return None

    request = urllib.request.Request(f"{base}{path}")
    request.add_header("Accept", "application/json")
    secret = os.getenv("DISPATCH_SECRET")
    if secret:
        request.add_header("Authorization", f"Bearer {secret}")

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        log.warning("Dashboard request %s failed: %s", path, exc)
        return None


def check_dashboard_policy() -> None:
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule":
        return

    today_str = _ist_now().strftime("%Y-%m-%d")

    exceptions = _dashboard_get("/api/exceptions?upcoming=1")
    if exceptions is None:
        log.warning("Could not reach dashboard; proceeding.")
        return

    for entry in exceptions.get("exceptions", []):
        if entry.get("exceptionDate") == today_str:
            reason = entry.get("reason", "no reason given")
            log.info("Holiday exception on %s (%s). Standing down.", today_str, reason)
            send_telegram_msg(f"🌴 {today_str} is marked '{reason}'. No punch today.")
            sys.exit(0)

    schedule = _dashboard_get("/api/schedule")
    if schedule is None:
        return

    weekday = _ist_now().strftime("%A")
    for row in schedule.get("schedule", []):
        if row.get("dayOfWeek") == weekday and row.get("enabled") is False:
            log.info("%s is disabled in schedule matrix. Standing down.", weekday)
            send_telegram_msg(f"⏸️ Automation is paused for {weekday}. No punch today.")
            sys.exit(0)


# GitHub's scheduled triggers are best-effort: under load they are delayed by
# tens of minutes, and delays of hours happen during incidents. A cron meant for
# 09:19 that actually starts at 12:06 must not punch - by then the state of the
# day has moved on, which is exactly how a mid-day check-out happened.
MAX_SCHEDULE_LATENESS_MIN = int(os.getenv("MAX_SCHEDULE_LATENESS_MIN", "30"))


def _cron_target_utc(expression: str, now: datetime) -> Optional[datetime]:
    """Today's UTC datetime for a 'M H * * D' cron expression."""
    parts = expression.split()
    if len(parts) < 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return None
    return now.replace(
        hour=int(parts[1]), minute=int(parts[0]), second=0, microsecond=0
    )


def check_run_freshness() -> None:
    """Stand down when a scheduled run starts far outside its intended window."""
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule":
        return

    expression = (os.getenv("SCHEDULED_CRON") or "").strip()
    if not expression:
        log.info("No SCHEDULED_CRON provided; skipping the lateness check.")
        return

    now = datetime.now(timezone.utc)
    target = _cron_target_utc(expression, now)
    if target is None:
        log.warning("Could not parse SCHEDULED_CRON %r; skipping lateness check.", expression)
        return

    lateness = (now - target).total_seconds() / 60
    if lateness < -5:  # fired early: clock skew, not our problem
        return

    if lateness > MAX_SCHEDULE_LATENESS_MIN:
        target_ist = target.astimezone(IST).strftime("%H:%M")
        log.error(
            "Scheduled run is %.0f minutes late (cron %r targeted %s IST, "
            "now %s IST). Standing down.",
            lateness, expression, target_ist, _ist_now().strftime("%H:%M"),
        )
        send_telegram_msg(
            f"⏱️ Skipped a stale scheduled run: the {target_ist} IST window started "
            f"{lateness:.0f} minutes late (GitHub delay). No punch was made - "
            f"dispatch manually if you still need it."
        )
        sys.exit(0)

    log.info("Scheduled run is %.0f minutes after its window; proceeding.", lateness)


def scheduled_jitter_seconds() -> int:
    schedule = _dashboard_get("/api/schedule")
    if schedule:
        weekday = _ist_now().strftime("%A")
        for row in schedule.get("schedule", []):
            if row.get("dayOfWeek") == weekday:
                minutes = row.get("randomOffsetMinutes")
                if isinstance(minutes, int) and minutes >= 0:
                    return minutes * 60

    override = os.getenv("DISPATCH_MAX_JITTER_SEC", "")
    if override.isdigit():
        return int(override)

    return DEFAULT_JITTER_MINUTES * 60


TELEGRAM_CAPTION_LIMIT = 1024  # Telegram's cap on sendPhoto captions
TELEGRAM_PHOTO_LIMIT = 10 * 1024 * 1024  # sendPhoto rejects anything larger


def _telegram_credentials() -> Optional[tuple[str, str]]:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    return (token, chat_id) if token and chat_id else None


def _multipart_body(
    fields: dict[str, str], name: str, filename: str, payload: bytes
) -> tuple[bytes, str]:
    """Build a multipart/form-data body with the stdlib - no `requests` needed."""
    boundary = f"----bot{uuid.uuid4().hex}"
    line_end = b"\r\n"
    chunks: list[bytes] = []

    for key, value in fields.items():
        chunks += [
            f"--{boundary}".encode(),
            line_end,
            f'Content-Disposition: form-data; name="{key}"'.encode(),
            line_end * 2,
            str(value).encode("utf-8"),
            line_end,
        ]

    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    chunks += [
        f"--{boundary}".encode(),
        line_end,
        f'Content-Disposition: form-data; name="{name}"; filename="{filename}"'.encode(),
        line_end,
        f"Content-Type: {content_type}".encode(),
        line_end * 2,
        payload,
        line_end,
        f"--{boundary}--".encode(),
        line_end,
    ]

    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def send_telegram_photo(photo_path: str, caption: str) -> bool:
    """
    Push a screenshot straight to the phone. Returns False if it could not be
    sent, so the caller can fall back to plain text - a notification that never
    arrives is worse than one without a picture.
    """
    creds = _telegram_credentials()
    if creds is None:
        return False
    token, chat_id = creds

    try:
        path = Path(photo_path)
        if not path.exists() or path.stat().st_size == 0:
            return False
        if path.stat().st_size > TELEGRAM_PHOTO_LIMIT:
            log.warning("%s is too large for Telegram (%d bytes).", path, path.stat().st_size)
            return False
        payload = path.read_bytes()
    except OSError as exc:
        log.warning("Could not read %s for Telegram: %s", photo_path, exc)
        return False

    body, content_type = _multipart_body(
        {
            "chat_id": chat_id,
            "caption": caption[:TELEGRAM_CAPTION_LIMIT],
            "disable_notification": "true",
        },
        "photo",
        path.name,
        payload,
    )

    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendPhoto", data=body, method="POST"
    )
    request.add_header("Content-Type", content_type)

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            ok = 200 <= response.status < 300
            if ok:
                log.info("Sent %s to Telegram.", path.name)
            return ok
    except Exception as exc:
        log.warning("Failed to send Telegram photo: %s", exc)
        return False


def send_telegram_msg(text: str, photo: Optional[str] = None) -> None:
    """
    Notify Telegram, attaching a screenshot when one is available.

    Falls back to a text-only message whenever the photo cannot be delivered.
    """
    creds = _telegram_credentials()
    if creds is None:
        return
    token, chat_id = creds

    if photo and send_telegram_photo(photo, text):
        return

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = urllib.parse.urlencode(
        {"chat_id": chat_id, "text": text, "disable_notification": "true"}
    ).encode("utf-8")

    try:
        urllib.request.urlopen(url, data=data, timeout=10)
    except Exception as exc:
        log.warning("Failed to send Telegram notification: %s", exc)


# ---------------------------------------------------------------------------
# Browser hardening: stealth, proxy, tracing
# ---------------------------------------------------------------------------

TRACE_PATH = "trace.zip"


def build_proxy_config() -> Optional[dict]:
    """Route browser traffic through a proxy when PROXY_SERVER is set."""
    server = (os.getenv("PROXY_SERVER") or "").strip()
    if not server:
        return None

    proxy = {"server": server}
    username = os.getenv("PROXY_USERNAME")
    password = os.getenv("PROXY_PASSWORD")
    if username and password:
        proxy["username"] = username
        proxy["password"] = password
    bypass = os.getenv("PROXY_BYPASS")
    if bypass:
        proxy["bypass"] = bypass

    # Log the host only - credentials and the full URL stay out of CI logs.
    host = urllib.parse.urlsplit(server if "://" in server else f"//{server}").hostname
    log.info("Routing browser traffic through proxy host %s.", host or "configured")
    return proxy


def apply_stealth(page: Page) -> bool:
    """
    Mask headless fingerprints (navigator.webdriver, plugins, chrome runtime).

    Optional dependency and version-tolerant: playwright-stealth 2.x exposes a
    Stealth class, 1.x a stealth_sync function. If neither imports, the run
    continues unmasked rather than failing.
    """
    if os.getenv("STEALTH", "true").lower() in ("false", "0", "off"):
        log.info("Stealth disabled by STEALTH env var.")
        return False

    try:
        import playwright_stealth  # type: ignore
    except ImportError:
        log.warning("playwright-stealth not installed; running unmasked.")
        return False

    try:
        stealth_cls = getattr(playwright_stealth, "Stealth", None)
        if stealth_cls is not None:  # 2.x
            stealth_cls().apply_stealth_sync(page)
        else:  # 1.x
            playwright_stealth.stealth_sync(page)
    except Exception as exc:
        log.warning("Could not apply stealth patches (%s); continuing.", exc)
        return False

    log.info("Stealth patches applied.")
    return True


def _trace_mode() -> str:
    """on | failure | off. Defaults to on in CI, off locally."""
    default = "on" if os.getenv("GITHUB_ACTIONS") == "true" else "off"
    mode = (os.getenv("TRACE") or default).strip().lower()
    return mode if mode in ("on", "failure", "off") else default


def start_tracing(context) -> bool:
    if _trace_mode() == "off":
        return False
    try:
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        log.info("Playwright tracing started -> %s", TRACE_PATH)
        return True
    except Exception as exc:
        log.warning("Could not start tracing: %s", exc)
        return False


def stop_tracing(context, tracing_on: bool, failed: bool) -> None:
    if not tracing_on:
        return
    keep = _trace_mode() == "on" or failed
    try:
        if keep:
            context.tracing.stop(path=TRACE_PATH)
            log.info(
                "Trace written to %s - inspect with `playwright show-trace %s`.",
                TRACE_PATH,
                TRACE_PATH,
            )
        else:
            context.tracing.stop()
    except Exception as exc:
        log.warning("Could not stop tracing cleanly: %s", exc)


def run() -> None:
    global INTERCEPTOR

    status_check = os.getenv("DISPATCH_MODE", "PUNCH").upper() == "STATUS_CHECK"

    if not status_check:
        check_run_freshness()
        check_dashboard_policy()
        randomize_start()

    form_url = os.getenv("FORM_URL") or DEFAULT_FORM_URL
    headless = os.getenv("HEADLESS", "true").lower() != "false"

    log.info("=== Automation run starting (%s) ===", "STATUS_CHECK" if status_check else "PUNCH")
    started = time.monotonic()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=headless,
            proxy=build_proxy_config(),
            args=["--disable-blink-features=AutomationControlled"],
        )
        state_path = load_storage_state()
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            geolocation={"latitude": 18.506154, "longitude": 73.761416},
            permissions=["geolocation"],
            locale="en-IN",
            timezone_id="Asia/Kolkata",
            storage_state=state_path,
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        )
        tracing_on = start_tracing(context)

        page = context.new_page()
        page.set_default_timeout(30_000)
        apply_stealth(page)

        INTERCEPTOR = AttendanceInterceptor()
        INTERCEPTOR.attach(page)

        failed = False
        try:
            reused = ensure_signed_in(page, form_url, state_path)
            # Refresh the stored session on every successful landing, so the
            # 7-day clock restarts and a rotated cookie is not lost.
            save_storage_state(context)
            log.info("Session %s.", "reused (no OTP spent)" if reused else "established")

            dismiss_modals(page)
            if status_check:
                run_status_check(page)
            else:
                punch_attendance(page)
        except Exception as exc:
            failed = True
            try:
                page.screenshot(path="failure.png", full_page=True)
            except PlaywrightError:
                pass
            if isinstance(exc, PlaywrightTimeoutError):
                raise AutomationError(f"Timed out interacting with page: {exc}") from exc
            raise
        finally:
            stop_tracing(context, tracing_on, failed)
            context.close()
            browser.close()

    log.info("=== Automation run finished in %.1fs ===", time.monotonic() - started)


def _notify_failure(detail: str, retryable: bool) -> None:
    mode = os.getenv("DISPATCH_MODE") or "PUNCH"
    action = os.getenv("DISPATCH_ACTION") or "auto"
    icon = "🔁" if retryable else "❌"
    suffix = " (transient - the workflow will retry)" if retryable else ""
    # The screenshot is the whole point: see what the bot saw, on the phone.
    send_telegram_msg(
        f"{icon} Bot run FAILED at {_ist_now().strftime('%H:%M')} IST "
        f"({mode}/{action}){suffix}: {detail[:300]}",
        photo="failure.png",
    )


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        code = classify_exit_code(exc)
        if isinstance(exc, AutomationError):
            log.error("Run failed: %s", exc)
            detail = str(exc)
        else:
            log.exception("Unexpected error.")
            detail = f"{type(exc).__name__}: {exc}"
        log.error(
            "Exiting %d (%s).", code,
            "transient, retryable" if code == EXIT_TRANSIENT else "permanent",
        )
        _notify_failure(detail, retryable=code == EXIT_TRANSIENT)
        sys.exit(code)