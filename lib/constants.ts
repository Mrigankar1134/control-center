import type { ActionType, DayOfWeek } from "@/db/schema";

/** The only days the scheduler is ever allowed to run. */
export const WEEKDAYS: DayOfWeek[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

export const DEFAULT_WINDOW_A_TIME = "09:19";
export const DEFAULT_WINDOW_B_TIME = "19:17";
export const DEFAULT_RANDOM_OFFSET_MINUTES = 25;
export const MIN_RANDOM_OFFSET_MINUTES = 0;
export const MAX_RANDOM_OFFSET_MINUTES = 30;

/** Upper bound on the jitter actually slept during a manual dispatch. */
export const MAX_MANUAL_DELAY_MS = 30_000;

export const LOG_PAGE_SIZE = 50;
export const LOG_HISTORY_SIZE = 200;
export const LOGS_POLL_INTERVAL_MS = 8_000;

/**
 * Alpha and Beta are peers, not a priority order — they are two independent
 * workflows bound to the morning and evening windows. They may run
 * concurrently; the UI warns rather than blocks.
 */
export const ACTION_META: Record<
  ActionType,
  {
    label: string;
    shortLabel: string;
    cta: string;
    confirmCta: string;
    role: string;
    description: string;
    tooltip: string;
    accent: string;
    accentText: string;
    accentBorder: string;
    accentSurface: string;
    dot: string;
  }
> = {
  ACTION_ALPHA: {
    label: "Action Alpha",
    shortLabel: "Alpha",
    cta: "Run Action Alpha",
    confirmCta: "Run Action Alpha Now",
    role: "Morning workflow",
    description: "Bound to the morning dispatch window on enabled weekdays.",
    tooltip:
      "Runs the morning operational workflow. Scheduled automatically on each enabled weekday at the Alpha dispatch time.",
    accent: "text-alpha",
    accentText: "text-alpha",
    accentBorder: "border-alpha/30",
    accentSurface: "bg-alpha/10",
    dot: "bg-alpha",
  },
  ACTION_BETA: {
    label: "Action Beta",
    shortLabel: "Beta",
    cta: "Run Action Beta",
    confirmCta: "Run Action Beta Now",
    role: "Evening workflow",
    description: "Bound to the evening dispatch window on enabled weekdays.",
    tooltip:
      "Runs the evening operational workflow. Scheduled automatically on each enabled weekday at the Beta dispatch time.",
    accent: "text-beta",
    accentText: "text-beta",
    accentBorder: "border-beta/30",
    accentSurface: "bg-beta/10",
    dot: "bg-beta",
  },
};

/**
 * Every status carries a text label — colour is never the sole signal.
 */
export const STATUS_META = {
  QUEUED: {
    label: "Queued",
    text: "text-content-secondary",
    bg: "bg-white/[0.05]",
    border: "border-[var(--border-default)]",
    dot: "bg-content-muted",
  },
  EXECUTING: {
    label: "Running",
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/25",
    dot: "bg-warning",
  },
  SUCCESS: {
    label: "Success",
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/25",
    dot: "bg-success",
  },
  FAILED: {
    label: "Failed",
    text: "text-danger",
    bg: "bg-danger/10",
    border: "border-danger/25",
    dot: "bg-danger",
  },
} as const;

export const TRIGGER_SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Manual",
  CRON: "Scheduled",
  RETRY: "Retry",
  API: "API",
  SYSTEM: "System",
};

export const TIMEFRAMES = [
  { id: "today", label: "Today", days: 0 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export const VIEWS = [
  { id: "overview", label: "Overview" },
  { id: "dispatch", label: "Dispatch" },
  { id: "schedule", label: "Schedule" },
  { id: "executions", label: "Executions" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

/** Copy shown next to controls whose behaviour is not self-evident. */
export const TOOLTIPS = {
  jitter:
    "Adds a random delay of up to this many minutes before execution, so runs never fire at a predictable time.",
  immediate:
    "Skips the random execution delay for this run only. The configured schedule is unchanged.",
  automation:
    "Master control for scheduled runs. When paused, no weekday window will fire until it is resumed.",
  artifact:
    "Screenshot or log capture saved by the runner when a dispatch fails.",
  triggerSource:
    "How the run was started — manually from this console, by the scheduler, or by an external API call.",
  queueDelay:
    "How long the run waited for its random jitter before execution began.",
} as const;
