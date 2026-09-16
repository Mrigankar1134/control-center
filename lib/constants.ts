import type { ActionType, DayOfWeek } from "@/db/schema";

/** The only days the scheduler is ever allowed to run. */
export const WEEKDAYS: DayOfWeek[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

// Mirrors CHECKIN_CRON / CHECKOUT_CRON in infra/eventbridge/setup.sh, which is
// what actually fires. Nothing keeps the two in step automatically -- moving a
// window means editing both. The relay then adds 0-10 min on top of these.
export const DEFAULT_WINDOW_A_TIME = "09:03";
export const DEFAULT_WINDOW_B_TIME = "18:35";
export const DEFAULT_RANDOM_OFFSET_MINUTES = 10;
export const MIN_RANDOM_OFFSET_MINUTES = 0;
export const MAX_RANDOM_OFFSET_MINUTES = 30;

/** Upper bound on the jitter actually slept during a manual dispatch. */
export const MAX_MANUAL_DELAY_MS = 30_000;

export const LOG_PAGE_SIZE = 50;
export const LOG_HISTORY_SIZE = 200;
export const LOGS_POLL_INTERVAL_MS = 8_000;
