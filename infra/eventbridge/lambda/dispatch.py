"""Calls POST /api/dispatch on the dashboard. Invoked by EventBridge Scheduler.

This function exists for one reason: EventBridge Scheduler cannot call an HTTPS
endpoint. Its targets are a fixed list (Lambda, SQS, SNS, Step Functions, ECS,
...) and API destinations are not on it -- those belong to EventBridge *Rules*,
which in turn have no timezone support and no flexible time window, so they
cannot produce a randomised 09:05-09:15 punch. Scheduler has both, so the
cheapest way to keep them is to give it a target it understands.

Failures raise, so the schedule's RetryPolicy gets a chance. A 200 carrying
{"skipped": true} is not a failure: a paused weekday or a holiday exception is
the dashboard answering correctly.
"""

import json
import os
import urllib.error
import urllib.request

VALID_ACTIONS = ("ACTION_ALPHA", "ACTION_BETA")


def handler(event, _context):
    base = os.environ["DASHBOARD_URL"].rstrip("/")
    secret = os.environ["DISPATCH_SECRET"]

    action = (event or {}).get("action")
    if action not in VALID_ACTIONS:
        # A malformed schedule should be loud, not retried 5 times.
        raise ValueError(f"action must be one of {VALID_ACTIONS}, got {action!r}")

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
            return {"status": response.status, "body": payload}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        print(f"dispatch {action}: HTTP {exc.code} {detail}")
        # 401/502 are worth retrying (rotated secret mid-deploy, GitHub blip).
        raise
    except urllib.error.URLError as exc:
        print(f"dispatch {action}: could not reach {base}: {exc}")
        raise
