"use client";

import {
  CalendarOff,
  CalendarPlus,
  History,
  PauseCircle,
  PlayCircle,
  Send,
  SlidersHorizontal,
} from "lucide-react";
import * as React from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { AuditAction } from "@/db/schema";
import { useAudit } from "@/lib/hooks";
import { cn, formatLogTimestamp, formatRelativeTime } from "@/lib/utils";

const ACTION_ICON: Record<AuditAction, React.ReactNode> = {
  SCHEDULE_UPDATED: <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />,
  AUTOMATION_PAUSED: <PauseCircle className="h-3.5 w-3.5" aria-hidden />,
  AUTOMATION_RESUMED: <PlayCircle className="h-3.5 w-3.5" aria-hidden />,
  MANUAL_DISPATCH: <Send className="h-3.5 w-3.5" aria-hidden />,
  EXCEPTION_ADDED: <CalendarOff className="h-3.5 w-3.5" aria-hidden />,
  EXCEPTION_REMOVED: <CalendarPlus className="h-3.5 w-3.5" aria-hidden />,
};

const ACTION_TONE: Record<AuditAction, string> = {
  SCHEDULE_UPDATED: "text-content-muted",
  AUTOMATION_PAUSED: "text-warning",
  AUTOMATION_RESUMED: "text-success",
  MANUAL_DISPATCH: "text-alpha",
  EXCEPTION_ADDED: "text-warning",
  EXCEPTION_REMOVED: "text-content-muted",
};

/**
 * Change history for high-impact operations. Attribution is intentionally
 * blank until an auth layer exists rather than inventing an actor.
 */
export function AuditTrail({ refreshKey }: { refreshKey: number }) {
  const { entries, loading } = useAudit(refreshKey);

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Change history"
        description="Schedule edits, automation pauses, and manual dispatches."
        icon={<History className="h-4 w-4" aria-hidden />}
      />

      {loading ? (
        <div className="space-y-3 px-5 py-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-white/[0.04]" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<History className="h-5 w-5" aria-hidden />}
          title="No changes recorded"
          description="Schedule edits and automation changes will be logged here."
        />
      ) : (
        <ul className="flex-1 divide-y divide-[var(--border-subtle)]">
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-5 py-3">
              <span
                className={cn("mt-0.5 shrink-0", ACTION_TONE[entry.action])}
              >
                {ACTION_ICON[entry.action]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body leading-snug text-content-primary">
                  {entry.summary}
                </p>
                <p className="mt-0.5 text-support text-content-muted">
                  <span title={formatLogTimestamp(entry.timestamp)}>
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                  {" · "}
                  {entry.actor ?? "not attributed"}
                  {typeof entry.details === "object" &&
                  entry.details &&
                  typeof entry.details.reason === "string"
                    ? ` · ${entry.details.reason}`
                    : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
