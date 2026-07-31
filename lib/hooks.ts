"use client";

import * as React from "react";

import type { DayOfWeek } from "@/db/schema";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_RANDOM_OFFSET_MINUTES,
  DEFAULT_WINDOW_A_TIME,
  DEFAULT_WINDOW_B_TIME,
  LOGS_POLL_INTERVAL_MS,
  LOG_HISTORY_SIZE,
  WEEKDAYS,
} from "@/lib/constants";
import type {
  AuditRow,
  ExceptionRow,
  LogRow,
  ScheduleRow,
} from "@/lib/types";
import { isValidTime } from "@/lib/utils";

const SAVE_DEBOUNCE_MS = 600;

/**
 * Persistent save state. A brief green flash is not enough for auto-save —
 * the planner header shows one of these at all times.
 */
export type SaveState =
  | "saved"
  | "unsaved"
  | "saving"
  | "failed"
  | "offline";

function defaultSchedule(): ScheduleRow[] {
  return WEEKDAYS.map((day) => ({
    dayOfWeek: day,
    enabled: true,
    windowATime: DEFAULT_WINDOW_A_TIME,
    windowBTime: DEFAULT_WINDOW_B_TIME,
    randomOffsetMinutes: DEFAULT_RANDOM_OFFSET_MINUTES,
    updatedAt: null,
  }));
}

export interface UseScheduleResult {
  schedule: ScheduleRow[];
  loading: boolean;
  saveState: SaveState;
  error: string | null;
  lastSavedAt: Date | null;
  patchDay: (day: DayOfWeek, patch: Partial<ScheduleRow>) => void;
  patchMany: (
    days: DayOfWeek[],
    patch: Partial<ScheduleRow>,
    reason?: string,
  ) => void;
  setAllEnabled: (enabled: boolean, reason?: string) => void;
  retry: () => void;
  activeDays: number;
  automationEnabled: boolean;
}

export function useSchedule(): UseScheduleResult {
  const { toast } = useToast();
  const [schedule, setSchedule] = React.useState<ScheduleRow[]>(defaultSchedule);
  const [loading, setLoading] = React.useState(true);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [error, setError] = React.useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);

  // Pending edits survive a failed write so Retry can resend them.
  const pending = React.useRef(new Map<DayOfWeek, ScheduleRow>());
  const reasonRef = React.useRef<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/schedule", { cache: "no-store" });
        const data = (await response.json()) as {
          schedule?: ScheduleRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!response.ok || !data.schedule) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setSchedule(data.schedule);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSaveState("failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = React.useCallback(async () => {
    const updates = Array.from(pending.current.values());
    if (updates.length === 0) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSaveState("offline");
      return;
    }

    setSaveState("saving");
    try {
      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, reason: reasonRef.current }),
      });
      const data = (await response.json()) as {
        schedule?: ScheduleRow[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

      pending.current.clear();
      reasonRef.current = null;

      if (data.schedule) {
        const saved = new Map(data.schedule.map((row) => [row.dayOfWeek, row]));
        setSchedule((current) =>
          current.map((row) => saved.get(row.dayOfWeek) ?? row),
        );
      }
      setError(null);
      setLastSavedAt(new Date());
      setSaveState("saved");
    } catch (err) {
      // Local edits are deliberately retained so nothing is silently lost.
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setSaveState("failed");
      toast({
        title: "Could not save schedule",
        description: `${message} Your changes are kept locally.`,
        variant: "error",
        duration: 9000,
      });
    }
  }, [toast]);

  const queue = React.useCallback(
    (rows: ScheduleRow[], reason?: string) => {
      rows.forEach((row) => pending.current.set(row.dayOfWeek, row));
      if (reason) reasonRef.current = reason;
      setSaveState("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  const patchDay = React.useCallback(
    (day: DayOfWeek, patch: Partial<ScheduleRow>) => {
      setSchedule((current) => {
        const next = current.map((row) =>
          row.dayOfWeek === day ? { ...row, ...patch } : row,
        );
        const changed = next.find((row) => row.dayOfWeek === day);
        // Never push a half-typed time value to the database.
        if (
          changed &&
          isValidTime(changed.windowATime) &&
          isValidTime(changed.windowBTime)
        ) {
          queue([changed]);
        }
        return next;
      });
    },
    [queue],
  );

  const patchMany = React.useCallback(
    (days: DayOfWeek[], patch: Partial<ScheduleRow>, reason?: string) => {
      const target = new Set(days);
      setSchedule((current) => {
        const next = current.map((row) =>
          target.has(row.dayOfWeek) ? { ...row, ...patch } : row,
        );
        queue(
          next.filter((row) => target.has(row.dayOfWeek)),
          reason,
        );
        return next;
      });
    },
    [queue],
  );

  const setAllEnabled = React.useCallback(
    (enabled: boolean, reason?: string) => {
      patchMany(WEEKDAYS, { enabled }, reason);
    },
    [patchMany],
  );

  const retry = React.useCallback(() => {
    void flush();
  }, [flush]);

  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Recover automatically when connectivity returns.
  React.useEffect(() => {
    function onOnline() {
      if (pending.current.size > 0) void flush();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  const activeDays = schedule.filter((row) => row.enabled).length;

  return {
    schedule,
    loading,
    saveState,
    error,
    lastSavedAt,
    patchDay,
    patchMany,
    setAllEnabled,
    retry,
    activeDays,
    automationEnabled: activeDays > 0,
  };
}

export interface UseLogsResult {
  logs: LogRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/** Polls GET /api/logs so the console stays live without a socket. */
export function useLogs(): UseLogsResult {
  const [logs, setLogs] = React.useState<LogRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/logs?limit=${LOG_HISTORY_SIZE}`, {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        logs?: LogRow[];
        error?: string;
      };
      if (!response.ok || !data.logs) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setLogs(data.logs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), LOGS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { logs, loading, refreshing, error, refresh };
}

export interface UseExceptionsResult {
  exceptions: ExceptionRow[];
  loading: boolean;
  error: string | null;
  save: (exceptionDate: string, reason: string) => Promise<boolean>;
  remove: (exceptionDate: string) => Promise<boolean>;
  refresh: () => Promise<void>;
}

/**
 * Holiday exceptions. Writes are optimistic — the list re-sorts immediately —
 * but a failed write rolls the row back rather than leaving a date that looks
 * skipped while the scheduler would still fire on it.
 */
export function useExceptions(): UseExceptionsResult {
  const { toast } = useToast();
  const [exceptions, setExceptions] = React.useState<ExceptionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/exceptions", { cache: "no-store" });
      const data = (await response.json()) as {
        exceptions?: ExceptionRow[];
        error?: string;
      };
      if (!response.ok || !data.exceptions) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setExceptions(data.exceptions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = React.useCallback(
    async (exceptionDate: string, reason: string) => {
      const previous = exceptions;
      setExceptions((current) => {
        const next = current.filter(
          (entry) => entry.exceptionDate !== exceptionDate,
        );
        next.push({
          id: Date.now(), // Replaced by the server row on success.
          exceptionDate,
          reason,
          createdAt: new Date().toISOString(),
        });
        return next.sort((a, b) =>
          a.exceptionDate.localeCompare(b.exceptionDate),
        );
      });

      try {
        const response = await fetch("/api/exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exceptionDate, reason }),
        });
        const data = (await response.json()) as {
          exception?: ExceptionRow;
          error?: string;
        };
        if (!response.ok || !data.exception) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        setExceptions((current) =>
          current
            .map((entry) =>
              entry.exceptionDate === exceptionDate ? data.exception! : entry,
            )
            .sort((a, b) => a.exceptionDate.localeCompare(b.exceptionDate)),
        );
        setError(null);
        toast({
          title: "Exception saved",
          description: `${exceptionDate} will be skipped — ${reason}.`,
          variant: "success",
        });
        return true;
      } catch (err) {
        setExceptions(previous);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast({
          title: "Could not save the exception",
          description: message,
          variant: "error",
          duration: 9000,
        });
        return false;
      }
    },
    [exceptions, toast],
  );

  const remove = React.useCallback(
    async (exceptionDate: string) => {
      const previous = exceptions;
      setExceptions((current) =>
        current.filter((entry) => entry.exceptionDate !== exceptionDate),
      );

      try {
        const response = await fetch(
          `/api/exceptions?date=${encodeURIComponent(exceptionDate)}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setError(null);
        toast({
          title: "Exception removed",
          description: `${exceptionDate} is back on the normal schedule.`,
          variant: "info",
        });
        return true;
      } catch (err) {
        setExceptions(previous);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast({
          title: "Could not remove the exception",
          description: message,
          variant: "error",
          duration: 9000,
        });
        return false;
      }
    },
    [exceptions, toast],
  );

  return { exceptions, loading, error, save, remove, refresh };
}

export function useAudit(refreshKey: number) {
  const [entries, setEntries] = React.useState<AuditRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/audit?limit=25", {
          cache: "no-store",
        });
        const data = (await response.json()) as { entries?: AuditRow[] };
        if (!cancelled && data.entries) setEntries(data.entries);
      } catch {
        /* Audit history is supplementary; failure is not surfaced loudly. */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { entries, loading };
}

/** Ticks every `intervalMs` to drive countdowns and elapsed timers. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

/** True only after hydration — guards time-dependent render output. */
export function useMounted(): boolean {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}
