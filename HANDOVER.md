# Setting this up as your own

This repo punches you in and out of Zoho People on a schedule. It was built for
one person's account; everything specific to that person is now an environment
variable, so making it yours is configuration, not code editing.

Read [`README.md`](README.md) for how it works. This file is only the order to
do things in, and [what you actually change](#what-you-actually-change).

## What it is made of

| Piece | What runs there | Cost |
| --- | --- | --- |
| **GitHub** | The bot (`bot/bot.py`) as an Actions workflow | Actions minutes are billed on private repos |
| **Neon** | PostgreSQL: schedule, run logs, exceptions, audit | Free tier |
| **AWS Amplify** | The Next.js console, and `POST /api/dispatch` | Roughly free at this traffic |
| **AWS EventBridge + Lambda** | The clock that fires the punches | Free tier, comfortably |
| **Telegram** | Run notifications | Optional; skip it and nothing breaks |

You also need a **Gmail account with 2-Step Verification** — that is where Zoho
sends the OTP, and the bot reads it over IMAP.

> **On the Zoho account.** The bot signs in as you and punches as you. Whether
> that is acceptable is between you and your employer; nothing here disguises
> that it is automated, and the location it reports is one you set yourself.

## Order of operations

### 1. Your own repo

Push a clean copy rather than forking — a fork keeps a visible link to the
original and starts you on someone else's default branch:

```bash
git clone https://github.com/Mrigankar1134/control-center.git
cd control-center
rm -rf .git
git init -b main
git add -A && git commit -m "Initial commit"
git remote add origin https://github.com/<you>/<your-repo>.git
git push -u origin main
```

**Keep it private.** The workflow runs with your Zoho credentials in scope, and
the saved Zoho session is login-equivalent.

### 2. Database

Create a project at [neon.tech](https://neon.tech), copy the connection string,
then from the repo root:

```bash
npm install
cp .env.local.example .env.local     # paste DATABASE_URL into it
npm run db:push
npm run dev                          # http://localhost:3000 should render
```

### 3. Pick your two shared secrets now

You invent these once and paste them in several places:

```bash
# DISPATCH_SECRET - must be byte-identical in Amplify, GitHub, and the Lambda
openssl rand -hex 32

# DASHBOARD_PIN_HASH - SHA-256 of the 4-digit PIN you type in the console
printf '1234' | sha256sum        # macOS: shasum -a 256
```

### 4. Deploy the console (Amplify)

AWS Console → Amplify → *Create app* → connect your repo, branch `main`. It
detects Next.js and provisions SSR. Under **App settings → Environment
variables**, set every key from `.env.local.example`: `DATABASE_URL`,
`DISPATCH_SECRET`, `DISPATCH_PIN`, `DASHBOARD_PIN_HASH`, `GITHUB_TOKEN`,
`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_ID`, `GITHUB_REF`,
`NEXT_PUBLIC_ENVIRONMENT`.

`GITHUB_TOKEN` is a fine-grained PAT on **your** repo with **Actions: read and
write**. `GITHUB_OWNER` / `GITHUB_REPO` are yours, not `Mrigankar1134`.
`GITHUB_REF` must name a branch that exists on your repo — `main` if you
followed step 1. A wrong ref fails with a 422 and no run starts.

Note the deployed URL, e.g. `https://main.d3xxxx.amplifyapp.com`.

### 5. Bot secrets (GitHub)

*Settings → Secrets and variables → Actions* on your repo:

| Secret | Value |
| --- | --- |
| `ZOHO_EMAIL` / `ZOHO_PASSWORD` | Your Zoho People sign-in. Password may be blank if the account is OTP-only. |
| `GMAIL_ADDRESS` | The inbox the Zoho OTP lands in. |
| `GMAIL_APP_PASSWORD` | 16 characters from [App passwords](https://myaccount.google.com/apppasswords). Not your Google password. |
| `CONTROL_CENTER_URL` | The Amplify URL from step 4. |
| `DISPATCH_SECRET` | The same value you put in Amplify. |
| `STATE_KEY` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` — encrypts the saved Zoho session. Without it the bot repeats the full OTP sign-in every run. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional. Both or neither. |

### 6. Run it once by hand, locally

Do this before automating anything. It is the step that tells you whether the
sign-in, the OTP retrieval, and the geofence actually work for your account.

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv/Scripts/activate
pip install -r bot/requirements.txt
playwright install chromium
cp bot/.env.example .env      # then fill it in - see the table below
HEADLESS=false python bot/bot.py
```

`HEADLESS=false` shows you the browser, so you can see where it stops. The
usual first failures are the wrong data centre (`FORM_URL`) and an OTP that
never arrives (`OTP_SENDER` matching nothing).

### 7. The clock (EventBridge)

Only once a manual run has punched successfully:

```bash
aws configure           # or: aws login
DASHBOARD_URL=https://main.d3xxxx.amplifyapp.com \
DISPATCH_SECRET=<the same value again> \
PREFIX=<your-name>-punch \
./infra/eventbridge/setup.sh
```

`PREFIX` matters if the AWS account already hosts another copy — resources are
named `<PREFIX>-dispatch`, `<PREFIX>-checkin`, `<PREFIX>-checkout` and would
collide. Defaults are check-in 09:03 and check-out 18:35 IST, each delayed
0–10 minutes at random by the relay. To change them:

```bash
CHECKIN_CRON='cron(3 9 ? * MON-FRI *)' \
CHECKOUT_CRON='cron(35 18 ? * MON-FRI *)' \
JITTER_MINUTES=10 TZ_NAME=Asia/Kolkata \
DASHBOARD_URL=... DISPATCH_SECRET=... ./infra/eventbridge/setup.sh
```

Then tell the console the same thing, or its schedule matrix describes a day
that is not happening — nothing syncs these automatically:

```bash
curl -X POST "$DASHBOARD_URL/api/schedule" -H "Content-Type: application/json" \
  -d '{"reason":"initial setup","updates":[{"dayOfWeek":"Monday","enabled":true,
       "windowATime":"09:03","windowBTime":"18:35","randomOffsetMinutes":10}]}'
```

Repeat per weekday, or just set them in the console UI.

## What you actually change

Nothing in `app/`, `components/`, `lib/`, or `db/`. Only these:

| File | What to change |
| --- | --- |
| `.env.local` (copy of `.env.local.example`) | All of it. Local dev only — production reads Amplify's console variables, not this file. |
| Amplify environment variables | The same keys as `.env.local`. This is what the deployed console actually reads. |
| `.env` (copy of `bot/.env.example`) | Zoho + Gmail credentials, your location, your working day. Local bot runs only. |
| GitHub Actions secrets | The table in step 5. This is what the bot uses in CI. |
| `infra/eventbridge/setup.sh` | `CHECKIN_CRON`, `CHECKOUT_CRON`, `PREFIX` — or pass them as environment variables instead of editing the file. |

Every per-person value, and where it lives:

| Variable | Default | Change it when |
| --- | --- | --- |
| `PUNCH_LATITUDE` / `PUNCH_LONGITUDE` | Pune, `18.506154` / `73.761416` | **Always.** Zoho geofences the punch and the default is someone else's office. |
| `TIMEZONE_ID` / `LOCALE` | `Asia/Kolkata` / `en-IN` | You are outside India. A mismatch between these and your account is visible to Zoho. |
| `FORM_URL` | `accounts.zoho.in` | Your data centre is `.com`, `.eu`, `.com.au`. Wrong value means the sign-in page never matches. |
| `OTP_SENDER` | `zohoaccounts` | Substring match on the From header. On the `.in` data centre the real sender is `noreply@zohoaccounts.in`, so `"zoho.com"` matches nothing and the bot waits out its timeout. |
| `REQUIRED_MINUTES` | `570` (9h 30m) | Your employer requires a different day. The bot refuses to check out below this. |
| `CHECKIN_EARLIEST` / `CHECKIN_LATEST` | `08:00` / `10:30` | Your shift is not 9:00–18:30. A run arriving outside this window stands down. |
| `CHECKOUT_DEADLINE` | `20:00` | Never punch out past this. |
| `MAX_CHECKOUT_WAIT_MIN` | `40` | How long to hold a short check-out open, waiting for the requirement to be met. |

## Checking it worked

```bash
# Fires a real punch, through the same path the scheduler uses
curl -i -X POST "$DASHBOARD_URL/api/dispatch" \
  -H "x-dispatch-secret: $DISPATCH_SECRET" \
  -d '{"action":"ACTION_ALPHA","source":"CRON","bypassDelay":true}'
```

`200` with an `artifactUrl` means the workflow started. `401` means your
`DISPATCH_SECRET` does not match what Amplify holds. `200` with
`"skipped": true` means a gate stopped it, and the body says which.

After a scheduled morning:

```bash
gh run list --workflow automation.yml --limit 5 --json event,createdAt,conclusion
aws logs filter-log-events --log-group-name /aws/lambda/<PREFIX>-dispatch \
  --filter-pattern jitter --query 'events[].message' --output text
```

Different jitter numbers on different days means the randomisation is live.

## Things that will bite you

- **`DISPATCH_SECRET` lives in three places** — Amplify, GitHub Actions, and the
  Lambda's environment. Rotate it in all three, or the relay starts collecting
  401s at 09:03 and you find out via a missing punch.
- **`GITHUB_REF` must name a branch that exists.** The original repo defaults to
  `master`; if you set up on `main`, a leftover `master` here fails with a 422.
- **The console's schedule and the EventBridge crons are kept in step by hand.**
  Changing one does not change the other, and the console will happily show
  09:03 while AWS fires at 09:30.
- **`GET /api/attendance` can be hours stale.** It returns the last snapshot the
  bot reported, not live Zoho. Do not use it to decide whether a punch is safe.
- **The GitHub `schedule:` crons in `automation.yml` are still there** as a
  backup, and they arrive hours late. A late one stands down on its own but
  sends a "skipped a stale scheduled run" notification most afternoons. Delete
  the `schedule:` block to silence it.
