"use client";

import { Activity, Gauge, Timer, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Segmented } from "@/components/ui/segmented";
import { Panel } from "@/components/ui/panel";
import { TIMEFRAMES, type TimeframeId } from "@/lib/constants";
import type { LogRow } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

interface Metrics {
  total: number;
  completed: number;
  successes: number;
  failures: number;
  successRate: number | null;
  avgDuration: number | null;
}

function windowStart(timeframe: TimeframeId, now: Date): number {
  if (timeframe === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = timeframe === "7d" ? 7 : 30;
  return now.getTime() - days * 86_400_000;
}

function computeMetrics(logs: LogRow[], since: number, until: number): Metrics {
  const scoped = logs.filter((log) => {
    const t = new Date(log.timestamp).getTime();
    return t >= since && t < until;
  });

  const completed = scoped.filter(
    (log) => log.status === "SUCCESS" || log.status === "FAILED",
  );
  const successes = completed.filter((log) => log.status === "SUCCESS").length;
  const durations = completed
    .map((log) => log.executionDurationMs)
    .filter((ms): ms is number => typeof ms === "number");

  return {
    total: scoped.length,
    completed: completed.length,
    successes,
    failures: completed.length - successes,
    successRate: completed.length
      ? Math.round((successes / completed.length) * 100)
      : null,
    avgDuration: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
  };
}

export function MetricsPanel({
  logs,
  loading,
  timeframe,
  onTimeframeChange,
}: {
  logs: LogRow[];
  loading: boolean;
  timeframe: TimeframeId;
  onTimeframeChange: (id: TimeframeId) => void;
}) {
  const { current, previous, label } = React.useMemo(() => {
    const now = new Date();
    const since = windowStart(timeframe, now);
    const span = now.getTime() - since;
    return {
      current: computeMetrics(logs, since, now.getTime() + 1),
      // Same-length preceding window, for an honest comparison.
      previous: computeMetrics(logs, since - span, since),
      label:
        TIMEFRAMES.find((t) => t.id === timeframe)?.label.toLowerCase() ??
        "period",
    };
  }, [logs, timeframe]);

  const comparisonLabel =
    timeframe === "today" ? "vs yesterday" : `vs previous ${label}`;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3">
        <h2 className="text-card-title font-semibold text-content-primary">
          Activity
        </h2>
        <Segmented
          options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))}
          value={timeframe}
          onChange={onTimeframeChange}
          layoutId="metrics-timeframe"
          ariaLabel="Metric timeframe"
          size="sm"
        />
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] [&>*:nth-child(-n+2)]:border-t-0 xl:grid-cols-4 xl:divide-y-0">
        <MetricTile
          icon={<Activity className="h-4 w-4" aria-hidden />}
          value={loading ? null : String(current.total)}
          label={timeframe === "today" ? "Executions today" : "Executions"}
          context={`${current.completed} completed`}
          delta={deltaOf(current.total, previous.total)}
          comparison={comparisonLabel}
        />
        <MetricTile
          icon={<Gauge className="h-4 w-4" aria-hidden />}
          value={
            loading
              ? null
              : current.successRate === null
                ? "—"
                : `${current.successRate}%`
          }
          label="Success rate"
          context={
            current.completed === 0
              ? "No completed runs"
              : `${current.successes} of ${current.completed} successful`
          }
          /* A rate from one or two runs is not yet meaningful. */
          caveat={
            current.completed > 0 && current.completed < 5
              ? `Based on ${current.completed} execution${current.completed === 1 ? "" : "s"}`
              : undefined
          }
          tone={
            current.successRate !== null && current.successRate < 80
              ? "warning"
              : "default"
          }
        />
        <MetricTile
          icon={<Timer className="h-4 w-4" aria-hidden />}
          value={loading ? null : formatDuration(current.avgDuration)}
          label="Average duration"
          context={
            current.completed === 0 ? "No completed runs" : "Per execution"
          }
          delta={
            current.avgDuration !== null && previous.avgDuration !== null
              ? deltaOf(current.avgDuration, previous.avgDuration, true)
              : null
          }
          comparison={comparisonLabel}
        />
        <MetricTile
          icon={<TriangleAlert className="h-4 w-4" aria-hidden />}
          value={loading ? null : String(current.failures)}
          label="Failures"
          context={
            current.failures === 0
              ? "All runs succeeded"
              : `In the last ${label}`
          }
          tone={current.failures > 0 ? "danger" : "success"}
        />
      </div>
    </Panel>
  );
}

function deltaOf(current: number, previous: number, lowerIsBetter = false) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { pct, good: lowerIsBetter ? pct < 0 : pct > 0 };
}

function MetricTile({
  icon,
  value,
  label,
  context,
  caveat,
  delta,
  comparison,
  tone = "default",
}: {
  icon: React.ReactNode;
  value: string | null;
  label: string;
  context: string;
  caveat?: string;
  delta?: { pct: number; good: boolean } | null;
  comparison?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 text-content-muted">
        {icon}
        <span className="text-support font-medium">{label}</span>
      </div>

      {value === null ? (
        <div className="mt-2.5 h-7 w-16 animate-pulse rounded bg-white/[0.05]" />
      ) : (
        <p
          className={cn(
            "tabular mt-2 font-mono text-metric font-semibold leading-none",
            tone === "default" && "text-content-primary",
            tone === "success" && "text-content-primary",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger",
          )}
        >
          {value}
        </p>
      )}

      <p className="mt-2 text-support text-content-muted">{context}</p>

      {caveat && (
        <p className="mt-1 text-meta text-content-disabled">{caveat}</p>
      )}

      {delta && comparison && (
        <p className="mt-1 text-meta">
          <span className={delta.good ? "text-success" : "text-warning"}>
            {delta.pct > 0 ? "+" : ""}
            {delta.pct}%
          </span>{" "}
          <span className="text-content-disabled">{comparison}</span>
        </p>
      )}
    </div>
  );
}
