import type {
  ActionType,
  AuditAction,
  DayOfWeek,
  DispatchStatus,
} from "@/db/schema";

/** Serialized shape of `schedule_config` as returned by GET /api/schedule. */
export interface ScheduleRow {
  dayOfWeek: DayOfWeek;
  enabled: boolean;
  windowATime: string;
  windowBTime: string;
  randomOffsetMinutes: number;
  updatedAt: string | null;
}

/** Serialized shape of `dispatch_logs` as returned by GET /api/logs. */
export interface LogRow {
  id: string;
  timestamp: string;
  actionType: ActionType;
  status: DispatchStatus;
  executionDurationMs: number | null;
  payload: DispatchPayloadShape | null;
  artifactUrl: string | null;
  errorMessage: string | null;
}

/** Serialized shape of `holiday_exceptions` as returned by GET /api/exceptions. */
export interface ExceptionRow {
  id: number;
  /** YYYY-MM-DD, in the operator's local calendar. */
  exceptionDate: string;
  reason: string;
  createdAt: string;
}

export type TerminalLevel = "INFO" | "SUCCESS" | "WARN" | "ERROR" | "SYSTEM";

/** One line emitted by GET /api/dispatch/stream. */
export interface TerminalLine {
  id: string;
  level: TerminalLevel;
  message: string;
  /** ms since the stream opened — the terminal renders an elapsed gutter. */
  elapsedMs: number;
}

export interface DispatchPayloadShape {
  runId?: string;
  action?: ActionType;
  bypassDelay?: boolean;
  delayMs?: number;
  source?: string;
  driver?: string;
  triggeredAt?: string;
  [key: string]: unknown;
}

export interface DispatchResponse {
  id: string;
  status: DispatchStatus;
  actionType: ActionType;
  executionDurationMs: number;
  driver: string;
  errorMessage: string | null;
  artifactUrl: string | null;
}

export interface AuditRow {
  id: string;
  timestamp: string;
  action: AuditAction;
  actor: string | null;
  summary: string;
  details: Record<string, unknown> | null;
}

/** Local lifecycle of a manual run, surfaced on the action panel itself. */
export type RunPhase =
  | "idle"
  | "confirming"
  | "queued"
  | "executing"
  | "success"
  | "failed";

export interface RunState {
  phase: RunPhase;
  startedAt: number | null;
  delayMs: number;
  result: DispatchResponse | null;
  error: string | null;
}
