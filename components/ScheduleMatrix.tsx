"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  ChevronDown,
  CloudOff,
  Copy,
  Globe,
  Loader2,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { NumberField } from "@/components/ui/number-field";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { InfoHint, Tooltip } from "@/components/ui/tooltip";
import type { DayOfWeek } from "@/db/schema";
import {
  DEFAULT_RANDOM_OFFSET_MINUTES,
  DEFAULT_WINDOW_A_TIME,
  DEFAULT_WINDOW_B_TIME,
  MAX_RANDOM_OFFSET_MINUTES,
  MIN_RANDOM_OFFSET_MINUTES,
  TOOLTIPS,
  WEEKDAYS,
} from "@/lib/constants";
import type { SaveState } from "@/lib/hooks";
import { useMounted } from "@/lib/hooks";
import {
  detectConflicts,
  resolvedTimeZone,
  timeZoneAbbreviation,
} from "@/lib/schedule";
import type { ScheduleRow } from "@/lib/types";
import { addMinutes, cn, formatRelativeTime, isValidTime } from "@/lib/utils";

export function ScheduleMatrix({
  schedule,
  loading,
  saveState,
  lastSavedAt,
  patchDay,
  patchMany,
  onRetry,
}: {
  schedule: ScheduleRow[];
  loading: boolean;
  saveState: SaveState;
  lastSavedAt: Date | null;
  patchDay: (day: DayOfWeek, patch: Partial<ScheduleRow>) => void;
  patchMany: (
    days: DayOfWeek[],
    patch: Partial<ScheduleRow>,
    reason?: string,
  ) => void;
  onRetry: () => void;
}) {
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [expanded, setExpanded] = React.useState<DayOfWeek | null>(null);
  const conflicts = React.useMemo(() => detectConflicts(schedule), [schedule]);

  const monday = schedule.find((row) => row.dayOfWeek === "Monday");

  function copyMondayToAll() {
    if (!monday) return;
    patchMany(
      WEEKDAYS.filter((d) => d !== "Monday"),
      {
        windowATime: monday.windowATime,
        windowBTime: monday.windowBTime,
        randomOffsetMinutes: monday.randomOffsetMinutes,
        enabled: monday.enabled,
      },
      "Copied Monday's configuration to all weekdays",
    );
  }

  return (
    <>
      <Panel>
        <PanelHeader
          title="Weekly automation"
          description="Configure weekday dispatch windows and jitter behaviour."
          icon={<CalendarRange className="h-4 w-4" aria-hidden />}
          actions={
            <>
              <TimeZoneChip />
              <SaveIndicator
                state={saveState}
                lastSavedAt={lastSavedAt}
                onRetry={onRetry}
              />
            </>
          }
        />

        {/* Bulk editing — avoids five rounds of identical data entry. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-2.5">
          <span className="text-support text-content-muted">Apply to all:</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={copyMondayToAll}
            disabled={loading || !monday}
            icon={<Copy className="h-3.5 w-3.5" aria-hidden />}
          >
            Copy Monday to Mon–Fri
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmReset(true)}
            disabled={loading}
            icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
          >
            Reset to defaults
          </Button>
        </div>

        {conflicts.length > 0 && (
          <div className="border-b border-[var(--border-subtle)] bg-warning/[0.05] px-5 py-3">
            <ul className="space-y-1.5">
              {conflicts.map((conflict, i) => (
                <li
                  key={`${conflict.day}-${i}`}
                  className="flex items-start gap-2 text-support leading-relaxed"
                >
                  <TriangleAlert
                    className={cn(
                      "mt-px h-3.5 w-3.5 shrink-0",
                      conflict.severity === "error"
                        ? "text-danger"
                        : "text-warning",
                    )}
                    aria-hidden
                  />
                  <span className="text-content-secondary">
                    <span className="font-medium text-content-primary">
                      {conflict.day}:
                    </span>{" "}
                    {conflict.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---------------------------- Desktop matrix ---------------------------- */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <Th className="w-[104px]">Day</Th>
                <Th className="w-[112px]">Status</Th>
                <Th className="w-[132px]">Alpha window</Th>
                <Th className="w-[132px]">Beta window</Th>
                <Th className="w-[150px]">
                  <span className="inline-flex items-center gap-1">
                    Jitter
                    <InfoHint content={TOOLTIPS.jitter} label="About jitter" />
                  </span>
                </Th>
                <Th>Effective firing windows</Th>
                <Th className="w-[104px] text-right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonRow key={i} columns={7} />
                  ))
                : schedule.map((row) => (
                    <DesktopRow
                      key={row.dayOfWeek}
                      row={row}
                      onPatch={(patch) => patchDay(row.dayOfWeek, patch)}
                    />
                  ))}
            </tbody>
          </table>
        </div>

        {/* ----------------------------- Mobile list ------------------------------ */}
        <div className="divide-y divide-[var(--border-subtle)] lg:hidden">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="h-5 w-full animate-pulse rounded bg-white/[0.05]" />
                </div>
              ))
            : schedule.map((row) => (
                <MobileRow
                  key={row.dayOfWeek}
                  row={row}
                  open={expanded === row.dayOfWeek}
                  onToggleOpen={() =>
                    setExpanded((cur) =>
                      cur === row.dayOfWeek ? null : row.dayOfWeek,
                    )
                  }
                  onPatch={(patch) => patchDay(row.dayOfWeek, patch)}
                />
              ))}
        </div>

        <WeekendPolicyStrip />
      </Panel>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset all weekdays to defaults?"
        description={`Every weekday will be set to ${DEFAULT_WINDOW_A_TIME} / ${DEFAULT_WINDOW_B_TIME} with ±${DEFAULT_RANDOM_OFFSET_MINUTES} minutes of jitter, and enabled.`}
        confirmLabel="Reset All Weekdays"
        confirmVariant="danger"
        onConfirm={() => {
          patchMany(
            WEEKDAYS,
            {
              enabled: true,
              windowATime: DEFAULT_WINDOW_A_TIME,
              windowBTime: DEFAULT_WINDOW_B_TIME,
              randomOffsetMinutes: DEFAULT_RANDOM_OFFSET_MINUTES,
            },
            "Reset all weekdays to system defaults",
          );
          setConfirmReset(false);
        }}
      />
    </>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-meta font-medium uppercase tracking-[0.06em] text-content-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function DesktopRow({
  row,
  onPatch,
}: {
  row: ScheduleRow;
  onPatch: (patch: Partial<ScheduleRow>) => void;
}) {
  return (
    <tr
      className={cn(
        "border-b border-[var(--border-subtle)] transition-colors last:border-b-0",
        "hover:bg-surface-hover/40 focus-within:bg-surface-hover/40",
        !row.enabled && "opacity-55",
      )}
    >
      <th
        scope="row"
        className="px-4 py-2.5 text-left text-body font-medium text-content-primary"
      >
        {row.dayOfWeek}
      </th>

      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            checked={row.enabled}
            onCheckedChange={(enabled) => onPatch({ enabled })}
            aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.dayOfWeek}`}
          />
          <span
            className={cn(
              "text-support",
              row.enabled ? "text-success" : "text-content-muted",
            )}
          >
            {row.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
      </td>

      <td className="px-4 py-2.5">
        <TimeInput
          value={row.windowATime}
          disabled={!row.enabled}
          label={`${row.dayOfWeek} Alpha dispatch time`}
          onChange={(windowATime) => onPatch({ windowATime })}
        />
      </td>

      <td className="px-4 py-2.5">
        <TimeInput
          value={row.windowBTime}
          disabled={!row.enabled}
          label={`${row.dayOfWeek} Beta dispatch time`}
          onChange={(windowBTime) => onPatch({ windowBTime })}
        />
      </td>

      <td className="px-4 py-2.5">
        <NumberField
          value={row.randomOffsetMinutes}
          onChange={(randomOffsetMinutes) => onPatch({ randomOffsetMinutes })}
          min={MIN_RANDOM_OFFSET_MINUTES}
          max={MAX_RANDOM_OFFSET_MINUTES}
          unit="min"
          label={`${row.dayOfWeek} jitter in minutes`}
          disabled={!row.enabled}
        />
      </td>

      <td className="px-4 py-2.5">
        <span className="tabular font-mono text-support text-content-muted">
          {windowLabel(row)}
        </span>
      </td>

      <td className="px-4 py-2.5 text-right text-support text-content-muted">
        {row.updatedAt ? formatRelativeTime(row.updatedAt) : "Default"}
      </td>
    </tr>
  );
}

/** Only the selected day expands, so the list stays short. */
function MobileRow({
  row,
  open,
  onToggleOpen,
  onPatch,
}: {
  row: ScheduleRow;
  open: boolean;
  onToggleOpen: () => void;
  onPatch: (patch: Partial<ScheduleRow>) => void;
}) {
  return (
    <div className={cn(!row.enabled && "opacity-60")}>
      <div className="flex items-center gap-3 px-5 py-3">
        <Switch
          size="sm"
          checked={row.enabled}
          onCheckedChange={(enabled) => onPatch({ enabled })}
          aria-label={`${row.enabled ? "Disable" : "Enable"} ${row.dayOfWeek}`}
        />
        <button
          onClick={onToggleOpen}
          aria-expanded={open}
          className="flex min-h-[44px] flex-1 items-center justify-between gap-3 text-left focus-ring"
        >
          <div className="min-w-0">
            <p className="text-body font-medium text-content-primary">
              {row.dayOfWeek}
            </p>
            <p className="tabular mt-0.5 font-mono text-support text-content-muted">
              {row.enabled
                ? `${row.windowATime} · ${row.windowBTime} · ±${row.randomOffsetMinutes}m`
                : "Disabled"}
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-content-muted transition-transform duration-expand",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-4 px-5 pb-4">
              <Field label="Alpha dispatch time">
                <TimeInput
                  value={row.windowATime}
                  disabled={!row.enabled}
                  label={`${row.dayOfWeek} Alpha dispatch time`}
                  onChange={(windowATime) => onPatch({ windowATime })}
                />
              </Field>

              <Field label="Beta dispatch time">
                <TimeInput
                  value={row.windowBTime}
                  disabled={!row.enabled}
                  label={`${row.dayOfWeek} Beta dispatch time`}
                  onChange={(windowBTime) => onPatch({ windowBTime })}
                />
              </Field>

              <Field
                label="Jitter"
                hint={TOOLTIPS.jitter}
              >
                <NumberField
                  value={row.randomOffsetMinutes}
                  onChange={(randomOffsetMinutes) =>
                    onPatch({ randomOffsetMinutes })
                  }
                  min={MIN_RANDOM_OFFSET_MINUTES}
                  max={MAX_RANDOM_OFFSET_MINUTES}
                  unit="min"
                  label={`${row.dayOfWeek} jitter in minutes`}
                  disabled={!row.enabled}
                />
              </Field>

              <p className="tabular font-mono text-support text-content-muted">
                Fires {windowLabel(row)}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1 text-body text-content-secondary">
        {label}
        {hint && <InfoHint content={hint} label={`About ${label}`} />}
      </span>
      {children}
    </div>
  );
}

function TimeInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const invalid = !isValidTime(value);

  return (
    <input
      type="time"
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "tabular h-9 w-[112px] rounded-control border bg-bg-elevated/60 px-2.5 font-mono text-body text-content-primary transition-colors focus-ring",
        invalid
          ? "border-danger/50"
          : "border-[var(--border-default)] hover:border-[var(--border-strong)]",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  );
}

function windowLabel(row: ScheduleRow): string {
  if (!row.enabled) return "—";
  if (row.randomOffsetMinutes === 0) {
    return `${row.windowATime} · ${row.windowBTime} exactly`;
  }
  return `${row.windowATime}–${addMinutes(row.windowATime, row.randomOffsetMinutes)} · ${row.windowBTime}–${addMinutes(row.windowBTime, row.randomOffsetMinutes)}`;
}

function TimeZoneChip() {
  const mounted = useMounted();
  if (!mounted) return null;

  return (
    <Tooltip content="All schedule times are interpreted in this timezone.">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white/[0.03] px-2 py-1 text-support text-content-muted">
        <Globe className="h-3.5 w-3.5" aria-hidden />
        {resolvedTimeZone()} ({timeZoneAbbreviation()})
      </span>
    </Tooltip>
  );
}

/**
 * Persistent save state. Every state is named in words; the user is never
 * left guessing whether an edit reached the database.
 */
function SaveIndicator({
  state,
  lastSavedAt,
  onRetry,
}: {
  state: SaveState;
  lastSavedAt: Date | null;
  onRetry: () => void;
}) {
  const mounted = useMounted();

  const content = {
    saved: {
      icon: <Check className="h-3.5 w-3.5" aria-hidden />,
      text:
        mounted && lastSavedAt
          ? `Saved ${formatRelativeTime(lastSavedAt)}`
          : "All changes saved",
      className: "text-success",
    },
    unsaved: {
      icon: <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />,
      text: "Unsaved changes",
      className: "text-warning",
    },
    saving: {
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />,
      text: "Saving…",
      className: "text-content-muted",
    },
    failed: {
      icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
      text: "Unable to save",
      className: "text-danger",
    },
    offline: {
      icon: <CloudOff className="h-3.5 w-3.5" aria-hidden />,
      text: "Offline — changes pending",
      className: "text-warning",
    },
  }[state];

  return (
    <div className="flex items-center gap-2" role="status" aria-live="polite">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-support",
          content.className,
        )}
      >
        {content.icon}
        {content.text}
      </span>
      {(state === "failed" || state === "offline") && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Compact policy strip — proportionate to a setting that never changes. */
function WeekendPolicyStrip() {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-[var(--border-subtle)] bg-white/[0.015] px-5 py-3">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-content-muted" aria-hidden />
      <span className="text-support font-medium text-content-secondary">
        Weekend runs blocked
      </span>
      <span className="text-support text-content-muted">
        Scheduled automation is disabled on Saturday and Sunday.
      </span>
      <Badge tone="neutral" size="sm" className="ml-auto">
        Policy
      </Badge>
    </div>
  );
}

function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-5 animate-pulse rounded bg-white/[0.05]" />
        </td>
      ))}
    </tr>
  );
}
