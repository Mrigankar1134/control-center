#!/usr/bin/env bash
#
# Entry point for crontab. One argument: ACTION_ALPHA (check in) or
# ACTION_BETA (check out).
#
#   crontab -e
#   15 9  * * 1-5  /path/to/control-center/bot/cron.sh ACTION_ALPHA
#   45 18 * * 1-5  /path/to/control-center/bot/cron.sh ACTION_BETA
#
# Why a wrapper and not `python bot/bot.py` straight from cron: cron runs with
# almost no environment. No PATH to your virtualenv, no working directory, no
# .env loaded, and no terminal to print a traceback to. Every one of those has
# to be established here or the job fails silently at 09:15 and the first you
# hear of it is a missing punch.
#
# The jitter is deliberate. Cron fires on the exact minute, so without it the
# punch lands at 09:15:00 every single day, which is a machine's signature
# rather than a person's. SCHEDULED_RUN=1 turns on randomize_start(), and
# DISPATCH_MAX_JITTER_SEC sets how wide it spreads.

set -euo pipefail

ACTION="${1:-}"
case "$ACTION" in
  ACTION_ALPHA|ACTION_BETA) ;;
  *)
    echo "usage: $(basename "$0") ACTION_ALPHA|ACTION_BETA" >&2
    exit 2
    ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# The virtualenv, if there is one. Cron's PATH is typically /usr/bin:/bin, so
# an unactivated venv means the system python, which has no playwright.
if [ -f "$REPO/.venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  . "$REPO/.venv/bin/activate"
fi

export DISPATCH_ACTION="$ACTION"
export DISPATCH_MODE=PUNCH
export DISPATCH_SOURCE=CRON

# Tells the bot a scheduler started this, not a person: jitter before punching,
# and honour the console's holiday / paused-weekday gates when one is
# configured. See _is_scheduled_run() in bot.py.
export SCHEDULED_RUN=1

# Seconds. 300 spreads a 09:15 cron across 09:15-09:20. Raising it past the
# width of your window means some days land outside it.
export DISPATCH_MAX_JITTER_SEC="${DISPATCH_MAX_JITTER_SEC:-300}"

# Cron sends stdout/stderr to a mail spool nobody reads. Keep a log instead,
# and keep the last 14 runs of it.
LOG_DIR="${LOG_DIR:-$REPO/logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d)-${ACTION}.log"

# Keep the last 14 logs. `|| true` throughout: on a first run the glob matches
# nothing, and BSD xargs (macOS) has no -r, so an empty list would call rm with
# no arguments. Neither is worth failing a punch over.
prune_logs() {
  ls -1t "$LOG_DIR"/*.log 2>/dev/null | tail -n +15 | while IFS= read -r old; do
    rm -f -- "$old" || true
  done
}
prune_logs || true

# set +e around the run: with -e a non-zero exit would abort the script here
# and never reach the status line or the exit below, so a failed punch would be
# indistinguishable in the log from a successful one that printed nothing.
{
  echo "=== $(date '+%F %T %Z')  $ACTION  (pid $$) ==="
  set +e
  python bot/bot.py
  status=$?
  set -e
  echo "=== exit $status ==="
  exit "$status"
} >>"$LOG_FILE" 2>&1
