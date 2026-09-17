# The clock

EventBridge Scheduler fires the two daily punches. GitHub's `schedule:` event no
longer does, because it could not keep time.

## Why this moved off GitHub cron

`automation.yml` asks for `49 3 * * 1-5` (09:19 IST) and `47 13 * * 1-5`
(19:17 IST). What actually happened, measured from the run list (all UTC):

| Date | Morning fired | Late by | Evening fired | Late by |
| --- | --- | --- | --- | --- |
| 10 Sep 2026 | 08:25 | 4 h 36 m | — | — |
| 9 Sep 2026 | 08:24 | 4 h 35 m | 17:18 | 3 h 31 m |
| 8 Sep 2026 | 08:20 | 4 h 31 m | 17:32 | 3 h 45 m |
| 7 Sep 2026 | 08:39 | 4 h 50 m | 18:24 | 4 h 37 m |
| 4 Sep 2026 | 08:14 | 4 h 25 m | 17:07 | 3 h 20 m |
| 3 Sep 2026 | 08:18 | 4 h 29 m | 17:16 | 3 h 29 m |

Not a bad week — every weekday, for as long as the run history goes back. The
morning event consistently arrived after the 10:30 `CHECKIN_LATEST` window, so
`check_run_freshness()` did its job and stood down:

```
Scheduled run is 277 minutes late (cron '49 3 * * 1-5' targeted 09:19 IST,
now 13:56 IST) and the check-in window closed at 10:30. Standing down.
```

The delay is entirely in GitHub's schedule queue, which is documented as
best-effort and was evidently starving this repo. Three things rule out every
other explanation:

- `createdAt` equals `startedAt` on every run, so the *run itself* was not
  created until 08:25 — this is not a runner or queue-for-capacity delay.
- The cron expressions have not changed since 31 Jul 2026 (`git log -p --follow
  .github/workflows/automation.yml`), so nothing drifted.
- `workflow_dispatch` runs over the same period started within **seconds** of
  being requested.

That last point is the fix. Nothing in this repo could address the delay,
because it happens before the workflow exists — but a `workflow_dispatch` is
immediate, and `POST /api/dispatch` already existed to fire one on a cron
caller's behalf. So an external scheduler now holds the clock.

## The chain

```
EventBridge Schedule  (cron in Asia/Kolkata, exact minute)
  -> Lambda control-center-dispatch     (sleeps 0–10 min, then relays)
    -> POST /api/dispatch  { action, source: "CRON", bypassDelay: true }
      -> gates: weekday enabled? today an exception?
      -> triggerDownstream() -> GitHub workflow_dispatch  (starts in seconds)
        -> bot/bot.py
```

**Why a Lambda and not an API destination.** The obvious design — schedule
straight to an EventBridge API destination — does not work. Scheduler's targets
are a fixed list (Lambda, SQS, SNS, Step Functions, ECS, …) and API destinations
are not on it; passing one gives `ValidationException: Provided Arn is not in
correct format`. API destinations belong to EventBridge **Rules**, and Rules
have no `ScheduleExpressionTimezone`, so they cannot even express "09:03 IST".
Scheduler has it. The relay is the cheapest way to keep it: no dependencies, and
44 invocations a month sits well inside the Lambda free tier even with the sleep
described below.

Four AWS resources, all created by `setup.sh`:

| Resource | Name | What it is for |
| --- | --- | --- |
| Lambda | `control-center-dispatch` | Relays the punch to `POST /api/dispatch`. Holds `DASHBOARD_URL` and `DISPATCH_SECRET` as environment variables. Source in `lambda/dispatch.py`. |
| IAM role | `control-center-dispatch-lambda` | The function's execution role — CloudWatch Logs and nothing else. |
| IAM role | `control-center-scheduler` | Assumed by `scheduler.amazonaws.com`, may only `lambda:InvokeFunction` on that one function. |
| Schedules | `control-center-checkin`, `control-center-checkout` | `Asia/Kolkata`, Mon–Fri: check in 09:03, check out 18:35. Exact minutes — the relay adds the jitter. |

## Running it

```bash
DASHBOARD_URL=https://main.xxxx.amplifyapp.com \
DISPATCH_SECRET=<same value as the Amplify console variable> \
./infra/eventbridge/setup.sh
```

Needs the AWS CLI authenticated against the account that hosts the Amplify app.
Re-running is safe — every step is create-or-update — so this is also how you
change a time, the jitter, or a rotated secret. Overridable by environment:
`AWS_REGION`, `PREFIX`, `JITTER_MINUTES`, `TZ_NAME`, `CHECKIN_CRON`,
`CHECKOUT_CRON`. `JITTER_MINUTES` reaches the function as the `JITTER_SECONDS`
environment variable and also sets its timeout, so change it here rather than in
the Lambda console.

## Where the jitter lives, and why it moved

**In the relay, as a sleep.** `lambda/dispatch.py` draws `0..JITTER_SECONDS`
from `os.urandom` and sleeps it before POSTing, and prints the draw to
CloudWatch on every invocation.

It used to come from the schedule's `FlexibleTimeWindow`, which is the better
design on paper — it shifts the invocation itself rather than stalling a request
already in flight, and costs nothing. It just did not deliver, and the window
was configured correctly the whole time (`FLEXIBLE`, 10 minutes, both
schedules). CloudWatch has the explanation:

```
Fri 11 Sep  09:07:43        Fri 11 Sep  18:40:49
Mon 14 Sep  09:07:45        Mon 14 Sep  18:40:49
Tue 15 Sep  09:07:43        Tue 15 Sep  18:40:49
Wed 16 Sep  09:07:43        Wed 16 Sep  18:40:49
Thu 17 Sep  09:07:43
```

The window **does** apply an offset — 2m43s into the check-in window, 5m49s
into the check-out one — but it draws that offset once per schedule and then
reuses it. It spreads load across schedules, not across days, so a schedule
that never changes fires on the same second for life. A sleep in the relay is
worse on paper and observably random in practice, which is the trade.

Consequences worth knowing:

- **The cron moved to 09:03.** The sleep only ever pushes the punch later, so
  leaving it at 09:05 would have put the entire band after the time it used to
  land. Relay to recorded punch is under a minute — the ~3 minutes it looked
  like from the outside was the window's fixed offset, not the chain — so
  09:03 + 0–10 min puts the punch in **09:03–09:13**, centred on the old 09:08.
- **The window is `{"Mode":"OFF"}`.** One source of jitter, not two stacking
  into a band nobody can predict.
- **The function's timeout is `JITTER_SECONDS + 90`** (690 s at the default),
  because it now sleeps inside the invocation. Worst case is under 4,000 GB-s a
  month against a 400,000 GB-s free tier.
- **`bypassDelay: true` is still deliberate**, and the Lambda still always sends
  it. The route's own delay is capped at `MAX_MANUAL_DELAY_MS` (30 s), too short
  to be real jitter, and it burns the relay's duration anyway while it waits for
  the response — so the sleep happens before the POST, not during it.

**The console's `randomOffsetMinutes` still drives none of this.** The bot read
it from `GET /api/schedule` and slept for it, but only on a `schedule` event,
which no longer happens. Nothing reads the console value any more, so the two
are kept in step **by hand** — `schedule_config` should read `09:03` /
`18:35` / ±10 to match the crons above, and changing one means changing the
other. To move the windows:

```bash
CHECKIN_CRON='cron(3 9 ? * MON-FRI *)' CHECKOUT_CRON='cron(35 18 ? * MON-FRI *)' JITTER_MINUTES=10 DASHBOARD_URL=... DISPATCH_SECRET=... ./infra/eventbridge/setup.sh
```

Then update the console to agree, or the schedule matrix will describe a day
that is not happening:

```bash
curl -X POST "$DASHBOARD_URL/api/schedule" -H "Content-Type: application/json"   -d '{"reason":"...","updates":[{"dayOfWeek":"Monday","enabled":true,
       "windowATime":"09:03","windowBTime":"18:35","randomOffsetMinutes":10}]}'
```

### The 9.5 h is the bot's job, not the scheduler's

The two windows do not by themselves satisfy Zoho: check in at 09:13, punch out
at 18:35, and you are 8 minutes short. Nothing tries to make the scheduler
clever about this. `verify_checkout_eligibility()` already holds a short
check-out open for the shortfall — budget `MAX_CHECKOUT_WAIT_MIN` (40 min) —
reloads, re-reads the widget, and punches only once the requirement is actually
met. Worst case here is roughly an 11-minute hold ending around 18:47, well
inside both the budget and the 20:00 deadline.

This only works because the guard still runs on these runs. Manual dispatch
skips it (`DISPATCH_SOURCE=MANUAL`); EventBridge sends `source: "CRON"`, so it
does not.

## What still gates a scheduled run

The bot's own `check_dashboard_policy()` only runs on a `schedule` event, so it
no longer fires. Both of its gates moved into `POST /api/dispatch`, where they
now run *before* the workflow starts rather than inside it:

- **Is today an exception?** `exceptionForToday()` — already there.
- **Is this weekday enabled?** `scheduleArmedToday()` — added when the clock
  moved, or "Pause automation" in the console would have gone back to being
  decorative.

Both fail open on a database error, matching what the bot did: a missed punch
costs more than an extra one. Both apply to `source: "CRON"` only — a human
tapping the button on a paused day means it.

## The GitHub crons are still there

Deliberately. They are a free backup: if EventBridge ever fails to deliver, a
cron that happens to arrive inside its window still punches. A cron that arrives
after EventBridge already punched is harmless — `decide_punch()` re-reads the
widget and vetoes the duplicate with "already checked in" — and one that arrives
hours late still stands down on its own.

The cost is a Telegram "Skipped a stale scheduled run" most afternoons. To stop
that noise, drop the `schedule:` block from `.github/workflows/automation.yml`.

## Verifying

Fire one by hand (punches for real — it is the same path the scheduler uses):

```bash
curl -i -X POST "$DASHBOARD_URL/api/dispatch" \
  -H "x-dispatch-secret: $DISPATCH_SECRET" \
  -d '{"action":"ACTION_ALPHA","source":"CRON","bypassDelay":true}'
```

`200` with an `artifactUrl` means the workflow was triggered; `200` with
`"skipped": true` means a gate stopped it and says which; `401` means the
secret does not match; `502` means GitHub refused the dispatch.

**Do not use `GET /api/attendance` to decide whether a punch is safe.** It
returns the last snapshot the *bot* reported, so between runs it can be hours
stale — it said `In` at 18:40 on 10 Sep 2026 while Zoho actually said `Out`, and
a check-in dispatched on that basis punched for real. Only a live run knows the
current state.

Check what the schedules currently hold, and what the relay did:

```bash
aws scheduler get-schedule --name control-center-checkin
aws scheduler list-schedules --name-prefix control-center

# What the relay saw: the jitter it drew, and the dashboard's response body
aws logs tail /aws/lambda/control-center-dispatch --since 2d

# Invocation failures show up here, not in the dashboard logs.
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events --metric-name InvocationsFailedToBeSentToDlq \
  --start-time "$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S)" \
  --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" --period 86400 --statistics Sum
```

And confirm the delay is actually gone — `event` should read
`workflow_dispatch`, with `createdAt` within a minute or two of the window:

```bash
gh run list --workflow automation.yml --limit 10 \
  --json event,createdAt,conclusion
```

## Pausing or removing

```bash
# Stop both without deleting anything
aws scheduler update-schedule --name control-center-checkin  --state DISABLED ...
aws scheduler update-schedule --name control-center-checkout --state DISABLED ...

# Or pause from the dashboard instead, which is easier and audited:
#   uncheck the weekday in the schedule matrix, or add a calendar exception.

# Tear it all down
aws scheduler delete-schedule --name control-center-checkin
aws scheduler delete-schedule --name control-center-checkout
aws iam delete-role-policy --role-name control-center-scheduler \
  --policy-name control-center-invoke-dispatch-lambda
aws iam delete-role --role-name control-center-scheduler
aws lambda delete-function --function-name control-center-dispatch
aws iam detach-role-policy --role-name control-center-dispatch-lambda   --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name control-center-dispatch-lambda
```

Note that `update-schedule` is a full replacement, not a patch — it needs
`--schedule-expression`, `--flexible-time-window` and `--target` as well. Easier
to disable from the dashboard, or edit `setup.sh` and re-run it.
