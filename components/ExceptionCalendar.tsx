"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import * as React from "react";
import { DayPicker } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { dateKey } from "@/lib/schedule";
import type { ExceptionRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUICK_REASONS = ["Public holiday", "Annual leave", "Sick leave", "WFH"];
const MAX_REASON_LENGTH = 80;

/** Parses YYYY-MM-DD as a *local* date — `new Date(str)` would shift it by TZ. */
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function longDate(key: string): string {
  return parseDateKey(key).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Holiday and leave exceptions. A marked date suppresses every scheduled
 * window on that day; manual dispatch is deliberately still permitted, since
 * an exception describes the routine, not a lockout.
 */
export function ExceptionCalendar({
  exceptions,
  loading,
  error,
  onSave,
  onRemove,
}: {
  exceptions: ExceptionRow[];
  loading: boolean;
  error: string | null;
  onSave: (exceptionDate: string, reason: string) => Promise<boolean>;
  onRemove: (exceptionDate: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = React.useState<Date | undefined>();
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const reasonInput = React.useRef<HTMLInputElement | null>(null);

  const byDate = React.useMemo(
    () => new Map(exceptions.map((e) => [e.exceptionDate, e])),
    [exceptions],
  );

  const markedDays = React.useMemo(
    () => exceptions.map((e) => parseDateKey(e.exceptionDate)),
    [exceptions],
  );

  const selectedKey = selected ? dateKey(selected) : null;
  const existing = selectedKey ? byDate.get(selectedKey) : undefined;

  // Tapping an already-marked day edits its label rather than starting blank.
  React.useEffect(() => {
    setReason(existing?.reason ?? "");
    if (!selected) return;
    const timer = setTimeout(() => reasonInput.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [selected, existing]);

  const today = React.useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);

  const upcoming = React.useMemo(() => {
    const key = dateKey(today);
    return exceptions
      .filter((entry) => entry.exceptionDate >= key)
      .sort((a, b) => a.exceptionDate.localeCompare(b.exceptionDate));
  }, [exceptions, today]);

  async function save() {
    const label = reason.trim();
    if (!selectedKey || !label || saving) return;
    setSaving(true);
    const ok = await onSave(selectedKey, label);
    setSaving(false);
    if (ok) {
      setSelected(undefined);
      setReason("");
    }
  }

  async function remove(key: string) {
    setRemoving(key);
    await onRemove(key);
    setRemoving(null);
    if (key === selectedKey) setSelected(undefined);
  }

  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Holiday & leave exceptions"
        description="Dates marked here are skipped by the scheduler. Manual dispatch still works."
        icon={<CalendarOff className="h-4 w-4" aria-hidden />}
      />

      {error && (
        <p
          role="alert"
          className="border-b border-danger/20 bg-danger/[0.07] px-5 py-2.5 text-support text-danger"
        >
          {error}
        </p>
      )}

      <div className="px-5 py-4">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={setSelected}
          showOutsideDays
          weekStartsOn={1}
          disabled={{ before: today }}
          modifiers={{ marked: markedDays, weekend: isWeekend }}
          formatters={{
            formatWeekdayName: (date) =>
              date.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2),
          }}
          components={{
            Chevron: ({ orientation }) =>
              orientation === "left" ? (
                <ChevronLeft className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden />
              ),
          }}
          /*
           * Fully hand-styled: the library stylesheet is not loaded, so every
           * class here is load-bearing. Cells are translucent tiles that inherit
           * the panel's glass rather than sitting on an opaque calendar.
           */
          classNames={{
            root: "w-full",
            months: "relative w-full",
            month: "w-full",
            month_caption:
              "mb-3 flex h-8 items-center text-body-lg font-semibold text-content-primary",
            caption_label: "",
            nav: "absolute right-0 top-0 z-10 flex items-center gap-1.5",
            button_previous:
              "inline-flex h-8 w-8 items-center justify-center rounded-control border border-white/10 bg-white/[0.03] text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content-primary disabled:pointer-events-none disabled:opacity-30 focus-ring",
            button_next:
              "inline-flex h-8 w-8 items-center justify-center rounded-control border border-white/10 bg-white/[0.03] text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content-primary disabled:pointer-events-none disabled:opacity-30 focus-ring",
            month_grid: "w-full table-fixed border-collapse",
            weekdays: "",
            weekday:
              "pb-2 text-meta font-medium uppercase tracking-wider text-content-disabled",
            week: "",
            day: "p-0.5 align-middle",
            day_button:
              "flex h-9 w-full items-center justify-center rounded-control border border-transparent bg-white/[0.02] text-body tabular text-content-secondary transition-colors hover:border-white/10 hover:bg-white/[0.07] hover:text-content-primary focus-ring",
            today:
              "[&_button]:font-semibold [&_button]:text-content-primary [&_button]:ring-1 [&_button]:ring-inset [&_button]:ring-white/20",
            selected:
              "[&_button]:border-alpha/50 [&_button]:bg-alpha/15 [&_button]:text-alpha [&_button]:shadow-accent-alpha",
            outside: "opacity-30",
            disabled: "opacity-25 [&_button]:pointer-events-none",
            hidden: "invisible",
          }}
          modifiersClassNames={{
            weekend: "[&_button]:text-content-disabled",
            marked:
              "[&_button]:border-warning/40 [&_button]:bg-warning/15 [&_button]:text-warning",
          }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-content-muted">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-[3px] border border-warning/40 bg-warning/25"
              aria-hidden
            />
            Exception
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-[3px] border border-alpha/50 bg-alpha/25"
              aria-hidden
            />
            Selected
          </span>
          <span>Weekends are already excluded.</span>
        </div>
      </div>

      {/* The label form only exists once a date is chosen — no empty form idling. */}
      <AnimatePresence initial={false}>
        {selected && selectedKey && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="overflow-hidden border-t border-[var(--border-subtle)]"
          >
            <div className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-body font-medium text-content-primary">
                  {longDate(selectedKey)}
                </p>
                <button
                  type="button"
                  onClick={() => setSelected(undefined)}
                  className="rounded-control px-1.5 py-0.5 text-meta text-content-muted transition-colors hover:text-content-primary focus-ring"
                >
                  Cancel
                </button>
              </div>

              <label
                htmlFor="exception-reason"
                className="mt-3 block text-support text-content-secondary"
              >
                Label
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="exception-reason"
                  ref={reasonInput}
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value.slice(0, MAX_REASON_LENGTH))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void save();
                    if (event.key === "Escape") setSelected(undefined);
                  }}
                  maxLength={MAX_REASON_LENGTH}
                  placeholder="e.g. Sick leave"
                  className="h-10 min-w-0 flex-1 rounded-control border border-white/10 bg-white/[0.03] px-3 text-body text-content-primary outline-none transition-colors placeholder:text-content-disabled focus:border-alpha/50 focus-ring"
                />
                <Button
                  variant="alpha"
                  onClick={() => void save()}
                  loading={saving}
                  disabled={!reason.trim()}
                  icon={<Plus className="h-4 w-4" aria-hidden />}
                >
                  {existing ? "Update" : "Save"}
                </Button>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {QUICK_REASONS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setReason(preset)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-meta transition-colors focus-ring",
                      reason === preset
                        ? "border-alpha/40 bg-alpha/10 text-alpha"
                        : "border-white/10 bg-white/[0.03] text-content-muted hover:bg-white/[0.07] hover:text-content-primary",
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {existing && (
                <button
                  type="button"
                  onClick={() => void remove(selectedKey)}
                  className="mt-3 inline-flex items-center gap-1.5 text-support text-danger transition-opacity hover:opacity-80 focus-ring rounded-control"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                  Remove this exception
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-auto border-t border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="eyebrow">Upcoming exceptions</h4>
          <span className="text-meta text-content-disabled">
            {loading ? "loading…" : `${upcoming.length} scheduled`}
          </span>
        </div>

        {loading ? (
          <div className="mt-3 flex gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-8 w-36 animate-pulse rounded-full bg-white/[0.04]"
              />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <p className="mt-2 text-support text-content-muted">
            No upcoming exceptions. Every enabled weekday will run as scheduled.
          </p>
        ) : (
          <ul className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
            <AnimatePresence initial={false}>
              {upcoming.map((entry) => (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="shrink-0"
                >
                  <span className="flex items-center gap-2 rounded-full border border-warning/25 bg-warning/[0.08] py-1 pl-3 pr-1.5">
                    <span className="whitespace-nowrap text-support text-warning">
                      <span className="font-medium">
                        {longDate(entry.exceptionDate)}
                      </span>
                      <span className="text-warning/70"> · {entry.reason}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(entry.exceptionDate)}
                      disabled={removing === entry.exceptionDate}
                      aria-label={`Remove exception on ${longDate(entry.exceptionDate)}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-warning/70 transition-colors hover:bg-warning/15 hover:text-warning disabled:opacity-40 focus-ring"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Panel>
  );
}
