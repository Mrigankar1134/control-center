"use client";

import * as React from "react";

import { Button, Card, CardHeader, Skeleton, TimeInput, Toggle } from "@/components/glass";
import type { DayOfWeek } from "@/db/schema";
import type { SaveState } from "@/lib/hooks";
import type { ScheduleRow } from "@/lib/types";
import { addMinutes } from "@/lib/utils";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  failed: "Not saved",
  offline: "Offline",
};

/**
 * One row per weekday: on/off, the two window start times, and the width of
 * the random offset. Edits auto-save through useSchedule's debounce, so there
 * is no save button — the header states the save state at all times instead.
 *
 * These times are what the console *shows*. The clock that actually fires is
 * the EventBridge schedule (infra/eventbridge/); the two are kept in step by
 * hand, so changing one here means re-running that script.
 */
export function ScheduleCard({
  schedule,
  loading,
  saveState,
  patchDay,
  patchMany,
  onRetry,
}: {
  schedule: ScheduleRow[];
  loading: boolean;
  saveState: SaveState;
  patchDay: (day: DayOfWeek, patch: Partial<ScheduleRow>) => void;
  patchMany: (days: DayOfWeek[], patch: Partial<ScheduleRow>, reason?: string) => void;
  onRetry: () => void;
}) {
  const allOn = schedule.length > 0 && schedule.every((row) => row.enabled);

  return (
    <Card>
      <CardHeader
        title="Schedule"
        subtitle="Weekday windows, in IST"
        right={
          <div className="flex items-center gap-2">
            <span
              className="text-caption"
              style={{
                color:
                  saveState === "failed" || saveState === "offline"
                    ? "var(--bad)"
                    : "var(--ink-faint)",
              }}
            >
              {SAVE_LABEL[saveState]}
            </span>
            {saveState === "failed" ? (
              <Button size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  patchMany(
                    schedule.map((row) => row.dayOfWeek),
                    { enabled: !allOn },
                    allOn ? "Paused from the console" : "Resumed from the console",
                  )
                }
              >
                {allOn ? "Pause all" : "Enable all"}
              </Button>
            )}
          </div>
        }
      />

      <div className="border-t hairline">
        {loading
          ? Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="ml-auto h-9 w-40" />
              </div>
            ))
          : schedule.map((row) => (
              <div
                key={row.dayOfWeek}
                className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-5 py-3 last:border-b-0 hairline"
              >
                <Toggle
                  checked={row.enabled}
                  label={`Automation on ${row.dayOfWeek}`}
                  onChange={(enabled) => patchDay(row.dayOfWeek, { enabled })}
                />
                <span
                  className="w-24 text-body font-medium"
                  style={{ color: row.enabled ? "var(--ink)" : "var(--ink-faint)" }}
                >
                  {row.dayOfWeek}
                </span>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <TimeInput
                    value={row.windowATime}
                    label={`Check-in time on ${row.dayOfWeek}`}
                    disabled={!row.enabled}
                    onChange={(windowATime) => patchDay(row.dayOfWeek, { windowATime })}
                  />
                  <span className="text-footnote text-ink-faint">→</span>
                  <TimeInput
                    value={row.windowBTime}
                    label={`Check-out time on ${row.dayOfWeek}`}
                    disabled={!row.enabled}
                    onChange={(windowBTime) => patchDay(row.dayOfWeek, { windowBTime })}
                  />
                  <label className="flex items-center gap-1.5 text-caption text-ink-faint">
                    ±
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={row.randomOffsetMinutes}
                      disabled={!row.enabled}
                      aria-label={`Random offset on ${row.dayOfWeek}, minutes`}
                      onChange={(event) =>
                        patchDay(row.dayOfWeek, {
                          randomOffsetMinutes: Math.max(
                            0,
                            Math.min(30, Number(event.target.value) || 0),
                          ),
                        })
                      }
                      className="glass-sunken tnum h-9 w-14 rounded-control px-2 text-center text-subhead text-ink outline-none disabled:opacity-40"
                    />
                    min
                  </label>
                </div>

                <p className="w-full text-caption text-ink-faint sm:w-auto sm:basis-full">
                  {row.enabled
                    ? `Fires ${row.windowATime}–${addMinutes(row.windowATime, row.randomOffsetMinutes)} and ${row.windowBTime}–${addMinutes(row.windowBTime, row.randomOffsetMinutes)}`
                    : "Paused — no window fires"}
                </p>
              </div>
            ))}
      </div>
    </Card>
  );
}
