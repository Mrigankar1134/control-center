import type { ActionType, DayOfWeek } from "@/db/schema";
import { WEEKDAYS } from "@/lib/constants";
import type { ExceptionRow, ScheduleRow } from "@/lib/types";
import { addMinutes } from "@/lib/utils";

/** JS getDay() index for each schedulable weekday. Sun=0. */
const DAY_INDEX: Record<DayOfWeek, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
};

/** Local calendar key — must match how exception dates are entered. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function exceptionMap(
  exceptions: ExceptionRow[],
): Map<string, ExceptionRow> {
  return new Map(exceptions.map((e) => [e.exceptionDate, e]));
}

export interface UpcomingDispatch {
  action: ActionType;
  day: DayOfWeek;
  /** Nominal configured fire time. */
  at: Date;
  /** Earliest and latest the jitter allows it to actually fire. */
  windowStart: Date;
  windowEnd: Date;
  msUntil: number;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Expands the weekday matrix into concrete dispatch instants over the next
 * `days` days, ordered soonest first. Only enabled weekdays produce entries,
 * so weekends never appear, and any date carrying a holiday exception is
 * skipped entirely — this is the same rule the cron caller enforces.
 */
export function upcomingDispatches(
  schedule: ScheduleRow[],
  from: Date = new Date(),
  days = 7,
  exceptions: ExceptionRow[] = [],
): UpcomingDispatch[] {
  const byDay = new Map(schedule.map((row) => [row.dayOfWeek, row]));
  const skipped = exceptionMap(exceptions);
  const results: UpcomingDispatch[] = [];

  for (let offset = 0; offset <= days; offset++) {
    const date = new Date(from);
    date.setDate(date.getDate() + offset);

    const weekday = WEEKDAYS.find((day) => DAY_INDEX[day] === date.getDay());
    if (!weekday) continue; // Saturday / Sunday
    if (skipped.has(dateKey(date))) continue; // holiday / leave

    const row = byDay.get(weekday);
    if (!row || !row.enabled) continue;

    const windows: Array<{ action: ActionType; time: string }> = [
      { action: "ACTION_ALPHA", time: row.windowATime },
      { action: "ACTION_BETA", time: row.windowBTime },
    ];

    for (const { action, time } of windows) {
      const minutes = toMinutes(time);
      const at = new Date(date);
      at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

      const msUntil = at.getTime() - from.getTime();
      if (msUntil < 0) continue;

      const windowEnd = new Date(
        at.getTime() + row.randomOffsetMinutes * 60_000,
      );

      results.push({
        action,
        day: weekday,
        at,
        windowStart: at,
        windowEnd,
        msUntil,
      });
    }
  }

  return results.sort((a, b) => a.msUntil - b.msUntil);
}

export function nextDispatch(
  schedule: ScheduleRow[],
  from: Date = new Date(),
  exceptions: ExceptionRow[] = [],
): UpcomingDispatch | null {
  return upcomingDispatches(schedule, from, 8, exceptions)[0] ?? null;
}

export interface ScheduleConflict {
  day: DayOfWeek;
  severity: "warning" | "error";
  message: string;
}

/**
 * Surfaces configuration that would behave unexpectedly at run time:
 * overlapping jitter bands, or a window whose jitter pushes it past midnight.
 */
export function detectConflicts(schedule: ScheduleRow[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (const row of schedule) {
    if (!row.enabled) continue;

    const a = toMinutes(row.windowATime);
    const b = toMinutes(row.windowBTime);
    const jitter = row.randomOffsetMinutes;

    if (a === b) {
      conflicts.push({
        day: row.dayOfWeek,
        severity: "error",
        message: `Alpha and Beta are both set to ${row.windowATime}. They will contend for the same slot.`,
      });
      continue;
    }

    const [first, second] = a < b ? [a, b] : [b, a];
    if (first + jitter > second) {
      conflicts.push({
        day: row.dayOfWeek,
        severity: "warning",
        message: `±${jitter} min jitter makes the Alpha and Beta windows overlap. Reduce jitter or widen the gap.`,
      });
    }

    if (a + jitter >= 1440 || b + jitter >= 1440) {
      conflicts.push({
        day: row.dayOfWeek,
        severity: "warning",
        message: `Jitter pushes a window past midnight, so it may fire on the following day.`,
      });
    }
  }

  return conflicts;
}

/** "5h 48m", "12m 30s", "in a moment" */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return `${Math.ceil(ms / 1000)}s`;
}

/** "Today at 19:17" / "Tomorrow at 09:19" / "Mon 09:19" */
export function formatWhen(date: Date, from: Date = new Date()): string {
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round(
    (startOfDay(date) - startOfDay(from)) / 86_400_000,
  );

  if (dayDelta === 0) return `Today at ${time}`;
  if (dayDelta === 1) return `Tomorrow at ${time}`;
  return `${date.toLocaleDateString("en-GB", { weekday: "short" })} at ${time}`;
}

/** The IANA zone the browser is interpreting schedule times in. */
export function resolvedTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function timeZoneAbbreviation(date: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
    }).formatToParts(date);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export { addMinutes };
