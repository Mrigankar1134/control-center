"""
Automation bot: signs in to Zoho People with Playwright, retrieving the
one-time passcode (OTP) from a Gmail inbox over IMAP when Zoho asks for one.

Auth model: Gmail address + 16-character **app password**. App passwords require
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
    OTP_SENDER     Only accept mail from this address (default: "zoho.com")
"""

from __future__ import annotations

import email
import imaplib
import json
import logging
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parsedate_to_datetime
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

# Env vars that must both be present for the OTP half of the run to be attempted.
MAIL_ENV_VARS = ("GMAIL_ADDRESS", "GMAIL_APP_PASSWORD")

# IMAP FROM matches on a substring. "zohoaccounts" rather than "zoho.com",
# which matches nothing at all - the sender is noreply@zohoaccounts.in, and
# "zoho.com" is not a substring of that. This covers every data centre's
# sender (.in, .com, .eu) without pinning one address.
DEFAULT_OTP_SENDER = "zohoaccounts"

# Zoho's sign-in codes are 7 digits, verified against a real mail. The range is
# kept loose in case that changes.
OTP_PATTERN = re.compile(r"\b(\d{6,8})\b")

# Zoho's footer is full of digit runs that OTP_PATTERN happily matches: the
# Chennai postal code 603202, the phone 67447070, the fax 67447172. The body is
# cut at the first of these markers before searching, otherwise the postal code
# wins - it is the only such run a \d{6} pattern can match, which is exactly
# how a 7-digit OTP got silently replaced by a PIN code.
OTP_FOOTER_MARKER = re.compile(r"Regards,|Zoho Corporation|didn.?t initiate", re.I)

# Allowance for clock skew between Zoho's mail servers and this machine when
# deciding whether a message is newer than the moment the code was requested.
OTP_CLOCK_SKEW = timedelta(seconds=60)


class AutomationError(RuntimeError):
    """Raised for any unrecoverable failure in the automation run."""


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
    """Decode one MIME part to text, tolerating a wrong or missing charset."""
    payload = part.get_payload(decode=True)
    if not payload:
        return ""
    charset = part.get_content_charset() or "utf-8"
    # errors="replace": a mojibake byte must not crash the run when the digits
    # we actually need are almost certainly plain ASCII.
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:  # charset name the codec registry does not know
        return payload.decode("utf-8", errors="replace")


def _message_text(msg: Message) -> str:
    """Flatten a message to searchable text: subject + plain body (HTML fallback)."""
    try:
        subject = str(make_header(decode_header(msg.get("Subject", ""))))
    except Exception:  # noqa: BLE001 - malformed headers must not abort the run
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

    # Many OTP mails are HTML-only, so falling back to a de-tagged body matters.
    body = plain or _HTML_TAGS.sub(" ", html)
    return f"{subject}\n{body}"


def _connect_imap() -> imaplib.IMAP4_SSL:
    """Log in to Gmail over IMAP and select the inbox."""
    env = require_env(*MAIL_ENV_VARS)
    # Google shows app passwords as "abcd efgh ijkl mnop"; IMAP wants them
    # without spaces, and pasting them verbatim is the usual first mistake.
    password = env["GMAIL_APP_PASSWORD"].replace(" ", "")

    log.info("Connecting to %s as %s...", IMAP_HOST, env["GMAIL_ADDRESS"])
    mail = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    try:
        mail.login(env["GMAIL_ADDRESS"], password)
    except imaplib.IMAP4.error as exc:
        raise AutomationError(
            f"IMAP login failed: {exc}. Check that 2-Step Verification is on, that "
            "GMAIL_APP_PASSWORD is a 16-character app password (not your Google "
            "password), and that IMAP is enabled in Gmail settings."
        ) from exc

    # readonly: the bot only ever reads. Belt and braces with BODY.PEEK - the
    # server will not let us change a flag even by accident.
    mail.select("inbox", readonly=True)
    log.info("IMAP login OK; inbox selected (read-only).")
    return mail


def extract_otp(text: str) -> Optional[str]:
    """
    Pull the sign-in code out of a flattened Zoho mail, or return None.

    The footer is discarded first: it carries a postal code, a phone number
    and a fax number, all of which look exactly like a code to a bare
    digit-run pattern.
    """
    footer = OTP_FOOTER_MARKER.search(text)
    body = text[: footer.start()] if footer else text
    match = OTP_PATTERN.search(body)
    return match.group(1) if match else None


def _sent_at(msg: Message) -> Optional[datetime]:
    """Parse a message's Date header into an aware datetime, or None."""
    raw = msg.get("Date")
    if not raw:
        return None
    try:
        sent = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    # A Date header with no zone parses as naive; assume UTC so the comparison
    # in _search_for_otp never raises.
    return sent if sent.tzinfo else sent.replace(tzinfo=timezone.utc)


def _search_for_otp(
    mail: imaplib.IMAP4_SSL,
    sender: Optional[str],
    min_date: Optional[datetime] = None,
) -> Optional[str]:
    """
    Return an OTP from the newest matching message, or None.

    Freshness is decided purely by min_date - the moment the code was
    requested. An earlier version also required UNSEEN, which made the run
    depend on nobody glancing at the inbox: a phone that shows a notification
    marks the mail read, and the bot would then never see the code it was
    waiting for. Reading the flag is not a reliable signal for something the
    account owner also uses, so the fetch uses BODY.PEEK and leaves the
    mailbox exactly as it found it.
    """
    # NOOP asks the server for mailbox updates; without it, mail that arrived
    # after SELECT may not show up in a repeated SEARCH.
    mail.noop()

    criteria: list[str] = []
    if sender:
        criteria += ["FROM", f'"{sender}"']
    if min_date:
        # IMAP SINCE is date-granular and server-timezone-ish, so subtract a day
        # and let the Date-header check below do the precise filtering.
        since = (min_date - timedelta(days=1)).strftime("%d-%b-%Y")
        criteria += ["SINCE", since]

    status, messages = mail.search(None, *(criteria or ["ALL"]))
    if status != "OK":
        raise AutomationError(f"IMAP search failed with status {status}.")

    # Newest last in IMAP's ID order, so walk backwards to prefer the latest code.
    for message_id in reversed(messages[0].split()):
        # PEEK, not RFC822: fetching with RFC822 would mark the user's mail
        # read as a side effect of the bot looking at it.
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
                    log.debug(
                        "Ignoring older message (sent %s, need >= %s).", sent, min_date
                    )
                    continue

            otp = extract_otp(_message_text(msg))
            if otp:
                log.info(
                    "OTP found in message from %r (subject: %r)",
                    msg.get("From"),
                    msg.get("Subject"),
                )
                return otp

    return None


def fetch_otp_from_gmail(
    timeout: int = 120,
    poll_interval: int = 5,
    sender: Optional[str] = None,
    min_date: Optional[datetime] = None,
) -> str:
    """
    Poll the Gmail inbox until an OTP arrives, then return it.

    Only mail newer than `min_date` is considered, so a code from an earlier
    run is never reused. Raises AutomationError if nothing arrives before the
    timeout.
    """
    mail: Optional[imaplib.IMAP4_SSL] = None
    deadline = time.monotonic() + timeout
    attempt = 0
    if min_date is None:
        min_date = datetime.now(timezone.utc)
    # Zoho's mail servers and this machine do not share a clock, so a message
    # stamped a few seconds "before" the request is still the right one.
    min_date -= OTP_CLOCK_SKEW

    log.info(
        "Polling Gmail for an OTP from %s sent after %s (timeout: %ss)...",
        sender or "any sender",
        min_date.isoformat(timespec="seconds"),
        timeout,
    )
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
                # Gmail drops idle connections; reconnect on the next pass.
                log.warning("IMAP error on attempt %s: %s. Reconnecting.", attempt, exc)
                mail = None
            except OSError as exc:  # socket/TLS trouble
                log.warning("Network error on attempt %s: %s. Retrying.", attempt, exc)
                mail = None

            log.info("No OTP yet (attempt %s); waiting %ss.", attempt, poll_interval)
            time.sleep(poll_interval)
    finally:
        if mail is not None:
            try:
                mail.close()
                mail.logout()
            except Exception:  # noqa: BLE001 - never mask the real failure
                pass

    raise AutomationError(f"No OTP received within {timeout}s ({attempt} attempts).")


# ---------------------------------------------------------------------------
# Playwright: the Zoho People sign-in & Attendance
# ---------------------------------------------------------------------------

# The marketing page (zoho.com/people/login.html) only hosts a "Sign In" link
# that bounces here, so going straight to the accounts app skips a redirect and
# a click. The .in TLD is this org's data centre (confirmed: sign-in lands on
# people.zoho.in); change it (.com / .eu / .com.au) for another tenant, or
# override with the FORM_URL env var.
DEFAULT_FORM_URL = "https://accounts.zoho.in/signin?servicename=zohopeople"

# Landing on any of these means the sign-in completed.
SIGNED_IN_URL_PATTERN = re.compile(r"people\.zoho\.[a-z.]+|accounts\.zoho\.[a-z.]+/home")

# Zoho renders sign-in as a wizard: each step swaps the fields in place without
# a navigation, and the exact markup differs between password, passwordless and
# MFA-enabled accounts. So every step below is a list of candidate locators
# tried in order - the first one that actually becomes visible wins. Verify
# these against your own tenant with:
#     playwright codegen https://accounts.zoho.com/signin?servicename=zohopeople
EMAIL_INPUT = ["#login_id", 'input[name="LOGIN_ID"]', 'input[type="email"]']
NEXT_BUTTON = ["#nextbtn", 'button:has-text("Next")', 'button[type="submit"]']
PASSWORD_INPUT = ["#password", 'input[name="PASSWORD"]', 'input[type="password"]']
OTP_INPUT = [
    "input.customOtp",  # Zoho's split one-digit-per-box widget
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
# Present but hidden on a normal sign-in; visible means we are blocked.
CAPTCHA_INPUT = ["#captcha", "#bcaptcha", "#verifycaptcha"]


# Every interaction with the page is preceded by a pause in this range, so the
# run does not fire off a burst of instantaneous clicks the way no human can.
# Randomised rather than fixed: a constant interval is itself a fingerprint.
ACTION_DELAY_MIN = float(os.getenv("ACTION_DELAY_MIN", "0.8"))
ACTION_DELAY_MAX = float(os.getenv("ACTION_DELAY_MAX", "2.4"))


def human_pause(page: Optional[Page] = None, what: str = "the next action") -> None:
    """
    Wait a short random moment before acting on the page.

    Uses page.wait_for_timeout when a page is available so Playwright keeps
    servicing the browser during the wait (a bare time.sleep blocks the event
    loop and can leave the page mid-render); falls back to time.sleep otherwise.
    """
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
            pass  # page/context already gone - fall through to a plain sleep
    time.sleep(delay)


def _first_visible(page: Page, selectors: list[str], timeout: int = 15_000):
    """
    Return the first selector in `selectors` that becomes visible, or None.

    Polls all candidates together rather than waiting out the full timeout on
    each, so a five-candidate list still resolves in about one timeout.
    """
    deadline = time.monotonic() + timeout / 1000
    while True:  # always sweep once, so timeout=0 means "check right now"
        for selector in selectors:
            locator = page.locator(selector).first
            try:
                if locator.is_visible():
                    return locator
            except PlaywrightError:
                continue  # selector not in the DOM yet
        if time.monotonic() >= deadline:
            return None
        page.wait_for_timeout(250)


def _require_visible(page: Page, selectors: list[str], what: str, timeout: int = 15_000):
    """Like _first_visible, but fail loudly with the candidates that were tried."""
    locator = _first_visible(page, selectors, timeout)
    if locator is None:
        raise AutomationError(
            f"Could not find the {what} within {timeout // 1000}s. Tried: "
            + ", ".join(selectors)
            + ". Re-run `playwright codegen` against your Zoho tenant and update "
            "the selector list in bot.py; see failure.png for what was on screen."
        )
    return locator


def _wait_hidden(page: Page, selectors: list[str], what: str, timeout: int = 20_000) -> None:
    """
    Block until none of `selectors` is visible.

    Zoho's wizard keeps every step's markup in one document and swaps
    visibility, so the *next* step's fields already report visible (as
    zero-ish-width slivers) while the current step is still on screen.
    Waiting for the current step to disappear is what makes "the page has
    actually advanced" true before we touch anything.
    """
    deadline = time.monotonic() + timeout / 1000
    while time.monotonic() < deadline:
        if _first_visible(page, selectors, timeout=0) is None:
            return
        page.wait_for_timeout(250)
    raise AutomationError(
        f"The {what} was still on screen after {timeout // 1000}s - the previous "
        "step did not go through. See failure.png."
    )


def _fill_verified(page: Page, locator, value: str, what: str) -> None:
    """
    Fill a field and read the value back, retrying with real keystrokes.

    Playwright's fill() sets the value directly; if the element is mid-render
    or a framework re-binds it, the value silently vanishes and the run
    limps on with an empty field. Reading it back turns that into a hard
    failure. Only lengths are logged - `value` may be the password.
    """
    human_pause(page, f"entering the {what}")
    locator.click()
    locator.fill(value)
    page.wait_for_timeout(200)

    if locator.input_value() != value:
        log.warning("fill() did not stick for the %s; retrying with keystrokes.", what)
        locator.fill("")
        locator.press_sequentially(value, delay=40)
        page.wait_for_timeout(200)

    actual = locator.input_value()
    if actual != value:
        raise AutomationError(
            f"Could not enter the {what}: the field holds {len(actual)} characters, "
            f"expected {len(value)}. Zoho most likely re-rendered the step underneath "
            "the fill. See failure.png."
        )
    log.info("Entered the %s (%d characters).", what, len(value))


def _otp_boxes(page: Page) -> list:
    """Every visible OTP input, in document order."""
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
    """Concatenate what is currently in the OTP boxes."""
    try:
        return "".join(box.input_value() for box in _otp_boxes(page))
    except PlaywrightError:
        return ""


def fill_otp(page: Page, otp: str) -> None:
    """
    Enter the code, coping with Zoho's split one-digit-per-box widget.

    Two things make this different from an ordinary text field. The digit
    inputs sit inside a <div id="mfa_email" class="textbox"> that swallows
    pointer events, so clicking the input never lands - focus() sidesteps the
    hit test entirely. And with one character per box, a single fill() would
    only ever populate the first digit, so the code is typed as real
    keystrokes and the widget moves focus along itself.
    """
    boxes = _otp_boxes(page)
    if not boxes:
        raise AutomationError("The OTP field disappeared before the code was entered.")

    log.info("Entering the %d-digit code across %d box(es).", len(otp), len(boxes))
    human_pause(page, "entering the one-time code")
    boxes[0].focus()
    page.keyboard.type(otp, delay=60)
    page.wait_for_timeout(300)

    if _read_otp_boxes(page) == otp:
        return

    # Typing can be swallowed if the widget re-renders mid-entry; fall back to
    # writing the boxes directly.
    log.warning("Typing the code did not stick; filling the boxes directly.")
    boxes = _otp_boxes(page)
    if len(boxes) == 1:
        boxes[0].fill(otp)
    elif len(boxes) >= len(otp):
        for box, digit in zip(boxes, otp):
            box.fill(digit)
    page.wait_for_timeout(300)

    actual = _read_otp_boxes(page)
    if actual != otp:
        raise AutomationError(
            f"Could not enter the one-time code: {len(boxes)} box(es) hold "
            f"{len(actual)} of {len(otp)} digits. See failure.png."
        )


def _check_for_captcha(page: Page) -> None:
    """Fail with a clear message if Zoho puts a CAPTCHA in the way."""
    if _first_visible(page, CAPTCHA_INPUT, timeout=0) is not None:
        raise AutomationError(
            "Zoho is showing a CAPTCHA, which this bot cannot solve. It usually "
            "appears after repeated failed sign-ins or from an unfamiliar IP - "
            "sign in once by hand to clear it, then re-run."
        )


def _masked_mail_patterns(address: str) -> list[re.Pattern]:
    """
    Regexes for how Zoho masks a delivery address on the MFA chooser.

    Zoho shows "mr***********l@gm***.c**" rather than the address itself, and
    the number of asterisks tracks the length of what is hidden - so matching a
    literal mask would break for any other account. Anchoring on the two
    characters Zoho leaves visible either side of the "@" is what survives.

    Strict (whole address) first; the domain-only fallback covers the local
    part being rendered in a sibling node. The fallback is still specific
    enough not to match a phone option or a differently-domained address.
    """
    local, _, domain = address.partition("@")
    if not local or not domain:
        raise AutomationError(f"GMAIL_ADDRESS is not an email address: {address!r}")
    head, dom = re.escape(local[:2]), re.escape(domain[:2])
    return [
        re.compile(rf"{head}[\w*.+-]*@{dom}\*+\.", re.I),
        re.compile(rf"@{dom}\*+\.", re.I),
    ]


def _visible_option_texts(page: Page) -> list[str]:
    """Text of every visible clickable thing, for diagnosing a missed screen."""
    try:
        texts = page.evaluate(
            """() => Array.from(document.querySelectorAll(
                   'a,button,li,[role=button],[role=option],[onclick]'))
                 .filter(el => el.offsetWidth || el.offsetHeight || el.getClientRects().length)
                 .map(el => (el.innerText || '').trim())
                 .filter(t => t && t.length < 80)"""
        )
    except PlaywrightError:
        return []
    return list(dict.fromkeys(texts))[:20]  # de-duplicated, capped


def _choose_otp_delivery(page: Page, gmail_address: str, timeout: int = 8_000) -> bool:
    """
    Click the Gmail option if Zoho asks *where* to send the code.

    On an unrecognised device (every CI runner, since the IP is new each run)
    Zoho interposes a method chooser and sends nothing until one is picked.
    Skipping this screen means waiting out the OTP timeout for a mail that was
    never dispatched. Returns True if an option was clicked.
    """
    patterns = _masked_mail_patterns(gmail_address)
    deadline = time.monotonic() + timeout / 1000

    while True:
        # A recognised device goes straight through; don't spend the full
        # timeout waiting for a chooser that is never coming.
        if SIGNED_IN_URL_PATTERN.search(page.url):
            return False
        # Skip the chooser if the OTP box is already up - Zoho picked for us.
        if _first_visible(page, OTP_INPUT, timeout=0) is not None:
            return False

        for pattern in patterns:
            option = page.get_by_text(pattern).first
            try:
                if not option.is_visible():
                    continue
                log.info("MFA method chooser detected; selecting the Gmail address.")
                human_pause(page, "picking the delivery address")
                option.click()
                # Give Zoho a moment to actually dispatch the mail before the
                # OTP poll starts looking for it.
                page.wait_for_timeout(2_000)
                return True
            except PlaywrightError:
                continue  # nothing matching in the DOM yet

        if time.monotonic() >= deadline:
            return False
        page.wait_for_timeout(250)


def _await_otp_or_dashboard(page: Page, timeout: int = 45_000):
    """
    Wait for whichever comes first: the OTP prompt, or the signed-in page.

    Zoho asks for a code only sometimes - a recognised device sails straight
    through - so this races the two outcomes instead of assuming either. It
    returns the OTP field, or None if the sign-in already completed. A fixed
    sleep on the OTP field would either miss a slow prompt or waste that wait
    on every run that does not get one.
    """
    deadline = time.monotonic() + timeout / 1000
    while True:
        if SIGNED_IN_URL_PATTERN.search(page.url):
            return None
        otp_field = _first_visible(page, OTP_INPUT, timeout=0)
        if otp_field is not None:
            return otp_field
        if time.monotonic() >= deadline:
            # List what was actually on screen: the previous version of this
            # message sent us to failure.png to find out, which needs a human.
            options = _visible_option_texts(page)
            raise AutomationError(
                f"After signing in, neither the OTP prompt nor the dashboard "
                f"appeared within {timeout // 1000}s; still at {page.url}. "
                f"Visible options were: {options or 'none found'}. If one of "
                "those is a verification method, add it to _choose_otp_delivery; "
                "if an OTP box is visible in failure.png, add its selector to "
                "OTP_INPUT in bot.py."
            )
        page.wait_for_timeout(500)


def sign_in(page: Page, form_url: str) -> None:
    """Sign in to Zoho People, fetching an emailed OTP if Zoho asks for one."""
    env = require_env("ZOHO_EMAIL")
    zoho_email = env["ZOHO_EMAIL"]
    zoho_password = os.getenv("ZOHO_PASSWORD")

    log.info("Navigating to %s", form_url)
    human_pause(what="opening the sign-in page")
    page.goto(form_url, wait_until="domcontentloaded", timeout=60_000)

    # Harmless when FORM_URL already points at the accounts app; needed when it
    # points at a marketing page that gates the form behind a Sign In link.
    sign_in_link = _first_visible(page, ['a:has-text("Sign In")'], timeout=3_000)
    if sign_in_link is not None:
        log.info("Landing page detected; clicking Sign In.")
        human_pause(page, "clicking Sign In")
        sign_in_link.click()

    log.info("Entering email address...")
    email_field = _require_visible(page, EMAIL_INPUT, "email field")
    _fill_verified(page, email_field, zoho_email, "email address")
    next_button = _require_visible(page, NEXT_BUTTON, "Next button")
    human_pause(page, "clicking Next")
    next_button.click()

    # The password field is already in the DOM (and already reports visible) on
    # the email step, so it must not be touched until the email step is gone -
    # otherwise the fill lands on markup Zoho is about to re-render and is lost.
    _wait_hidden(page, EMAIL_INPUT, "email field")
    _check_for_captcha(page)

    # Password step. Passwordless accounts skip straight to the OTP screen, so
    # a missing password field is not by itself an error.
    password_field = _first_visible(page, PASSWORD_INPUT, timeout=10_000)
    if password_field is not None:
        if not zoho_password:
            raise AutomationError(
                "Zoho asked for a password but ZOHO_PASSWORD is not set."
            )
        log.info("Entering password...")
        _fill_verified(page, password_field, zoho_password, "password")
        sign_in_button = _require_visible(page, NEXT_BUTTON, "Sign in button")
        human_pause(page, "clicking Sign in")
        sign_in_button.click()
        _wait_hidden(page, PASSWORD_INPUT, "password field")
    else:
        log.info("No password field shown; assuming a passwordless/OTP-only login.")

    # Everything from here is timed against the moment the code was requested,
    # so a stale unread OTP mail can never be picked up.
    requested_at = datetime.now(timezone.utc)

    _check_for_captcha(page)

    # Only reachable when the OTP could actually be read; without Gmail
    # credentials there is no point picking a delivery method.
    gmail_address = os.getenv("GMAIL_ADDRESS")
    if gmail_address:
        if not _choose_otp_delivery(page, gmail_address):
            log.info("No MFA method chooser appeared.")

    otp_field = _await_otp_or_dashboard(page)
    if otp_field is not None:
        log.info("Zoho is asking for a one-time code.")
        otp = fetch_otp_from_gmail(
            timeout=int(os.getenv("OTP_TIMEOUT", "120")),
            sender=os.getenv("OTP_SENDER") or DEFAULT_OTP_SENDER,
            min_date=requested_at,
        )
        fill_otp(page, otp)

        # Some Zoho OTP screens auto-submit once the last digit lands; only
        # click if a button is still there to click.
        verify_button = _first_visible(page, VERIFY_BUTTON, timeout=3_000)
        if verify_button is not None:
            try:
                human_pause(page, "clicking Verify")
                verify_button.click(timeout=10_000)
            except PlaywrightError as exc:
                # The widget may have submitted itself the moment the last
                # digit landed, taking the button with it. Let the URL wait
                # below decide whether that actually worked.
                log.warning("Verify click did not land (%s); continuing.", exc)

        log.info("Waiting for the signed-in page...")
        try:
            page.wait_for_url(SIGNED_IN_URL_PATTERN, timeout=60_000)
        except PlaywrightTimeoutError as exc:
            raise AutomationError(
                f"The code was submitted but sign-in did not complete; still at "
                f"{page.url}. The code may have expired or been rejected. See "
                "failure.png."
            ) from exc
    else:
        log.info("No OTP prompt appeared; the account signed in directly.")

    # The dashboard URL can appear mid-redirect; if the session is not actually
    # valid Zoho bounces straight back to accounts. Let the page settle and
    # re-check, so success means "still on the dashboard", not "passed through".
    try:
        page.wait_for_load_state("domcontentloaded", timeout=30_000)
    except PlaywrightTimeoutError:
        pass  # a slow SPA asset must not fail an otherwise good sign-in
    if not SIGNED_IN_URL_PATTERN.search(page.url):
        raise AutomationError(
            f"Reached the dashboard but bounced back to {page.url} - the session "
            "was not established. See failure.png."
        )

    log.info("Signed in successfully: %s", page.url)


def randomize_start() -> None:
    """
    Spread scheduled runs out so they never fire at a predictable minute.

    Only *scheduled* runs wait. A manual dispatch has already served its delay:
    the console runs a cancellable countdown in the browser and only then calls
    the API, which records the elapsed jitter without sleeping again
    (`preWaited` in app/api/dispatch/route.ts). DISPATCH_DELAY_MS therefore
    reports a delay that is already spent — sleeping on it here would make the
    operator wait for it a second time.
    """
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule":
        already_waited = os.environ.get("DISPATCH_DELAY_MS", "")
        if already_waited.isdigit() and int(already_waited) > 0:
            log.info(
                "Manual dispatch already served %ss of jitter in the console; "
                "starting immediately.",
                int(already_waited) // 1000,
            )
        return

    max_seconds = scheduled_jitter_seconds()
    if max_seconds <= 0:
        log.info("Jitter is set to zero for today; starting immediately.")
        return

    delay_seconds = random.randint(0, max_seconds)
    log.info(
        "Scheduled run: sleeping %ds (window is 0-%d min) to randomise punch time...",
        delay_seconds,
        max_seconds // 60,
    )
    time.sleep(delay_seconds)


# Zoho People's "My Space" attendance widget. The timer is three sibling
# <span>s inside #totalInTime holding HH, MM and SS - reading innerText of the
# container yields "070447", so the spans are read individually.
TOTAL_TIME_SELECTOR = "#totalInTime"
ATT_STATUS_SELECTOR = "#att_status"

# Hours that must be logged before the bot is allowed to check out.
REQUIRED_MINUTES = 9 * 60 + 30


class AttendanceSnapshot:
    """What the attendance widget showed at one moment."""

    def __init__(self, status: Optional[str], seconds: Optional[int], raw: Optional[str]):
        self.status = status
        self.seconds = seconds
        self.raw = raw

    @property
    def minutes(self) -> Optional[int]:
        return None if self.seconds is None else self.seconds // 60

    def describe(self) -> str:
        if self.seconds is None:
            return f"status={self.status or 'unknown'}, time unreadable"
        h, rem = divmod(self.seconds, 3600)
        return f"status={self.status or 'unknown'}, logged {h}h {rem // 60}m ({self.raw})"


def _parse_timer_spans(page: Page) -> tuple[Optional[int], Optional[str]]:
    """
    Read #totalInTime's spans into (seconds, "HH:MM:SS").

    The widget renders the running total as one span per unit. Older tenants
    render a single text node instead, so a plain HH:MM(:SS) string is accepted
    as a fallback rather than failing the whole read.
    """
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


# My Space is an SPA: #totalInTime and #att_status are in the DOM, with an
# empty status and a 00:00:00 placeholder, *before* the XHR that fills them
# lands. wait_for(state="attached") is satisfied by that placeholder, so a read
# taken the moment the page arrives reports a confident 0h 0m for a day with
# hours on it - which also makes verify_checkout_eligibility abort a perfectly
# legitimate check-out. So the widget is polled until it fills in.
WIDGET_SETTLE_TIMEOUT = 20  # seconds


def _read_attendance_once(page: Page) -> AttendanceSnapshot:
    """One read of the widget, placeholders and all. Never raises."""
    status: Optional[str] = None
    try:
        status_el = page.locator(ATT_STATUS_SELECTOR).first
        status_el.wait_for(state="attached", timeout=10_000)
        status = (status_el.inner_text() or "").strip() or None
    except (PlaywrightError, PlaywrightTimeoutError):
        log.warning("Could not read %s.", ATT_STATUS_SELECTOR)

    try:
        seconds, raw = _parse_timer_spans(page)
    except (PlaywrightError, PlaywrightTimeoutError):
        log.warning("Could not read %s.", TOTAL_TIME_SELECTOR)
        seconds, raw = None, None

    return AttendanceSnapshot(status, seconds, raw)


def read_attendance(page: Page) -> AttendanceSnapshot:
    """
    Read the attendance widget once it has loaded its data.

    A zero timer is indistinguishable from the pre-load placeholder, so both
    are treated as "not settled yet" and polled. Waiting out the full timeout
    is not a failure - a genuine 0h 0m (nobody has checked in yet today) looks
    exactly the same, and is reported as such. Never raises: an unreadable
    widget is data the dashboard should see, not a crash.
    """
    deadline = time.monotonic() + WIDGET_SETTLE_TIMEOUT
    snapshot = _read_attendance_once(page)

    while not (snapshot.status and snapshot.seconds):
        if time.monotonic() >= deadline:
            log.info(
                "Widget still reads %s after %ds; taking it as final.",
                snapshot.describe(),
                WIDGET_SETTLE_TIMEOUT,
            )
            break
        page.wait_for_timeout(1_000)
        snapshot = _read_attendance_once(page)

    log.info("Attendance widget: %s", snapshot.describe())
    return snapshot


def report_attendance(snapshot: AttendanceSnapshot, source: str) -> None:
    """
    POST the snapshot to the dashboard so the console can show it.

    Best-effort by design: the punch is the job, and a dashboard that is down
    must not fail a run that already succeeded.
    """
    base = (os.getenv("CONTROL_CENTER_URL") or "").rstrip("/")
    if not base:
        log.info("CONTROL_CENTER_URL is not set; skipping the attendance report.")
        return

    body = json.dumps(
        {
            "status": snapshot.status,
            "loggedSeconds": snapshot.seconds,
            "rawTime": snapshot.raw,
            "source": source,
            "runId": os.getenv("DISPATCH_RUN_ID") or None,
        }
    ).encode("utf-8")

    request = urllib.request.Request(f"{base}/api/attendance", data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    secret = os.getenv("DISPATCH_SECRET")
    if secret:
        request.add_header("Authorization", f"Bearer {secret}")

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            log.info("Reported attendance to the dashboard (HTTP %s).", response.status)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            # The endpoint only rejects when it *has* a secret and ours does not
            # match, so this is always a config mismatch, never a transient fault.
            log.warning(
                "Dashboard rejected the attendance report (401). DISPATCH_SECRET "
                "%s here and must match the value the deployed console has; set "
                "the same string in both the GitHub repo secrets and the Amplify "
                "environment variables.",
                "is set" if secret else "is NOT set",
            )
        else:
            log.warning("Could not report attendance to the dashboard: %s", exc)
    except Exception as exc:  # noqa: BLE001 - reporting must never fail a run
        log.warning("Could not report attendance to the dashboard: %s", exc)


def verify_checkout_eligibility(page: Page) -> None:
    """
    Refuse to check out before 9.5 hours are logged.

    Fails *closed* only on a value we could actually read: an unreadable widget
    warns and proceeds, because blocking a legitimate check-out over a selector
    change would strand the operator checked in overnight.
    """
    snapshot = read_attendance(page)

    if snapshot.minutes is None:
        log.warning(
            "Could not read the logged time from %s; skipping the 9.5h check.",
            TOTAL_TIME_SELECTOR,
        )
        return

    total_minutes = snapshot.minutes
    hours, minutes = divmod(total_minutes, 60)
    log.info("Current logged time read as: %dh %dm (%d total minutes)", hours, minutes, total_minutes)

    if total_minutes < REQUIRED_MINUTES:
        raise AutomationError(
            f"SAFETY ABORT: Attempting to check out too early. "
            f"Only {hours}h {minutes}m elapsed. 9.5 hours ({REQUIRED_MINUTES}m) required."
        )
    log.info("Safety check passed: 9.5 hour requirement met.")


def run_status_check(page: Page) -> None:
    """Read the widget and report it. Nothing is punched."""
    log.info("STATUS_CHECK: reading the attendance widget...")
    snapshot = read_attendance(page)
    report_attendance(snapshot, source="STATUS_CHECK")

    if snapshot.seconds is None:
        # Loud, but not a failure: the dashboard now shows "unreadable" rather
        # than a stale number pretending to be current.
        log.warning("The widget was on screen but could not be parsed.")
        try:
            page.screenshot(path="failure.png", full_page=True)
            log.info("Saved failure.png for the unparsed widget.")
        except PlaywrightError:
            pass


def punch_attendance(page: Page) -> None:
    """Determine and execute the check-in or check-out action based on dashboard input or UTC time."""
    log.info("Determining attendance action...")
    
    dashboard_action = os.environ.get("DISPATCH_ACTION")
    
    if dashboard_action == "ACTION_ALPHA":
        target_text = "Check-in"
    elif dashboard_action == "ACTION_BETA":
        target_text = "Check-out"
    else:
        is_morning = datetime.now(timezone.utc).hour < 10
        target_text = "Check-in" if is_morning else "Check-out"
    
    log.info("Target action: %s", target_text)
    
    # --- NEW SAFETY CHECK ---
    if target_text == "Check-out":
        log.info("Executing 9.5-hour safety check before checking out...")
        verify_checkout_eligibility(page)
    # ------------------------
    
    try:
        button = page.locator(f"text='{target_text}'").first
        button.wait_for(state="visible", timeout=15_000)
        human_pause(page, f"clicking {target_text}")
        button.click()
        log.info("Successfully clicked %s!", target_text)
        page.wait_for_timeout(5_000)
        page.screenshot(path="success.png", full_page=True)
        log.info("Saved success.png")

        # The widget has just been updated by the punch, so this is the freshest
        # reading there is — the console shows it without a separate check.
        report_attendance(read_attendance(page), source=dashboard_action or "PUNCH")

        send_telegram_msg(
            f"✅ Successfully clicked {target_text} at "
            f"{_ist_now().strftime('%H:%M')} IST."
        )
    except PlaywrightTimeoutError:
        log.error("Could not find the '%s' button. You may already be punched in/out.", target_text)
        page.screenshot(path="failure.png")
        raise AutomationError(f"Failed to find or click the {target_text} button.")


# The dashboard's Neon database is the single source of truth for *when* the
# bot may run: the holiday calendar and the weekday matrix both live there and
# are edited in the UI. The bot asks rather than keeping its own copy, so there
# is no second list to drift out of sync.
IST = timezone(timedelta(hours=5, minutes=30))

# Falls back to the schedule matrix default when the dashboard is unreachable.
DEFAULT_JITTER_MINUTES = 25


def _ist_now() -> datetime:
    return datetime.now(IST)


def _dashboard_get(path: str) -> Optional[dict]:
    """
    GET a dashboard API endpoint. Returns None on any failure — callers decide
    what a missing answer means rather than having it decided for them here.
    """
    base = (os.getenv("CONTROL_CENTER_URL") or "").rstrip("/")
    if not base:
        return None

    request = urllib.request.Request(f"{base}{path}")
    request.add_header("Accept", "application/json")
    # Harmless today (the read endpoints are open) and already correct if those
    # endpoints are ever locked down to the shared secret.
    secret = os.getenv("DISPATCH_SECRET")
    if secret:
        request.add_header("Authorization", f"Bearer {secret}")

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - network, DNS, JSON, HTTP all equal here
        log.warning("Dashboard request %s failed: %s", path, exc)
        return None


def check_dashboard_policy() -> None:
    """
    Exit cleanly when the dashboard says today is not a running day.

    Only scheduled runs are subject to this. A manual dispatch is a deliberate
    human act — the API already permits it on an excepted day, and the console
    banners why — so it is never blocked here.

    Fails *open*: if the dashboard cannot be reached the run proceeds, because a
    missed attendance punch is the more expensive failure. The warning is loud
    and, when Telegram is configured, pushed.
    """
    if os.environ.get("GITHUB_EVENT_NAME") != "schedule":
        return

    today = _ist_now()
    today_str = today.strftime("%Y-%m-%d")

    exceptions = _dashboard_get("/api/exceptions?upcoming=1")
    if exceptions is None:
        log.warning(
            "Could not reach the dashboard; proceeding without the holiday check."
        )
        send_telegram_msg(
            f"⚠️ Bot ran on {today_str} without reaching the control center. "
            "Holiday and pause settings were not applied."
        )
        return

    # The API answers { "exceptions": [ { "exceptionDate": "YYYY-MM-DD", ... } ] }
    for entry in exceptions.get("exceptions", []):
        if entry.get("exceptionDate") == today_str:
            reason = entry.get("reason", "no reason given")
            log.info("Exception on %s (%s). Standing down.", today_str, reason)
            send_telegram_msg(f"🌴 {today_str} is marked '{reason}'. No punch today.")
            sys.exit(0)  # clean exit: a skipped day is a success, not a failure

    # The weekday matrix is the same switch the console's "Pause automation"
    # button writes to, so pausing there must also stop the cron.
    schedule = _dashboard_get("/api/schedule")
    if schedule is None:
        return

    weekday = today.strftime("%A")
    for row in schedule.get("schedule", []):
        if row.get("dayOfWeek") == weekday and row.get("enabled") is False:
            log.info("%s is disabled in the schedule matrix. Standing down.", weekday)
            send_telegram_msg(f"⏸️ Automation is paused for {weekday}. No punch today.")
            sys.exit(0)


def scheduled_jitter_seconds() -> int:
    """
    Maximum jitter for a scheduled run, in seconds, taken from the dashboard's
    slider for today. Hardcoding it here would recreate exactly the drift this
    function exists to remove: the console renders the firing window from
    `randomOffsetMinutes`, so that value has to be the one actually slept.
    """
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


def send_telegram_msg(text: str) -> None:
    """Send a silent push notification via Telegram."""
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    
    if not bot_token or not chat_id:
        return  # Silently skip if Telegram isn't configured
        
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": text, "disable_notification": "true"}).encode("utf-8")
    
    try:
        urllib.request.urlopen(url, data=data, timeout=5)
        log.info("Sent Telegram notification.")
    except Exception as exc:
        log.warning("Failed to send Telegram notification: %s", exc)

def run() -> None:
    """Drive one full automation run."""
    # A status check is a read: no holiday policy applies to looking at a page,
    # and jitter exists to hide *punch* times, so neither gate is relevant. The
    # operator is waiting on this one, so it starts immediately.
    status_check = os.getenv("DISPATCH_MODE", "PUNCH").upper() == "STATUS_CHECK"

    if not status_check:
        # Order matters: ask whether today is a running day *before* sleeping out
        # the jitter, or a holiday costs 25 minutes of runner time to discover.
        check_dashboard_policy()
        randomize_start()


    # `or` rather than a getenv default: the workflow sets FORM_URL from an
    # optional dispatch input, which is an empty string on scheduled runs.
    form_url = os.getenv("FORM_URL") or DEFAULT_FORM_URL
    headless = os.getenv("HEADLESS", "true").lower() != "false"

    log.info(
        "=== Automation run starting (%s) ===",
        "STATUS_CHECK" if status_check else "PUNCH",
    )
    started = time.monotonic()

    with sync_playwright() as playwright:
        log.info("Launching Chromium (headless=%s)...", headless)
        browser = playwright.chromium.launch(headless=headless)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            geolocation={"latitude": 18.506154, "longitude": 73.761416},
            permissions=["geolocation"],
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(30_000)

        try:
            sign_in(page, form_url)
            if status_check:
                run_status_check(page)
            else:
                punch_attendance(page)
        except Exception as exc:
            # A screenshot is the single most useful artifact when CI fails, and
            # every failure mode here is "the page did not look as expected".
            try:
                page.screenshot(path="failure.png", full_page=True)
                log.info("Saved failure.png")
            except PlaywrightError:
                log.warning("Could not capture failure.png.")
            if isinstance(exc, PlaywrightTimeoutError):
                raise AutomationError(f"Timed out interacting with the page: {exc}") from exc
            raise
        finally:
            context.close()
            browser.close()
            log.info("Browser closed.")

    log.info("=== Automation run finished in %.1fs ===", time.monotonic() - started)






if __name__ == "__main__":
    try:
        run()
    except AutomationError as exc:
        log.error("Run failed: %s", exc)
        sys.exit(1)
    except Exception:  # noqa: BLE001 - want the traceback in CI logs
        log.exception("Unexpected error.")
        sys.exit(1)