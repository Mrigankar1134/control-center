# Neural Control

Monorepo: a Next.js dispatch console at the root, and the Playwright bot it dispatches in `bot/`.

```
control-center/
├── .github/workflows/automation.yml   # runs the bot (cron + workflow_dispatch)
├── bot/                               # Python + Playwright automation
│   ├── bot.py
│   ├── requirements.txt
│   └── .env.example
├── app/                               # Next.js App Router (UI + API routes)
├── components/  db/  lib/  public/
├── amplify.yml                        # AWS Amplify build spec (web only)
├── .env                               # bot secrets   (python-dotenv)
├── .env.local                         # web secrets   (Next.js)
└── package.json
```

**Separation of concerns:** Amplify sees `package.json` at the root, builds the dashboard, and ignores `bot/` entirely. GitHub Actions only ever executes `bot/`. The two meet at one seam: `POST /api/dispatch` calls the GitHub API to fire `automation.yml`.

Dashboard · Next.js 14 App Router · Neon PostgreSQL · Drizzle ORM · Tailwind · Framer Motion.
Bot · Python 3.10 · Playwright · IMAP OTP retrieval.

## Setup

```bash
# Web dashboard
npm install
cp .env.local.example .env.local   # then paste your Neon connection string
npm run db:push                    # or: npm run db:migrate
npm run dev                        # http://localhost:3000

# Bot (run from the repo root, so .env and failure.png resolve correctly)
python -m venv .venv && .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r bot/requirements.txt
playwright install chromium
cp bot/.env.example .env           # then fill in the Zoho + Gmail values
python bot/bot.py
```

## Deployment

**Web — AWS Amplify.** Connect the repo; Amplify detects Next.js and provisions SSR compute. `amplify.yml` writes the console's environment variables into `.env.production` during `preBuild`, because the SSR Lambda does not inherit them automatically. Set every variable listed in that file under *App settings → Environment variables*.

**Bot — GitHub Actions.** Nothing to deploy. `automation.yml` runs on the two weekday crons, or on demand via `workflow_dispatch`. Its secrets live in *Settings → Secrets and variables → Actions*, not in Amplify:

| Secret | Purpose |
| --- | --- |
| `ZOHO_EMAIL` / `ZOHO_PASSWORD` | Zoho People sign-in. |
| `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` | IMAP inbox the OTP arrives in. |
| `CONTROL_CENTER_URL` | Deployed dashboard base URL, e.g. `https://main.xxxx.amplifyapp.com`. Unset = the bot skips its policy check and always runs. |
| `DISPATCH_SECRET` | Sent as a bearer token on those reads. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Optional run notifications; both or neither. |

The dashboard triggers the workflow with a fine-grained PAT in `GITHUB_TOKEN` carrying **Actions: read and write** on this repo.

## The dashboard is the source of truth

The bot keeps no schedule of its own. On a **scheduled** run it asks the dashboard three questions before it does anything:

1. `GET /api/exceptions?upcoming=1` — is today a holiday? If so it exits 0 (a skipped day is a success, not a failure).
2. `GET /api/schedule` — is this weekday still `enabled`? "Pause automation" in the console has to stop the cron too, or the button is decorative.
3. The same response supplies `randomOffsetMinutes`, which becomes the jitter ceiling — so the window the overview renders (`09:19–09:44`) is the window actually slept, with no hardcoded constant to drift from it.

There is deliberately **no `SKIP_DATES` secret**. A second copy of the holiday list would silently disagree with the calendar UI.

Two consequences worth knowing:

- **Manual dispatch is never blocked.** A human tapping the button on an excepted day means it; the API permits it and the console banners why.
- **The check fails open.** If the dashboard is unreachable the run proceeds, because a missed attendance punch costs more than a punch on a holiday. It logs loudly and pushes a Telegram warning when configured. Invert this in `check_dashboard_policy()` if you would rather miss a punch than risk one.

`DISPATCH_DELAY_MS` is reported for correlation only — the console already served that delay in the browser before calling the API, so the bot must not sleep on it a second time.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL connection string (required). |
| `DISPATCH_SECRET` | Required on `POST /api/dispatch` when `source: "CRON"`. Also signs the unlock cookie issued by the security gate. |
| `DISPATCH_PIN` | 4-digit PIN arming the manual-dispatch security gate. Unset = gate disabled and the console says so. |
| `DISPATCH_WEBHOOK_URL` | Generic downstream webhook. Takes precedence over the GitHub driver. |
| `DISPATCH_WEBHOOK_SECRET` | Sent as `X-Dispatch-Secret` on webhook calls. |
| `GITHUB_TOKEN` / `GITHUB_OWNER` / `GITHUB_REPO` | GitHub dispatch driver credentials. |
| `GITHUB_WORKFLOW_ID` | When set, uses `workflow_dispatch`; otherwise `repository_dispatch`. |
| `GITHUB_REF` | Ref for `workflow_dispatch`. Must name a branch that actually exists — this repo's default is `master`, so `main` would fail with 422. |

With no downstream driver configured, dispatches are still recorded in Neon and reported as `SIMULATED` so the UI is usable before wiring the runner.

## API

### `POST /api/dispatch`
```json
{ "action": "ACTION_ALPHA", "bypassDelay": false }
```
Inserts an `EXECUTING` row, applies jitter (skipped when `bypassDelay`), calls the downstream driver, then updates the row to `SUCCESS` / `FAILED` with duration, error, and artifact URL. Returns `200` on success, `502` on downstream failure.

Cron callers add `"source": "CRON"` and must send `X-Dispatch-Secret: $DISPATCH_SECRET`.

### `GET /api/schedule`
Returns all five weekdays, backfilling defaults (`09:19` / `19:17` / ±25 min) for days with no row yet.

### `POST /api/schedule`
Accepts one row or `{ "updates": [...] }`. Upserts on `day_of_week`. Weekend days are rejected with `400`.

### `GET /api/logs`
Latest 50 records (override with `?limit=`, capped at 200), newest first.

### `GET /api/dispatch/stream` (Edge runtime)
Server-Sent Events feed for the console terminal. `?action=&runId=` scope the stream; frames arrive as `event: line` with `{ id, level, message, elapsedMs }`, closing with `event: done`.

### `/api/exceptions`
- `GET` — all exceptions ascending; `?upcoming=1` trims to today and later.
- `POST` — `{ "exceptionDate": "YYYY-MM-DD", "reason": "Sick leave" }`. Re-posting a date relabels it instead of erroring.
- `DELETE` — `?date=YYYY-MM-DD` or `?id=`.

### `/api/auth/verify`
- `GET` — `{ configured, unlocked, method, expiresAt }`.
- `POST` — `{ "method": "PIN", "pin": "1234" }` mints a 5-minute httpOnly unlock cookie. `{ "method": "WEBAUTHN" }` only *renews* an unlock a PIN already granted.
- `DELETE` — locks immediately.

## Bot resilience

The Playwright bot (`bot/bot.py`) hardens four failure modes that only surface in headless CI:

- **Blocking overlays.** `dismiss_modals()` runs after sign-in and again immediately before the punch click. It answers the "At Office / Work From Home" work-policy prompt (clicking the *office* option) and closes announcement/survey dialogs, looping up to 3 rounds because Zoho stacks them. A denylist prevents it from ever clicking Sign out / Delete. On a clean page it costs ~0.2 s and clicks nothing.
- **Network interception over DOM scraping.** An `AttendanceInterceptor` listens on `page.on("response")` for JSON whose URL matches `attendance|checkin|punch|timetracker|…` and deep-scans the payload for duration and status fields. This is the primary source for elapsed time; scraping `#totalInTime` is now the fallback, so a Zoho CSS change degrades instead of breaking. The snapshot logs which source it used (`[api]` / `[dom]`).
  - **The 9.5 h guard stays conservative:** when both sources produce a number, `verify_checkout_eligibility` uses the **smaller** one. Under-reading costs a retry; over-reading would punch out early.
- **Tracing.** `TRACE=on` (default in CI, off locally) records `trace.zip` with DOM snapshots, network calls, and console logs, uploaded as a workflow artifact for 14 days. Replay a failed 9 AM run with `playwright show-trace trace.zip`. `TRACE=failure` keeps it only on failure.
- **Headless detection.** `playwright-stealth` masks `navigator.webdriver`, plugin/codec lists, and the chrome runtime object; the context also pins `en-IN` / `Asia/Kolkata` to match the geolocation already being spoofed. The dependency is **optional at runtime** — an import failure logs a warning and the run continues unmasked rather than skipping a punch. Set `STEALTH=false` to disable.
  - If GitHub's datacenter ranges ever get blocked, set the `PROXY_SERVER` (+ `PROXY_USERNAME` / `PROXY_PASSWORD`) repo secrets to route browser traffic through a residential proxy. Unset = direct connection; only the proxy *host* is logged.

### Session reuse

After a successful landing the bot saves the browser's `storage_state` and reuses it next run, going straight to the dashboard and **skipping password and OTP entirely**. Zoho sessions typically live 7–30 days; stale or rejected state is discarded automatically and the run falls back to a normal sign-in, so the worst case is what happens today.

> **Security — this repo is public.** Session cookies are login-equivalent: whoever holds them is signed in as you, no OTP required. Actions cache entries on a public repo are readable by workflows from forked PRs, so the state blob is **encrypted with `STATE_KEY`** (a repo secret, which forked PRs never receive) before it is cached. **Without `STATE_KEY` the bot refuses to persist a session in CI at all** and just signs in with an OTP every run. Generate a key with:
>
> ```bash
> python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
> ```
>
> Making the repo private would be the stronger fix; the encryption is what makes it defensible while it is public. Rotating `STATE_KEY` invalidates the stored session (the next run signs in normally), so it is safe to rotate at any time.

Set `SESSION_REUSE=false` to force a full OTP sign-in, or `STATE_MAX_AGE_DAYS` to expire state sooner than the 7-day default.

### Deciding what to punch

Intent comes from the dispatched action, or on a cron run from the **time of day in IST** (before 14:00 → Check-in). Status is only ever used to *veto* a punch, never to choose one:

| Time | Status | Result |
| --- | --- | --- |
| Morning | `Yet to Check-in`, `Out`, unknown | Check-in |
| Morning | `Checked In` | skip — duplicate |
| Evening | `Checked In`, unknown | Check-out |
| Evening | `Out` | skip — duplicate |
| Evening | `Yet to Check-in`, `Absent` | skip — nothing to check out of |

`classify_status()` matches on word boundaries in a fixed order rather than testing substrings. This matters: **`"Yet to Check-in"` contains `"in"` and no `"out"`**, so the previous substring test read *not checked in* as *checked in* and would have aimed a morning cron at Check-out. Cron runs pass no `DISPATCH_ACTION`, so that was the live path. The 9.5 h guard would have caught it, but as a hard failure rather than a punch.

### Two guards that fail closed

- **The 9.5 h check-out guard refuses to guess.** If neither the API payload nor the widget yields an elapsed time, the bot **aborts instead of checking out**. It used to warn and proceed, which is how a 2 h 27 m day got punched out at 12:31 on 3 Aug 2026. An unverified check-out is a payroll problem; a missed one is a two-second manual fix. `ALLOW_UNVERIFIED_CHECKOUT=true` overrides it if you ever need to.
- **Stale scheduled runs stand down.** GitHub's cron is best-effort and delays of hours happen. The workflow passes `github.event.schedule`, and a run starting more than `MAX_SCHEDULE_LATENESS_MIN` (default 30) past its window exits without punching and says so on Telegram. Manual dispatch is never blocked, and a run with no cron info proceeds rather than being blocked blindly.

### Failure handling

- **Exit codes drive retries.** `0` success, `1` permanent, `75` transient. The workflow retries **only on 75** — DNS, proxy, runner network drops, or a late OTP mail — once, after a 5-minute backoff. A 9.5 h safety abort or a bad credential exits `1` and stops immediately; retrying those would just hammer Zoho's abuse filters. Retrying after a punch that already landed is safe, because the idempotency check re-reads the widget and skips the duplicate.
- **Telegram gets the screenshot.** Success and failure notifications use `sendPhoto` with `success.png` / `failure.png` attached, so you see what the bot saw without opening the CI logs. Built on stdlib multipart — no `requests` dependency. If the photo can't be sent for any reason it falls back to a text message rather than dropping the alert.
- **Locators survive obfuscation.** `_punch_button` tries seven strategies in order — exact ARIA role, fuzzy role (`Check In` / `CheckIn` / `check_in`), `aria-label`, legacy IDs, any clickable element with matching text, layout-relative (`:near(:text("Attendance"))`), then bare text. All strategies are polled with `count()` rather than blocking waits, so the whole sweep completes in well under a second on a hit and is bounded at 15 s on a miss. Word-boundary anchoring stops `Check-in` matching `Checking`, and the in/out directions never cross.

## Behaviour notes

- **Master automation toggle** writes `enabled` across all five weekday rows — `schedule_config.enabled` is the single source of truth the cron driver reads. There is no separate global flag to drift out of sync.
- **Schedule edits** apply optimistically and are debounced ~550 ms before hitting Neon; a half-typed time value is never persisted. The emerald "Synced" pill flashes on a confirmed write.
- **Weekend automation** is unrepresentable: the `day_of_week` enum has no Saturday or Sunday, and the API rejects them.
- **Execution logs** poll every 8 s. Clicking any row opens the inspection drawer; `FAILED` rows with an `artifactUrl` render the capture in a zoomable viewer.
- **Security gate** is enforced server-side, not just in the overlay: with `DISPATCH_PIN` set, `POST /api/dispatch` returns `403` for any manual run lacking a valid unlock cookie, so a hand-written `fetch` is refused too. PIN attempts are throttled (5 tries, then a 60 s lockout, in-process).
- **WebAuthn** proves device presence locally and cannot be verified server-side without a credential store, so it renews an existing PIN unlock rather than creating one. That boundary is deliberate — treat it as convenience, not as a second factor.
- **Holiday exceptions** suppress *scheduled* runs only: a `CRON` dispatch on a marked date returns `{ skipped: true }` without writing a log row, while manual dispatch stays available and the console banners why. Dates are compared as local calendar days on both sides.
- **PWA** installs from `/manifest.json` in standalone mode. The service worker (`public/sw.js`, registered in production only) is network-first for navigations and cache-first for immutable build output, and **never** caches `/api/*` or intercepts the SSE stream — stale schedule data or a replayed dispatch would be worse than an offline error. Bump `CACHE_VERSION` in `sw.js` to retire old caches.

## Scripts

| Script | Action |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build & serve |
| `npm run db:generate` | Generate SQL migrations from `db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (fast path for dev) |
| `npm run db:studio` | Drizzle Studio |
