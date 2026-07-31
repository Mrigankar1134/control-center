import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  date,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
]);

export const statusEnum = pgEnum("status", [
  "QUEUED",
  "EXECUTING",
  "SUCCESS",
  "FAILED",
]);

export const actionTypeEnum = pgEnum("action_type", [
  "ACTION_ALPHA",
  "ACTION_BETA",
]);

export const scheduleConfig = pgTable("schedule_config", {
  id: serial("id").primaryKey(),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull().unique(),
  enabled: boolean("enabled").default(true).notNull(),
  windowATime: text("window_a_time").default("09:19").notNull(), // HH:mm format
  windowBTime: text("window_b_time").default("19:17").notNull(), // HH:mm format
  randomOffsetMinutes: integer("random_offset_minutes").default(25).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Dates on which no scheduled window may fire, regardless of the weekday
 * matrix. Stored as a bare `date` (no time zone) because an exception is a
 * calendar fact for the operator, not an instant.
 */
export const holidayExceptions = pgTable("holiday_exceptions", {
  id: serial("id").primaryKey(),
  exceptionDate: date("exception_date").notNull().unique(), // YYYY-MM-DD
  reason: text("reason").notNull(), // e.g. "National Holiday", "PTO"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const dispatchLogs = pgTable("dispatch_logs", {
  id: text("id").primaryKey(), // UUID
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  actionType: actionTypeEnum("action_type").notNull(),
  status: statusEnum("status").notNull(),
  executionDurationMs: integer("execution_duration_ms"),
  payload: jsonb("payload"),
  artifactUrl: text("artifact_url"), // Link to failure screenshots/logs
  errorMessage: text("error_message"),
});

/**
 * What Zoho's attendance widget said, the last time the bot could see it.
 *
 * The dashboard cannot read Zoho itself — the widget lives behind an
 * authenticated session on another origin — so every row here was captured by
 * a Playwright run and reported back. Append-only: the history of what was on
 * screen is worth more than a single mutable "current" row when a punch is
 * disputed.
 */
export const attendanceSnapshots = pgTable("attendance_snapshots", {
  id: serial("id").primaryKey(),
  /** When the bot read the widget. Stored UTC, always rendered as IST. */
  capturedAt: timestamp("captured_at").defaultNow().notNull(),
  /** Raw #att_status text: "In", "Out", "Yet to check-in"… */
  status: text("status"),
  /** #totalInTime as seconds — the widget's HH/MM/SS spans, flattened. */
  loggedSeconds: integer("logged_seconds"),
  /** The same value as Zoho rendered it, e.g. "07:04:47". */
  rawTime: text("raw_time"),
  /** STATUS_CHECK, ACTION_ALPHA or ACTION_BETA — which run saw this. */
  source: text("source"),
  /** Correlates with dispatch_logs.id when a punch run reported it. */
  runId: text("run_id"),
});

export const auditActionEnum = pgEnum("audit_action", [
  "SCHEDULE_UPDATED",
  "AUTOMATION_RESUMED",
  "AUTOMATION_PAUSED",
  "MANUAL_DISPATCH",
  "EXCEPTION_ADDED",
  "EXCEPTION_REMOVED",
]);

/**
 * Append-only record of every high-impact change. `actor` stays null until an
 * auth layer exists to attribute it — the column is here so history is not
 * lost in the meantime.
 */
export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(), // UUID
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  action: auditActionEnum("action").notNull(),
  actor: text("actor"),
  summary: text("summary").notNull(),
  details: jsonb("details"),
});

export type ScheduleConfig = typeof scheduleConfig.$inferSelect;
export type NewScheduleConfig = typeof scheduleConfig.$inferInsert;
export type DispatchLog = typeof dispatchLogs.$inferSelect;
export type HolidayException = typeof holidayExceptions.$inferSelect;
export type NewHolidayException = typeof holidayExceptions.$inferInsert;
export type NewDispatchLog = typeof dispatchLogs.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type AttendanceSnapshot = typeof attendanceSnapshots.$inferSelect;
export type NewAttendanceSnapshot = typeof attendanceSnapshots.$inferInsert;

export type DayOfWeek = (typeof dayOfWeekEnum.enumValues)[number];
export type DispatchStatus = (typeof statusEnum.enumValues)[number];
export type ActionType = (typeof actionTypeEnum.enumValues)[number];
export type AuditAction = (typeof auditActionEnum.enumValues)[number];
