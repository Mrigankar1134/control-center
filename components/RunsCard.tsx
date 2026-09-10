"use client";

import * as React from "react";

import { Button, Card, CardHeader, Dot, Empty, Skeleton, cx } from "@/components/glass";
import type { DispatchStatus } from "@/db/schema";
import type { LogRow } from "@/lib/types";
import { formatDuration, formatIstClock, formatRelativeTime } from "@/lib/utils";

const STATUS: Record<DispatchStatus, { label: string; tone: "ok" | "warn" | "bad" }> = {
  QUEUED: { label: "Queued", tone: "warn" },
  EXECUTING: { label: "Running", tone: "warn" },
  SUCCESS: { label: "Success", tone: "ok" },
  FAILED: { label: "Failed", tone: "bad" },
};

const ACTION_LABEL: Record<string, string> = {
  ACTION_ALPHA: "Check in",
  ACTION_BETA: "Check out",
};

/**
 * Recent dispatches, newest first. A failed run expands to show its error,
 * because that message is the whole reason to look at this list.
 */
export function RunsCard({
  logs,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  logs: LogRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);

  const visible = showAll ? logs.slice(0, 50) : logs.slice(0, 8);

  return (
    <Card>
      <CardHeader
        title="Runs"
        subtitle={error ? undefined : "Most recent first"}
        right={
          <Button size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {error ? (
        <p className="px-5 pb-4 text-footnote" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      ) : null}

      <div className="border-t hairline">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="px-5 py-3">
              <Skeleton className="h-5 w-48" />
            </div>
          ))
        ) : visible.length === 0 ? (
          <Empty>No dispatches recorded yet.</Empty>
        ) : (
          visible.map((log) => {
            const meta = STATUS[log.status];
            const isOpen = expanded === log.id;
            const source = typeof log.payload?.source === "string" ? log.payload.source : null;

            return (
              <div key={log.id} className="border-b last:border-b-0 hairline">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : log.id)}
                  className={cx(
                    "flex w-full items-center gap-3 px-5 py-3 text-left",
                    "transition-colors duration-150 hover:bg-glass-hover",
                  )}
                >
                  <Dot tone={meta.tone} live={log.status === "EXECUTING"} />
                  <span className="w-20 shrink-0 text-subhead font-medium text-ink">
                    {ACTION_LABEL[log.actionType] ?? log.actionType}
                  </span>
                  <span className="w-20 shrink-0 text-footnote text-ink-soft">{meta.label}</span>
                  <span className="tnum hidden w-24 shrink-0 text-footnote text-ink-faint sm:block">
                    {formatIstClock(log.timestamp)} IST
                  </span>
                  <span className="ml-auto tnum shrink-0 text-footnote text-ink-faint">
                    {formatRelativeTime(log.timestamp)}
                  </span>
                </button>

                {isOpen ? (
                  <dl className="grid gap-x-6 gap-y-1.5 px-5 pb-4 pt-0 text-footnote sm:grid-cols-2">
                    <Row label="Source">{source ? (source === "CRON" ? "Scheduled" : "Manual") : "—"}</Row>
                    <Row label="Duration">{formatDuration(log.executionDurationMs)}</Row>
                    <Row label="Driver">
                      {typeof log.payload?.driver === "string" ? log.payload.driver : "—"}
                    </Row>
                    <Row label="Run id">
                      <span className="tnum">{log.id.slice(0, 8)}</span>
                    </Row>
                    {log.errorMessage ? (
                      <div className="sm:col-span-2">
                        <dt className="text-caption uppercase tracking-wide text-ink-faint">
                          Error
                        </dt>
                        <dd
                          className="mt-1 whitespace-pre-wrap break-words font-mono text-caption leading-relaxed"
                          style={{ color: "var(--bad)" }}
                        >
                          {log.errorMessage}
                        </dd>
                      </div>
                    ) : null}
                    {log.artifactUrl ? (
                      <div className="sm:col-span-2 pt-1">
                        <a
                          href={log.artifactUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-caption underline underline-offset-2"
                          style={{ color: "var(--tint-in)" }}
                        >
                          Open the workflow run
                        </a>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {!loading && logs.length > 8 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="w-full border-t px-5 py-3 text-center text-footnote text-ink-faint hairline hover:bg-glass-hover"
        >
          {showAll ? "Show less" : `Show all ${Math.min(logs.length, 50)}`}
        </button>
      ) : null}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-caption uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="text-footnote text-ink-soft">{children}</dd>
    </div>
  );
}
