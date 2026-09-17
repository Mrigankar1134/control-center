"""Calls POST /api/dispatch on the dashboard. Invoked by EventBridge Scheduler.

This function exists for two reasons.

**Scheduler cannot call an HTTPS endpoint.** Its targets are a fixed list
(Lambda, SQS, SNS, Step Functions, ECS, ...) and API destinations are not on it
-- those belong to EventBridge *Rules*, which in turn have no timezone support,
so they cannot express "09:03 IST, Mon-Fri". Scheduler has the timezone, so the
cheapest way to keep it is to give it a target it understands.

**And it holds the jitter.** Scheduler's own FlexibleTimeWindow was supposed to
randomise the punch inside a ten-minute band, and it was configured to, but the
punch landed on the same minute every single day: this function was invoked at
09:07:43 +-2s on five consecutive weekdays. The window picks its offset once
per schedule and then keeps it -- it spreads load across schedules, not across
days. The window is now OFF, the cron fires on an exact minute, and the spread
comes from the sleep below, redrawn per invocation and printed to CloudWatch so
that "is the jitter working" stays a question with an answer.

Failures raise, so the schedule's RetryPolicy gets a chance. A 200 carrying
{"skipped": true} is not a failure: a paused weekday or a holiday exception is
the dashboard answering correctly.
"""

import json
import os
import random
import time
import urllib.error
import urllib.request

VALID_ACTIONS = ("ACTION_ALPHA", "ACTION_BETA")

DEFAULT_JITTER_SECONDS = 600  # 10 minutes, matching the old flexible window

# os.urandom per call, not a seeded PRNG. A warm container resumes the module's
# random state where the last invocation left it, and at two invocations a day
# that is exactly the failure being fixed here -- the same delay drawn every
# morning. SystemRandom cannot get stuck that way.
_rng = random.SystemRandom()


def _jitter_seconds() -> int:
    """Upper bound on the sleep, from JITTER_SECONDS. Never negative."""
    raw = (os.environ.get("JITTER_SECONDS") or "").strip()
    try:
        return max(0, int(raw)) if raw else DEFAULT_JITTER_SECONDS
    except ValueError:
        print(f"JITTER_SECONDS={raw!r} is not a number; using {DEFAULT_JITTER_SECONDS}")
        return DEFAULT_JITTER_SECONDS


def handler(event, _context):
    base = os.environ["DASHBOARD_URL"].rstrip("/")
    secret = os.environ["DISPATCH_SECRET"]

    action = (event or {}).get("action")
    if action not in VALID_ACTIONS:
        # A malformed schedule should be loud, not retried 5 times.
        raise ValueError(f"action must be one of {VALID_ACTIONS}, got {action!r}")

    # Sleep first, dispatch second: the point is to move the punch, and the
    # punch happens downstream of the POST. 0 is a legal draw -- landing on the
    # cron minute itself is part of the spread, not a bug.
    ceiling = _jitter_seconds()
    delay = _rng.randint(0, ceiling) if ceiling else 0
    if delay:
        print(f"dispatch {action}: jitter {delay}s of a possible {ceiling}s")
        time.sleep(delay)
    else:
        print(f"dispatch {action}: no jitter (ceiling {ceiling}s)")

    body = json.dumps(
        {"action": action, "source": "CRON", "bypassDelay": True}
    ).encode("utf-8")

    request = urllib.request.Request(f"{base}/api/dispatch", data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("x-dispatch-secret", secret)

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read().decode("utf-8")
            print(f"dispatch {action}: HTTP {response.status} {payload}")
            return {"status": response.status, "jitterSeconds": delay, "body": payload}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        print(f"dispatch {action}: HTTP {exc.code} {detail}")
        # 401/502 are worth retrying (rotated secret mid-deploy, GitHub blip).
        raise
    except urllib.error.URLError as exc:
        print(f"dispatch {action}: could not reach {base}: {exc}")
        raise
