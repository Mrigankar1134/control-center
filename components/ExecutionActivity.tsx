"use client";

import { ArrowRight, CheckCircle2, CircleDot, Inbox, XCircle } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ACTION_META } from "@/lib/constants";
import type { LogRow } from "@/lib/types";
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils";

/**
 * Recent activity sits high in the overview — the answer to "what just
 * happened?" should not require scrolling past the planner.
 */
export function ExecutionActivity({
  logs,
  loading,
  onViewAll,
  onInspect,
}: {
  logs: LogRow[];
  loading: boolean;
  onViewAll: () => void;
  onInspect: (log: LogRow) => void;
}) {
  const recent = logs.slice(0, 4);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Recent activity"
        description="The latest dispatches across both actions."
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={onViewAll}
            icon={<ArrowRight className="h-3.5 w-3.5" aria-hidden />}
          >
            View all
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded bg-white/[0.04]"
            />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" aria-hidden />}
          title="No executions yet"
          description="Run a manual dispatch or wait for the next scheduled window."
        />
      ) : (
        <ul className="flex-1 divide-y divide-[var(--border-subtle)]">
          {recent.map((log) => (
            <li key={log.id}>
              <button
                onClick={() => onInspect(log)}
                className="flex w-full min-h-[56px] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-hover/40 focus-ring"
              >
                <StatusGlyph status={log.status} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-content-primary">
                    {ACTION_META[log.actionType].label}
                  </p>
                  <p className="mt-0.5 text-support text-content-muted">
                    {formatRelativeTime(log.timestamp)}
                    {log.status === "FAILED" && log.errorMessage
                      ? " · view error"
                      : ""}
                  </p>
                </div>

                <span className="tabular shrink-0 font-mono text-support text-content-muted">
                  {formatDuration(log.executionDurationMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function StatusGlyph({ status }: { status: LogRow["status"] }) {
  const config = {
    SUCCESS: {
      icon: <CheckCircle2 className="h-4 w-4" aria-hidden />,
      className: "text-success",
      label: "Success",
    },
    FAILED: {
      icon: <XCircle className="h-4 w-4" aria-hidden />,
      className: "text-danger",
      label: "Failed",
    },
    EXECUTING: {
      icon: <CircleDot className="h-4 w-4 animate-breathe" aria-hidden />,
      className: "text-warning",
      label: "Running",
    },
    QUEUED: {
      icon: <CircleDot className="h-4 w-4" aria-hidden />,
      className: "text-content-muted",
      label: "Queued",
    },
  }[status];

  return (
    <span className={cn("shrink-0", config.className)}>
      {config.icon}
      <span className="sr-only">{config.label}</span>
    </span>
  );
}
