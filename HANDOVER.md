# Setting this up as your own (cron edition)

This branch punches you in and out of Zoho People from a **crontab on a machine
you control**. No GitHub Actions, no AWS, no dashboard required.

Everything specific to the person it was built for is an environment variable,
so making it yours is configuration, not code editing.

> **Which branch am I on?** This is `xyz`. The `main` branch runs the same bot
> from GitHub Actions on an AWS EventBridge clock, with a web console in front
> of it. If you want that instead, read `HANDOVER.md` there — it is a different
> and much longer setup.

## What you need

| | |
| --- | --- |
| **A machine that is awake on weekday mornings and evenings** | A always-on Linux box or a VPS is ideal. A laptop works if it is open at 09:15 and 18:45 — see [If the machine sleeps](#if-the-machine-sleeps). |
| **Python 3.10+** | For the bot and Playwright. |
| **A Gmail account with 2-Step Verification** | Zoho sends the sign-in OTP there and the bot reads it over IMAP. |
| **Your Zoho People credentials** | Email, and password unless the account is OTP-only. |

Optional: a Telegram bot token, for a message with a screenshot after each run.

> **On the Zoho account.** The bot signs in as you and punches as you. Whether
> that is acceptable is between you and your employer; nothing here disguises
> that it is automated, and the location it reports is one you set yourself.

## Setup

### 1. Get the code

```bash
git clone -b xyz https://github.com/Mrigankar1134/control-center.git
cd control-center
```

Only `bot/` matters here. The Next.js app at the root is the optional console;
you can ignore it entirely.

### 2. Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r bot/requirements.txt
playwright install chromium
playwright install-deps chromium      # Linux only; pulls the system libraries
```

`bot/cron.sh` looks for `.venv/bin/activate` at the repo root. If you put your
virtualenv somewhere else, either move it or edit that one line.

### 3. Configure

```bash
cp bot/.env.example .env      # .env at the REPO ROOT, not inside bot/
```

Fill in, at minimum:

```ini
ZOHO_EMAIL=you@company.com
ZOHO_PASSWORD=...             # blank only if the account is OTP-only
GMAIL_ADDRESS=you@gmail.com
GMAIL_APP_PASSWORD=...        # 16 chars, myaccount.google.com/apppasswords

# Zoho geofences the punch. The default is someone else's office in Pune.
PUNCH_LATITUDE=...
PUNCH_LONGITUDE=...

# Encrypts the saved Zoho session so you are not doing an OTP every run:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
STATE_KEY=...
```

Check `FORM_URL` against your data centre — the default is `accounts.zoho.in`,
and `.com` / `.eu` / `.com.au` accounts will never match the sign-in page
otherwise. If the OTP never arrives, `OTP_SENDER` is matching nothing; it is a
substring of the From header, and the `.in` sender is `noreply@zohoaccounts.in`.

### 4. Run it once by hand, watching

Do this before touching cron. It is the step that tells you whether the
sign-in, the OTP, and the geofence work for your account.

```bash
HEADLESS=false DISPATCH_ACTION=ACTION_ALPHA python bot/bot.py
```

A browser opens and you can see exactly where it stops.

### 5. Install the crontab

```bash
crontab -e
```

```cron
# Zoho punches. 09:15 and 18:45, each drifting 0-5 minutes (bot/cron.sh).
15 9  * * 1-5  /home/you/control-center/bot/cron.sh ACTION_ALPHA
45 18 * * 1-5  /home/you/control-center/bot/cron.sh ACTION_BETA
```

Use the **absolute path**, and check the file is executable
(`chmod +x bot/cron.sh`). `1-5` is Monday to Friday. Cron uses the machine's
local timezone — confirm it is yours with `timedatectl` or `date`.

That is the whole installation.

## Your timings

| | Cron fires | Punch lands | Why |
| --- | --- | --- | --- |
| Check in | 09:15 | **09:15 – 09:20** | `DISPATCH_MAX_JITTER_SEC=300` — 5 minutes of drift |
| Check out | 18:45 | **18:45 – 18:50** | same |

Cron fires on the exact minute, so without the jitter the punch would land at
09:15:00 every single day, which reads as a machine rather than a person.
`bot/cron.sh` sleeps a random 0–300 seconds before punching, redrawn each run.

**A 9h 30m day is what the check-out guard enforces** (`REQUIRED_MINUTES=570`).
On a bad pairing — in at 09:20, out attempted at 18:45 — you are 5 minutes
short, and the bot will hold the check-out open and punch at about 18:50 rather
than punch early. That hold is budgeted at 40 minutes
(`MAX_CHECKOUT_WAIT_MIN`), so it always resolves. If your employer wants a
different day, set `REQUIRED_MINUTES` in minutes.

To move the windows, change **both** the cron minute and, if you want a
different width, `DISPATCH_MAX_JITTER_SEC` in `bot/cron.sh`. A jitter wider
than your window means some days land outside it.

## What to change, and where

Nothing in `app/`, `components/`, `lib/`, or `db/` — that is the optional
console. Only these:

| File | What to change |
| --- | --- |
| `.env` (copy of `bot/.env.example`) | **Everything you configure lives here.** Zoho and Gmail credentials, coordinates, timezone, working day. |
| `crontab -e` | The two lines above, with your absolute path. |
| `bot/cron.sh` | Only to change the jitter width or the venv path. |

The per-person values:

| Variable | Default | Change it when |
| --- | --- | --- |
| `PUNCH_LATITUDE` / `PUNCH_LONGITUDE` | Pune, `18.506154` / `73.761416` | **Always.** Zoho geofences the punch. |
| `TIMEZONE_ID` / `LOCALE` | `Asia/Kolkata` / `en-IN` | You are outside India. A mismatch is visible to Zoho. |
| `FORM_URL` | `accounts.zoho.in` | Your data centre is `.com`, `.eu`, `.com.au`. |
| `OTP_SENDER` | `zohoaccounts` | The OTP never arrives — it matches nothing. |
| `REQUIRED_MINUTES` | `570` (9h 30m) | Your employer requires a different day. |
| `CHECKIN_EARLIEST` / `CHECKIN_LATEST` | `08:00` / `10:30` | Your shift is not a morning one. A run outside this stands down. |
| `CHECKOUT_DEADLINE` | `20:00` | Never punch out past this. |
| `MAX_CHECKOUT_WAIT_MIN` | `40` | How long to hold a short check-out open. |
| `DISPATCH_MAX_JITTER_SEC` | `300` (set by `cron.sh`) | You want a wider or narrower spread. |

## Checking it worked

```bash
# Exactly what cron will run, right now
./bot/cron.sh ACTION_ALPHA ; echo "exit $?"

tail -f logs/$(date +%F)-ACTION_ALPHA.log
```

Each run appends to `logs/YYYY-MM-DD-ACTION.log` and the last 14 are kept.
Look for the jitter line near the top:

```
Scheduled run: sleeping 143s...
```

Different numbers on different days means the randomisation is live. Exit `0`
is a punch; the log says what it decided and why.

## If the machine sleeps

Plain `cron` does not run jobs it missed while the machine was off — 09:15
simply does not happen. If that matters, either use a machine that stays on, or
switch to something that replays missed jobs:

- **systemd timer** with `Persistent=true` (Linux)
- **launchd** with `StartCalendarInterval` (macOS), which runs the job on wake

Either way the bot is safe about it: a replayed check-in that fires at 14:00
stands down on its own, because `decide_punch()` refuses anything outside
`CHECKIN_EARLIEST`..`CHECKIN_LATEST` (08:00–10:30). It will not punch you in
half a day late.

## The optional console

This branch does not need it, and everything above works without it. If you do
deploy the Next.js app (see `README.md`) and set `CONTROL_CENTER_URL` plus
`DISPATCH_SECRET` in `.env`, then a cron run additionally:

- reads `/api/exceptions` and **stands down on a holiday you marked**
- reads `/api/schedule` and **stands down on a weekday you paused**
- reports each punch back, so the console's logs and attendance are populated

Without `CONTROL_CENTER_URL` those checks are skipped silently and the bot just
punches. That is the expected setup here.

## Things that will bite you

- **Cron has almost no environment.** No `PATH` to your venv, no working
  directory, no `.env`. `bot/cron.sh` establishes all three — call it rather
  than calling `python bot/bot.py` from the crontab.
- **Cron mails output to a spool nobody reads.** The wrapper writes `logs/`
  instead. If a job seems to have vanished, look there first, then at
  `grep CRON /var/log/syslog`.
- **The machine's timezone is the schedule.** `15 9` means 09:15 wherever that
  box thinks it is, which is not necessarily where you are.
- **A saved Zoho session is login-equivalent.** `STATE_KEY` encrypts it; keep
  `.env` and `state/` off any machine you do not control, and out of git —
  both are already in `.gitignore`.
- **Playwright needs system libraries on a fresh Linux box.** If Chromium fails
  to launch, you skipped `playwright install-deps chromium`.
