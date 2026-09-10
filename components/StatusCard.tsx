"use client";

import * as React from "react";

import { Button, Card, CardHeader, Dot, Skeleton } from "@/components/glass";
import { useAttendance, useMounted, useTicker } from "@/lib/hooks";
import type { ExceptionRow, ScheduleRow } from "@/lib/types";
import { addMinutes, formatIstClock } from "@/lib/utils";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Today's IST date, as the parts the schedule is keyed on. */
function istToday() {
  const ist = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  return {
    day: DAY_NAMES[ist.getUTCDay()],
    date: `${yyyy}-${mm}-${dd}`,
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    clock: `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * The next window that will actually fire: today's if one is still ahead, else
 * the next enabled weekday. Holiday exceptions remove a date entirely.
 */
function nextWindow(
  schedule: ScheduleRow[],
  exceptions: ExceptionRow[],
): { label: string; when: string } | null {
  const today = istToday();
  const skipped = new Set(exceptions.map((entry) => entry.exceptionDate));
  const byDay = new Map(schedule.map((row) => [row.dayOfWeek, row]));

  for (let ahead = 0; ahead < 8; ahead += 1) {
    const probe = new Date(Date.now() + (5 * 60 + 30) * 60_000 + ahead * 86_400_000);
    const dayName = DAY_NAMES[probe.getUTCDay()];
    const dateKey = `${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, "0")}-${String(probe.getUTCDate()).padStart(2, "0")}`;

    const row = byDay.get(dayName as ScheduleRow["dayOfWeek"]);
    if (!row || !row.enabled || skipped.has(dateKey)) continue;

    for (const [time, label] of [
      [row.windowATime, "Check in"],
      [row.windowBTime, "Check out"],
    ] as const) {
      if (ahead === 0 && toMinutes(time) <= today.minutes) continue;
      const window = `${time}–${addMinutes(time, row.randomOffsetMinutes)}`;
      return {
        label,
        when: ahead === 0 ? `today ${window}` : `${dayName} ${window}`,
      };
    }
  }
  return null;
}

export function StatusCard({
  schedule,
  exceptions,
  loading,
  degraded,
}: {
  schedule: ScheduleRow[];
  exceptions: ExceptionRow[];
  loading: boolean;
  degraded: string | null;
}) {
  const attendance = useAttendance();
  const mounted = useMounted();
  useTicker(30_000); // keeps "next window" honest as the clock passes one

  const next = React.useMemo(
    () => (loading ? null : nextWindow(schedule, exceptions)),
    [schedule, exceptions, loading],
  );

  const status = attendance.snapshot?.status ?? null;
  const isIn = status ? /^(in|present|checked)/i.test(status) : false;

  return (
    <Card>
      <CardHeader
        title="Now"
        subtitle={mounted ? `${istToday().clock} IST · ${istToday().day}` : undefined}
        right={
          <Button
            size="sm"
            onClick={() => void attendance.check()}
            disabled={attendance.checking}
          >
            {attendance.checking ? "Reading Zoho…" : "Check Zoho"}
          </Button>
        }
      />

      <div className="grid gap-px overflow-hidden border-t hairline sm:grid-cols-3">
        <Figure label="Zoho status">
          {attendance.loading ? (
            <Skeleton className="h-6 w-24" />
          ) : status ? (
            <span className="inline-flex items-center gap-2">
              <Dot tone={isIn ? "ok" : "warn"} live={isIn} />
              {status}
            </span>
          ) : (
            <span className="text-ink-faint">Unknown</span>
          )}
        </Figure>

        <Figure label="Logged today">
          {attendance.loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <span className="tnum">{attendance.snapshot?.rawTime ?? "—"}</span>
          )}
        </Figure>

        <Figure label="Next window">
          {loading ? (
            <Skeleton className="h-6 w-28" />
          ) : next ? (
            <span className="text-body">
              {next.label}
              <span className="ml-1.5 text-footnote text-ink-faint">{next.when}</span>
            </span>
          ) : (
            <span className="text-ink-faint">None scheduled</span>
          )}
        </Figure>
      </div>

      <p className="px-5 py-3 text-caption text-ink-faint">
        {degraded ? (
          <span style={{ color: "var(--bad)" }}>{degraded}</span>
        ) : attendance.snapshot ? (
          // Saying when this was read matters: it is only ever as fresh as the
          // last bot run, and acting on a stale reading has bitten before.
          <>Read {formatIstClock(attendance.snapshot.capturedAt)} IST, by the last run — not live.</>
        ) : (
          <>No reading yet. “Check Zoho” starts a read-only run.</>
        )}
      </p>
    </Card>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-glass-sunken px-5 py-4">
      <p className="text-caption uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 text-headline font-medium text-ink">{children}</p>
    </div>
  );
}
