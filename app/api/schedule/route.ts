import { asc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { scheduleConfig } from "@/db/schema";
import type { DayOfWeek, ScheduleConfig } from "@/db/schema";
import {
  DEFAULT_RANDOM_OFFSET_MINUTES,
  DEFAULT_WINDOW_A_TIME,
  DEFAULT_WINDOW_B_TIME,
  MAX_RANDOM_OFFSET_MINUTES,
  MIN_RANDOM_OFFSET_MINUTES,
  WEEKDAYS,
} from "@/lib/constants";
import { isValidTime } from "@/lib/utils";
import { recordAudit } from "@/lib/audit";
import type { ScheduleRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEKDAY_ORDER = new Map(WEEKDAYS.map((day, index) => [day, index]));

// `excluded` is the row Postgres would have inserted had there been no conflict.
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

function isWeekday(value: unknown): value is DayOfWeek {
  return typeof value === "string" && WEEKDAY_ORDER.has(value as DayOfWeek);
}

function serialize(row: ScheduleConfig): ScheduleRow {
  return {
    dayOfWeek: row.dayOfWeek,
    enabled: row.enabled,
    windowATime: row.windowATime,
    windowBTime: row.windowBTime,
    randomOffsetMinutes: row.randomOffsetMinutes,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

function defaultRow(day: DayOfWeek): ScheduleRow {
  return {
    dayOfWeek: day,
    enabled: true,
    windowATime: DEFAULT_WINDOW_A_TIME,
    windowBTime: DEFAULT_WINDOW_B_TIME,
    randomOffsetMinutes: DEFAULT_RANDOM_OFFSET_MINUTES,
    updatedAt: null,
  };
}

/**
 * Classifies a write so the audit trail distinguishes a routine timing tweak
 * from arming or suspending the scheduler wholesale.
 */
function buildAuditEntry(
  saved: ScheduleRow[],
  previousByDay: Map<DayOfWeek, ScheduleConfig>,
  reason: string | null,
) {
  const changes = saved
    .map((row) => {
      const before = previousByDay.get(row.dayOfWeek);
      if (!before) return { day: row.dayOfWeek, before: null, after: row };
      const differs =
        before.enabled !== row.enabled ||
        before.windowATime !== row.windowATime ||
        before.windowBTime !== row.windowBTime ||
        before.randomOffsetMinutes !== row.randomOffsetMinutes;
      return differs
        ? {
            day: row.dayOfWeek,
            before: {
              enabled: before.enabled,
              windowATime: before.windowATime,
              windowBTime: before.windowBTime,
              randomOffsetMinutes: before.randomOffsetMinutes,
            },
            after: row,
          }
        : null;
    })
    .filter((change): change is NonNullable<typeof change> => change !== null);

  const toggled = changes.filter(
    (change) => change.before && change.before.enabled !== change.after.enabled,
  );

  // A write that flips every weekday's enabled flag the same way is a
  // master pause/resume, not an ordinary edit.
  const allSameDirection =
    toggled.length === saved.length &&
    saved.length > 0 &&
    saved.every((row) => row.enabled === saved[0].enabled);

  if (allSameDirection) {
    const resumed = saved[0].enabled;
    return {
      action: resumed
        ? ("AUTOMATION_RESUMED" as const)
        : ("AUTOMATION_PAUSED" as const),
      summary: resumed
        ? "Scheduled automation resumed for all weekdays"
        : "Scheduled automation paused for all weekdays",
      details: { reason, changes },
    };
  }

  const days = changes.map((change) => change.day);
  return {
    action: "SCHEDULE_UPDATED" as const,
    summary:
      days.length === 0
        ? "Schedule saved with no effective change"
        : `Schedule updated for ${days.join(", ")}`,
    details: { reason, changes },
  };
}

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(scheduleConfig)
      .orderBy(asc(scheduleConfig.id));

    const byDay = new Map(rows.map((row) => [row.dayOfWeek, serialize(row)]));

    // Always return all five weekdays, filling gaps with system defaults.
    const schedule = WEEKDAYS.map((day) => byDay.get(day) ?? defaultRow(day));

    return NextResponse.json({ schedule });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not read schedule from Neon: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // Accepts a single row or a batch: { dayOfWeek, ... } | { updates: [...] }
  const raw = body as Record<string, unknown>;
  const incoming = Array.isArray(raw.updates)
    ? (raw.updates as Record<string, unknown>[])
    : [raw];

  if (incoming.length === 0) {
    return NextResponse.json({ error: "No updates supplied." }, { status: 400 });
  }

  const values = [];
  for (const item of incoming) {
    if (!isWeekday(item.dayOfWeek)) {
      return NextResponse.json(
        {
          error: `\`dayOfWeek\` must be one of ${WEEKDAYS.join(
            ", ",
          )} — weekend automation is permanently disabled.`,
        },
        { status: 400 },
      );
    }

    const windowATime = item.windowATime ?? DEFAULT_WINDOW_A_TIME;
    const windowBTime = item.windowBTime ?? DEFAULT_WINDOW_B_TIME;

    if (typeof windowATime !== "string" || !isValidTime(windowATime)) {
      return NextResponse.json(
        { error: "`windowATime` must be an HH:mm string." },
        { status: 400 },
      );
    }
    if (typeof windowBTime !== "string" || !isValidTime(windowBTime)) {
      return NextResponse.json(
        { error: "`windowBTime` must be an HH:mm string." },
        { status: 400 },
      );
    }

    const offset = Number(
      item.randomOffsetMinutes ?? DEFAULT_RANDOM_OFFSET_MINUTES,
    );
    if (
      !Number.isFinite(offset) ||
      offset < MIN_RANDOM_OFFSET_MINUTES ||
      offset > MAX_RANDOM_OFFSET_MINUTES
    ) {
      return NextResponse.json(
        {
          error: `\`randomOffsetMinutes\` must be between ${MIN_RANDOM_OFFSET_MINUTES} and ${MAX_RANDOM_OFFSET_MINUTES}.`,
        },
        { status: 400 },
      );
    }

    values.push({
      dayOfWeek: item.dayOfWeek,
      enabled: item.enabled === undefined ? true : Boolean(item.enabled),
      windowATime,
      windowBTime,
      randomOffsetMinutes: Math.round(offset),
      updatedAt: new Date(),
    });
  }

  const reason =
    typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim()
      : null;

  try {
    // Snapshot the prior state so the audit entry can show before/after.
    const previous = await db.select().from(scheduleConfig);
    const previousByDay = new Map(previous.map((row) => [row.dayOfWeek, row]));

    const saved = await db
      .insert(scheduleConfig)
      .values(values)
      .onConflictDoUpdate({
        target: scheduleConfig.dayOfWeek,
        set: {
          enabled: sqlExcluded("enabled"),
          windowATime: sqlExcluded("window_a_time"),
          windowBTime: sqlExcluded("window_b_time"),
          randomOffsetMinutes: sqlExcluded("random_offset_minutes"),
          updatedAt: new Date(),
        },
      })
      .returning();

    const ordered = saved.sort(
      (a, b) =>
        (WEEKDAY_ORDER.get(a.dayOfWeek) ?? 0) -
        (WEEKDAY_ORDER.get(b.dayOfWeek) ?? 0),
    );

    await recordAudit(
      buildAuditEntry(ordered.map(serialize), previousByDay, reason),
    );

    return NextResponse.json({ schedule: ordered.map(serialize) });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not persist schedule to Neon: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
