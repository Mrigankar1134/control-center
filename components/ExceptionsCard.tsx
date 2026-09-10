"use client";

import * as React from "react";

import { Button, Card, CardHeader, Empty, Skeleton } from "@/components/glass";
import type { ExceptionRow } from "@/lib/types";

/**
 * Dates the scheduler must skip. There is deliberately no second copy of this
 * list anywhere — POST /api/dispatch reads the same rows, so what is shown here
 * is what actually suppresses a run.
 */
export function ExceptionsCard({
  exceptions,
  loading,
  onSave,
  onRemove,
}: {
  exceptions: ExceptionRow[];
  loading: boolean;
  onSave: (date: string, reason: string) => Promise<boolean>;
  onRemove: (date: string) => Promise<boolean>;
}) {
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const upcoming = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return exceptions
      .filter((entry) => entry.exceptionDate >= today)
      .sort((a, b) => a.exceptionDate.localeCompare(b.exceptionDate));
  }, [exceptions]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!date || !reason.trim()) return;
    setSaving(true);
    const ok = await onSave(date, reason.trim());
    setSaving(false);
    if (ok) {
      setDate("");
      setReason("");
    }
  }

  return (
    <Card>
      <CardHeader title="Skip days" subtitle="Holidays and leave" />

      <form onSubmit={submit} className="flex flex-wrap gap-2 px-5 pb-4">
        <input
          type="date"
          value={date}
          aria-label="Date to skip"
          onChange={(event) => setDate(event.target.value)}
          className="glass-sunken tnum h-9 rounded-control px-2.5 text-subhead text-ink outline-none [color-scheme:light] dark:[color-scheme:dark]"
        />
        <input
          value={reason}
          aria-label="Reason"
          placeholder="Reason"
          maxLength={80}
          onChange={(event) => setReason(event.target.value)}
          className="glass-sunken h-9 min-w-0 flex-1 rounded-control px-3 text-subhead text-ink outline-none placeholder:text-ink-faint"
        />
        <Button type="submit" size="md" disabled={!date || !reason.trim() || saving}>
          {saving ? "Adding…" : "Add"}
        </Button>
      </form>

      <div className="border-t hairline">
        {loading ? (
          <div className="px-5 py-4">
            <Skeleton className="h-5 w-40" />
          </div>
        ) : upcoming.length === 0 ? (
          <Empty>Nothing skipped. Every enabled weekday will fire.</Empty>
        ) : (
          upcoming.map((entry) => (
            <div
              key={entry.exceptionDate}
              className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0 hairline"
            >
              <span className="tnum w-28 shrink-0 text-subhead font-medium text-ink">
                {entry.exceptionDate}
              </span>
              <span className="min-w-0 flex-1 truncate text-subhead text-ink-soft">
                {entry.reason}
              </span>
              <button
                type="button"
                onClick={() => void onRemove(entry.exceptionDate)}
                className="text-caption text-ink-faint underline-offset-2 hover:underline"
                style={{ color: "var(--ink-faint)" }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
