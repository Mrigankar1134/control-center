"use client";

import { CalendarClock, PauseCircle } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ACTION_META } from "@/lib/constants";
import { useMounted, useTicker } from "@/lib/hooks";
import { formatCountdown, formatWhen, upcomingDispatches } from "@/lib/schedule";
import type { ExceptionRow, ScheduleRow } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Forward view of the schedule so timing never has to be inferred. */
export function UpcomingTimeline({
  schedule,
  exceptions = [],
  automationEnabled,
  limit = 6,
  className,
}: {
  schedule: ScheduleRow[];
  exceptions?: ExceptionRow[];
  automationEnabled: boolean;
  limit?: number;
  className?: string;
}) {
  const mounted = useMounted();
  useTicker(30_000);

  // Excepted dates are absent here for the same reason they never fire.
  const upcoming = React.useMemo(
    () =>
      mounted
        ? upcomingDispatches(schedule, new Date(), 7, exceptions).slice(0, limit)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, exceptions, limit, mounted],
  );

  return (
    <Panel className={cn("flex h-full flex-col", className)}>
      <PanelHeader
        title="Upcoming schedule"
        description="Next dispatch windows across the coming week."
        icon={<CalendarClock className="h-4 w-4" aria-hidden />}
      />

      {!automationEnabled ? (
        <EmptyState
          tone="warning"
          icon={<PauseCircle className="h-5 w-5" aria-hidden />}
          title="Automation paused"
          description="No scheduled runs will fire until automation is resumed."
        />
      ) : !mounted ? (
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-white/[0.04]" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" aria-hidden />}
          title="Nothing scheduled"
          description="Enable at least one weekday to populate the timeline."
        />
      ) : (
        <ol className="flex-1 divide-y divide-[var(--border-subtle)]">
          {upcoming.map((item, index) => (
            <li
              key={`${item.action}-${item.at.toISOString()}`}
              className="flex items-center gap-3 px-5 py-2.5"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  item.action === "ACTION_ALPHA" ? "bg-alpha" : "bg-beta",
                  index === 0 && "ring-2 ring-offset-2 ring-offset-bg-primary",
                  index === 0 &&
                    (item.action === "ACTION_ALPHA"
                      ? "ring-alpha/40"
                      : "ring-beta/40"),
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-content-primary">
                  {formatWhen(item.at)}
                </p>
                <p className="text-support text-content-muted">
                  {ACTION_META[item.action].label} · in{" "}
                  {formatCountdown(item.msUntil)}
                </p>
              </div>
              {index === 0 && (
                <Badge tone="neutral" size="sm">
                  Next
                </Badge>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
