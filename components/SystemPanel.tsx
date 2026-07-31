"use client";

import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  PauseCircle,
  PlayCircle,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, SummaryList } from "@/components/ui/dialog";
import { Panel } from "@/components/ui/panel";
import { InfoHint } from "@/components/ui/tooltip";
import { ACTION_META, TOOLTIPS } from "@/lib/constants";
import { useMounted, useTicker } from "@/lib/hooks";
import {
  formatCountdown,
  formatWhen,
  nextDispatch,
  resolvedTimeZone,
  type UpcomingDispatch,
} from "@/lib/schedule";
import type { ExceptionRow, LogRow, ScheduleRow } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

export function SystemPanel({
  schedule,
  exceptions = [],
  scheduleLoading,
  automationEnabled,
  activeDays,
  onSetAutomation,
  logs,
  degraded,
}: {
  schedule: ScheduleRow[];
  exceptions?: ExceptionRow[];
  scheduleLoading: boolean;
  automationEnabled: boolean;
  activeDays: number;
  onSetAutomation: (enabled: boolean) => void;
  logs: LogRow[];
  degraded: string | null;
}) {
  const mounted = useMounted();
  useTicker(30_000);

  const [confirmPause, setConfirmPause] = React.useState(false);

  const upcoming = React.useMemo(
    () => (mounted ? nextDispatch(schedule, new Date(), exceptions) : null),
    // Recomputed on each ticker frame via `mounted` + schedule identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule, exceptions, mounted],
  );

  const lastSuccess = logs.find((log) => log.status === "SUCCESS") ?? null;
  const running = logs.some((log) => log.status === "EXECUTING");

  return (
    <>
      <Panel className="overflow-hidden">
        <div className="grid divide-y divide-[var(--border-subtle)] lg:grid-cols-[1.1fr_1.3fr_1fr] lg:divide-x lg:divide-y-0">
          <HealthCell
            degraded={degraded}
            running={running}
            lastSuccess={lastSuccess}
          />

          <NextDispatchCell
            upcoming={upcoming}
            loading={scheduleLoading || !mounted}
            automationEnabled={automationEnabled}
          />

          <AutomationCell
            enabled={automationEnabled}
            activeDays={activeDays}
            loading={scheduleLoading}
            upcoming={upcoming}
            onRequestPause={() => setConfirmPause(true)}
            onResume={() => onSetAutomation(true)}
          />
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmPause}
        onOpenChange={setConfirmPause}
        title="Pause scheduled automation?"
        description="All weekday dispatch windows will stop firing until automation is resumed. Manual dispatch remains available."
        confirmLabel="Pause All Automation"
        confirmVariant="danger"
        cancelLabel="Keep Running"
        warning={
          upcoming
            ? `The next scheduled run — ${ACTION_META[upcoming.action].label} ${formatWhen(upcoming.at).toLowerCase()} — will be skipped.`
            : undefined
        }
        onConfirm={() => {
          onSetAutomation(false);
          setConfirmPause(false);
        }}
      >
        <SummaryList
          items={[
            { label: "Weekdays affected", value: `${activeDays} of 5` },
            {
              label: "Next skipped run",
              value: upcoming
                ? `${ACTION_META[upcoming.action].shortLabel} · ${formatWhen(upcoming.at)}`
                : "None scheduled",
            },
            { label: "Manual dispatch", value: "Remains available" },
          ]}
        />
      </ConfirmDialog>
    </>
  );
}

function Cell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

function HealthCell({
  degraded,
  running,
  lastSuccess,
}: {
  degraded: string | null;
  running: boolean;
  lastSuccess: LogRow | null;
}) {
  const state = degraded ? "degraded" : running ? "running" : "operational";

  const config = {
    operational: {
      tone: "success" as const,
      icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
      title: "System operational",
      detail: lastSuccess
        ? `Last successful run ${formatRelativeTime(lastSuccess.timestamp)}`
        : "No runs recorded yet",
    },
    running: {
      tone: "warning" as const,
      icon: <CircleDot className="h-4 w-4 animate-breathe" aria-hidden />,
      title: "Dispatch in progress",
      detail: "A run is currently executing",
    },
    degraded: {
      tone: "danger" as const,
      icon: <ShieldAlert className="h-4 w-4" aria-hidden />,
      title: "Service degraded",
      detail: degraded ?? "",
    },
  }[state];

  return (
    <Cell>
      <p className="eyebrow">System health</p>
      <div className="mt-2.5 flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            config.tone === "success" && "text-success",
            config.tone === "warning" && "text-warning",
            config.tone === "danger" && "text-danger",
          )}
        >
          {config.icon}
        </span>
        <div className="min-w-0">
          {/* Text carries the state; the colour and dot only reinforce it. */}
          <p className="text-section-title font-semibold text-content-primary">
            {config.title}
          </p>
          <p className="mt-1 text-support leading-relaxed text-content-muted">
            {config.detail}
          </p>
        </div>
      </div>
    </Cell>
  );
}

function NextDispatchCell({
  upcoming,
  loading,
  automationEnabled,
}: {
  upcoming: UpcomingDispatch | null;
  loading: boolean;
  automationEnabled: boolean;
}) {
  return (
    <Cell>
      <div className="flex items-center gap-1.5">
        <p className="eyebrow">Next scheduled dispatch</p>
        <CalendarClock className="h-3.5 w-3.5 text-content-disabled" aria-hidden />
      </div>

      {loading ? (
        <div className="mt-3 h-12 w-48 animate-pulse rounded bg-white/[0.04]" />
      ) : !automationEnabled ? (
        <p className="mt-2.5 text-body text-content-muted">
          Nothing scheduled — automation is paused.
        </p>
      ) : !upcoming ? (
        <p className="mt-2.5 text-body text-content-muted">
          No enabled weekday windows remain.
        </p>
      ) : (
        <div className="mt-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-section-title font-semibold text-content-primary">
              {ACTION_META[upcoming.action].label}
            </span>
            <Badge
              tone={upcoming.action === "ACTION_ALPHA" ? "alpha" : "beta"}
              size="sm"
            >
              {ACTION_META[upcoming.action].shortLabel}
            </Badge>
          </div>
          <p className="mt-1 text-body text-content-secondary">
            {formatWhen(upcoming.at)}{" "}
            <span className="text-content-muted">
              · starts in {formatCountdown(upcoming.msUntil)}
            </span>
          </p>
          <p className="mt-1 text-support text-content-muted">
            Expected window{" "}
            <span className="tabular font-mono">
              {upcoming.windowStart.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              –
              {upcoming.windowEnd.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>{" "}
            · {resolvedTimeZone()}
          </p>
        </div>
      )}
    </Cell>
  );
}

/**
 * The master switch is a protected control: pausing requires confirmation,
 * and the current state is stated in words with its consequence.
 */
function AutomationCell({
  enabled,
  activeDays,
  loading,
  upcoming,
  onRequestPause,
  onResume,
}: {
  enabled: boolean;
  activeDays: number;
  loading: boolean;
  upcoming: UpcomingDispatch | null;
  onRequestPause: () => void;
  onResume: () => void;
}) {
  return (
    <Cell className="flex flex-col justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <p className="eyebrow">Scheduled automation</p>
          <InfoHint content={TOOLTIPS.automation} label="About scheduled automation" />
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <Badge tone={enabled ? "success" : "warning"} dot>
            {enabled ? "Active" : "Paused"}
          </Badge>
          <span className="text-support text-content-muted">
            {enabled
              ? `${activeDays} of 5 weekdays enabled`
              : "No weekday windows will fire"}
          </span>
        </div>
      </div>

      <Button
        variant={enabled ? "secondary" : "primary"}
        size="sm"
        disabled={loading}
        onClick={enabled ? onRequestPause : onResume}
        icon={
          enabled ? (
            <PauseCircle className="h-4 w-4" aria-hidden />
          ) : (
            <PlayCircle className="h-4 w-4" aria-hidden />
          )
        }
        className="w-full sm:w-auto"
      >
        {enabled ? "Pause automation" : "Resume automation"}
      </Button>

      {!enabled && upcoming === null && (
        <p className="text-meta text-content-disabled">
          Resume to restore the weekday schedule.
        </p>
      )}
    </Cell>
  );
}
