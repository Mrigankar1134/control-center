#!/usr/bin/env bash
#
# Provision the EventBridge Scheduler that fires the two daily punches.
#
# Why this exists: GitHub's `schedule:` event is best-effort, and on this repo
# it was arriving 3h20m-4h50m late every single weekday, so the morning cron
# landed after the 10:30 check-in window and correctly stood down. The runners
# were never the problem -- workflow_dispatch runs start within seconds. So the
# clock moves off GitHub and onto EventBridge, which calls POST /api/dispatch;
# that route fires a workflow_dispatch, which starts immediately.
#
# The chain is Schedule -> Lambda -> POST /api/dispatch. The Lambda is a relay
# and a dice roll, nothing more: Scheduler cannot call an HTTPS endpoint (API
# destinations are a target of EventBridge *Rules*, not Scheduler), and Rules
# have no timezone support, so they cannot express "09:03 IST". The relay also
# holds the jitter, because Scheduler's own flexible window was not producing
# one. See lambda/dispatch.py.
#
# Re-running this script is safe: everything is create-or-update.
#
# Required in the environment:
#   DASHBOARD_URL     https://master.xxxx.amplifyapp.com  (no trailing slash)
#   DISPATCH_SECRET   same value as the Amplify console variable
#
# Optional:
#   AWS_REGION        defaults to your configured region
#   PREFIX            resource name prefix, defaults to control-center
#   JITTER_MINUTES    width of the random delay the relay sleeps, defaults to 10
#
# Usage:
#   DASHBOARD_URL=https://... DISPATCH_SECRET=... ./infra/eventbridge/setup.sh

set -euo pipefail

PREFIX="${PREFIX:-control-center}"
TZ_NAME="${TZ_NAME:-Asia/Kolkata}"

# Check in 09:03, check out 18:35, each then delayed 0-JITTER_MINUTES by the
# relay itself. AWS cron is six fields:
# minute hour day-of-month month day-of-week year.
#
# The jitter deliberately does NOT come from Scheduler's FlexibleTimeWindow any
# more. That was the original design, the window was configured correctly
# (FLEXIBLE, 10 minutes, on both schedules), and it still produced the same
# punch minute every day. CloudWatch says why: the relay was invoked at
# 09:07:43, :45, :43, :43, :43 on five consecutive weekdays, and check-out at
# 18:40:49 on four. The window does apply an offset -- 2m43s into one, 5m49s
# into the other -- but it picks that offset once per schedule and keeps it,
# spreading load across schedules rather than across days. A schedule that does
# not change gets one minute for life.
#
# So the window is OFF (the cron fires on the exact minute) and
# lambda/dispatch.py draws the delay per invocation from os.urandom, printing
# it to CloudWatch so a stuck one would be visible next time.
#
# 09:03 rather than the old 09:05 because the sleep only ever runs the punch
# later. Relay to recorded punch is under a minute -- the three minutes it
# looked like was the window's fixed offset, not the chain -- so 09:03 + 0-10
# min puts the punch in 09:03-09:13, centred on the 09:08 it has been landing
# on.
#
# These windows do NOT by themselves satisfy the 9.5h Zoho requires: check in at
# 09:13, punch out at 18:35, and you are 8 minutes short. The bot closes that
# gap, not the scheduler -- verify_checkout_eligibility() holds a short
# check-out open for the shortfall (budget MAX_CHECKOUT_WAIT_MIN, 40 min),
# reloads, re-reads the widget, and punches only once the requirement is met.
# Worst case is roughly an 11-minute hold ending around 18:47.
#
# Keep these in step with window_a_time / window_b_time in schedule_config,
# which is what the console renders.
CHECKIN_CRON="${CHECKIN_CRON:-cron(3 9 ? * MON-FRI *)}"
CHECKOUT_CRON="${CHECKOUT_CRON:-cron(35 18 ? * MON-FRI *)}"
JITTER_MINUTES="${JITTER_MINUTES:-10}"

: "${DASHBOARD_URL:?set DASHBOARD_URL to the deployed dashboard base URL}"
: "${DISPATCH_SECRET:?set DISPATCH_SECRET to the same value the dashboard has}"

DASHBOARD_URL="${DASHBOARD_URL%/}"

FUNCTION_NAME="${PREFIX}-dispatch"
LAMBDA_ROLE_NAME="${PREFIX}-dispatch-lambda"
SCHED_ROLE_NAME="${PREFIX}-scheduler"
SCHED_POLICY_NAME="${PREFIX}-invoke-dispatch-lambda"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGION="${AWS_REGION:-$(aws configure get region)}"

say() { printf '\n==> %s\n' "$*"; }

# --- 0. Remove the first attempt -------------------------------------------
# An earlier version of this script pointed a schedule straight at an
# EventBridge API destination. Scheduler rejects that ARN outright, so the pair
# is dead weight; drop it rather than leave a connection holding the secret.
if aws events describe-api-destination --name "${PREFIX}-dispatch" >/dev/null 2>&1; then
  say "Deleting the unusable API destination ${PREFIX}-dispatch"
  aws events delete-api-destination --name "${PREFIX}-dispatch" >/dev/null
fi
if aws events describe-connection --name "${PREFIX}-dispatch" >/dev/null 2>&1; then
  say "Deleting the orphaned connection ${PREFIX}-dispatch"
  aws events delete-connection --name "${PREFIX}-dispatch" >/dev/null
fi

# --- 1. Lambda execution role ----------------------------------------------
# Logs only. Talking to the public internet needs no IAM permission.
read -r -d '' LAMBDA_TRUST <<TRUSTJSON || true
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
TRUSTJSON

if aws iam get-role --role-name "$LAMBDA_ROLE_NAME" >/dev/null 2>&1; then
  say "Role $LAMBDA_ROLE_NAME already exists"
else
  say "Creating role $LAMBDA_ROLE_NAME"
  aws iam create-role \
    --role-name "$LAMBDA_ROLE_NAME" \
    --assume-role-policy-document "$LAMBDA_TRUST" \
    --description "Execution role for the Neural Control dispatch relay" >/dev/null
fi

aws iam attach-role-policy \
  --role-name "$LAMBDA_ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null

LAMBDA_ROLE_ARN="$(aws iam get-role --role-name "$LAMBDA_ROLE_NAME" \
  --query Role.Arn --output text)"

# --- 2. The relay function -------------------------------------------------
say "Packaging lambda/dispatch.py"
# Build inside the repo, not mktemp: on Git Bash a /tmp path is not something
# the native aws.exe can open, and `python` may resolve it differently again.
# Everything below is handed the OS-native form so both agree.
BUILD_DIR="$HERE/.build"
mkdir -p "$BUILD_DIR"
ZIP="$BUILD_DIR/dispatch.zip"
SRC="$HERE/lambda/dispatch.py"
if command -v cygpath >/dev/null 2>&1; then
  ZIP="$(cygpath -w "$ZIP")"
  SRC="$(cygpath -w "$SRC")"
fi

python -c "
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[2], 'dispatch.py')
" "$ZIP" "$SRC"

# Fail here rather than inside the retry loop below, where a missing zip looks
# exactly like an IAM propagation delay and burns ten pointless attempts.
if [ ! -s "$HERE/.build/dispatch.zip" ]; then
  echo "Packaging produced no zip at $ZIP" >&2
  exit 1
fi
trap 'rm -rf "$HERE/.build"' EXIT

JITTER_SECONDS=$(( JITTER_MINUTES * 60 ))

# The function sleeps the jitter before it POSTs, so the timeout has to cover
# the whole sleep plus the request (45s) with room to spare, or a long draw is
# killed mid-nap and Scheduler retries a punch that was going to work.
#
# This costs Lambda duration, which the flexible window did not -- but at 128MB
# and 44 invocations a month the worst case is under 4,000 GB-s against a
# 400,000 GB-s free tier, which is a rounding error for jitter that works.
LAMBDA_TIMEOUT=$(( JITTER_SECONDS + 90 ))

ENV_JSON="{\"Variables\":{\"DASHBOARD_URL\":\"${DASHBOARD_URL}\",\"DISPATCH_SECRET\":\"${DISPATCH_SECRET}\",\"JITTER_SECONDS\":\"${JITTER_SECONDS}\"}}"

if aws lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1; then
  say "Updating function $FUNCTION_NAME"
  aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME"
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --environment "$ENV_JSON" \
    --timeout "$LAMBDA_TIMEOUT" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME"
else
  say "Creating function $FUNCTION_NAME"
  # IAM is eventually consistent; Lambda rejects a role it cannot see yet.
  created=0
  for _ in $(seq 1 10); do
    if aws lambda create-function \
      --function-name "$FUNCTION_NAME" \
      --runtime python3.12 \
      --role "$LAMBDA_ROLE_ARN" \
      --handler dispatch.handler \
      --zip-file "fileb://$ZIP" \
      --environment "$ENV_JSON" \
      --timeout "$LAMBDA_TIMEOUT" \
      --description "Relays the scheduled punch to POST /api/dispatch" >/dev/null 2>&1
    then
      created=1
      break
    fi
    echo "    role not visible to Lambda yet; retrying"
    sleep 5
  done
  if [ "$created" -ne 1 ]; then
    echo "Could not create $FUNCTION_NAME. Re-running the command for its error:" >&2
    aws lambda create-function \
      --function-name "$FUNCTION_NAME" \
      --runtime python3.12 \
      --role "$LAMBDA_ROLE_ARN" \
      --handler dispatch.handler \
      --zip-file "fileb://$ZIP" \
      --environment "$ENV_JSON" \
      --timeout "$LAMBDA_TIMEOUT" >&2
    exit 1
  fi
  aws lambda wait function-active --function-name "$FUNCTION_NAME"
fi

FUNCTION_ARN="$(aws lambda get-function --function-name "$FUNCTION_NAME" \
  --query Configuration.FunctionArn --output text)"

# --- 3. The role Scheduler assumes -----------------------------------------
# The SourceAccount condition stops the role being assumable by another
# account's scheduler if the ARN ever leaks.
read -r -d '' SCHED_TRUST <<TRUSTJSON || true
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "scheduler.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "aws:SourceAccount": "${ACCOUNT_ID}" } }
  }]
}
TRUSTJSON

if aws iam get-role --role-name "$SCHED_ROLE_NAME" >/dev/null 2>&1; then
  say "Updating trust policy on $SCHED_ROLE_NAME"
  aws iam update-assume-role-policy \
    --role-name "$SCHED_ROLE_NAME" \
    --policy-document "$SCHED_TRUST" >/dev/null
else
  say "Creating role $SCHED_ROLE_NAME"
  aws iam create-role \
    --role-name "$SCHED_ROLE_NAME" \
    --assume-role-policy-document "$SCHED_TRUST" \
    --description "Lets EventBridge Scheduler invoke the dispatch relay" >/dev/null
fi

read -r -d '' SCHED_PERMISSIONS <<PERMJSON || true
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "lambda:InvokeFunction",
    "Resource": "${FUNCTION_ARN}"
  }]
}
PERMJSON

say "Putting inline policy $SCHED_POLICY_NAME"
aws iam put-role-policy \
  --role-name "$SCHED_ROLE_NAME" \
  --policy-name "$SCHED_POLICY_NAME" \
  --policy-document "$SCHED_PERMISSIONS" >/dev/null

SCHED_ROLE_ARN="$(aws iam get-role --role-name "$SCHED_ROLE_NAME" \
  --query Role.Arn --output text)"

say "Letting the role propagate"
sleep 10

# --- 4. The two schedules --------------------------------------------------
# The Lambda sets bypassDelay:true on the POST. Without it the route sleeps up
# to MAX_MANUAL_DELAY_MS (30s) inside the request before calling GitHub, which
# is both too short to be real jitter and charged to Lambda duration anyway
# while the relay sits waiting for the response.
#
# FlexibleTimeWindow is OFF on purpose. It is the obvious place for the jitter
# and it is where the jitter used to live, but it produced the same 09:08 punch
# every day; the relay draws the delay itself now, so the schedule's job is
# just to fire on an exact minute.
target_json() {
  local action="$1"
  printf '{
  "Arn": "%s",
  "RoleArn": "%s",
  "Input": "{\\"action\\":\\"%s\\"}",
  "RetryPolicy": { "MaximumRetryAttempts": 5, "MaximumEventAgeInSeconds": 3600 }
}' "$FUNCTION_ARN" "$SCHED_ROLE_ARN" "$action"
}

put_schedule() {
  local name="$1" expression="$2" action="$3"
  local verb=create
  if aws scheduler get-schedule --name "$name" >/dev/null 2>&1; then
    verb=update
  fi

  say "Running ${verb}-schedule for $name ($expression $TZ_NAME; relay adds +0-${JITTER_MINUTES}m)"
  aws scheduler "${verb}-schedule" \
    --name "$name" \
    --schedule-expression "$expression" \
    --schedule-expression-timezone "$TZ_NAME" \
    --flexible-time-window '{"Mode":"OFF"}' \
    --target "$(target_json "$action")" \
    --state ENABLED \
    --description "Neural Control $action" >/dev/null
}

put_schedule "${PREFIX}-checkin"  "$CHECKIN_CRON"  ACTION_ALPHA
put_schedule "${PREFIX}-checkout" "$CHECKOUT_CRON" ACTION_BETA

say "Done. Region $REGION, account $ACCOUNT_ID."
aws scheduler list-schedules --name-prefix "$PREFIX" \
  --query 'Schedules[].{Name:Name,State:State}' --output table
