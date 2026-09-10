import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  actionTypeEnum,
  dispatchLogs,
  holidayExceptions,
  scheduleConfig,
} from "@/db/schema";
import type { ActionType, DayOfWeek } from "@/db/schema";
import { triggerDownstream, type DispatchPayload } from "@/lib/github";
import { MAX_MANUAL_DELAY_MS, WEEKDAYS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";
import {
  UNLOCK_COOKIE,
  isGateConfigured,
  readUnlockToken,
} from "@/lib/security";
import { sleep } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DispatchBody {
  action?: string;
  bypassDelay?: boolean;
  source?: "MANUAL" | "CRON";
  maxDelayMs?: number;
  /**
   * Jitter the caller has already waited out on its own (the console runs a
   * cancellable countdown). When present the server records it verbatim and
   * does not sleep again.
   */
  queueDelayMs?: number;
}

function isActionType(value: unknown): value is ActionType {
  return (
    typeof value === "string" &&
    (actionTypeEnum.enumValues as readonly string[]).includes(value)
  );
}

/**
 * Cron callers must present DISPATCH_SECRET. Browser-originated manual
 * dispatches are same-origin and exempt.
 */
function isAuthorized(request: Request, source: "MANUAL" | "CRON"): boolean {
  if (source === "MANUAL") return true;

  const secret = process.env.DISPATCH_SECRET;
  if (!secret) return false;

  const header =
    request.headers.get("x-dispatch-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  return header === secret;
}

/**
 * The exception row covering the server's current date, if any. Exceptions are
 * plain calendar dates, so this compares against the server's local day.
 */
async function exceptionForToday() {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  try {
    const [row] = await db
      .select()
      .from(holidayExceptions)
      .where(eq(holidayExceptions.exceptionDate, key))
      .limit(1);
    return row ?? null;
  } catch (error) {
    // A lookup failure must not silently suppress a scheduled run.
    console.error("[dispatch] exception lookup failed", error);
    return null;
  }
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Today's weekday in IST, or null on a weekend. Both windows (09:19 and 19:17
 * IST) land on the same calendar date in IST and in UTC, so this agrees with
 * `exceptionForToday()` above even though that one reads the server's date.
 */
function istWeekday(): DayOfWeek | null {
  const name = DAY_NAMES[new Date(Date.now() + IST_OFFSET_MS).getUTCDay()];
  return (WEEKDAYS as readonly string[]).includes(name)
    ? (name as DayOfWeek)
    : null;
}

/**
 * Whether the scheduler is armed for today. "Pause automation" in the console
 * writes `enabled = false`, and something has to read it or the switch is
 * decorative.
 *
 * The bot asks this itself in `check_dashboard_policy()`, but only on a
 * `schedule` event. Since EventBridge took over the clock (infra/eventbridge/)
 * every scheduled run arrives as a `workflow_dispatch`, so the bot never asks
 * and the gate has to live here — before the workflow is even started.
 */
async function scheduleArmedToday(): Promise<{
  armed: boolean;
  reason: string | null;
}> {
  const day = istWeekday();
  if (!day) {
    return { armed: false, reason: "today is a weekend" };
  }

  try {
    const [row] = await db
      .select()
      .from(scheduleConfig)
      .where(eq(scheduleConfig.dayOfWeek, day))
      .limit(1);

    // A missing row is a day nobody has configured, which the console renders
    // as enabled. Fail open, exactly as the bot's own policy check does: a
    // missed punch costs more than an extra one.
    if (!row) return { armed: true, reason: null };

    return row.enabled
      ? { armed: true, reason: null }
      : { armed: false, reason: `${day} is paused in the console` };
  } catch (error) {
    console.error("[dispatch] schedule lookup failed", error);
    return { armed: true, reason: null };
  }
}

export async function POST(request: Request) {
  let body: DispatchBody;
  try {
    body = (await request.json()) as DispatchBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (!isActionType(body.action)) {
    return NextResponse.json(
      { error: "`action` must be ACTION_ALPHA or ACTION_BETA." },
      { status: 400 },
    );
  }

  const action = body.action;
  const bypassDelay = body.bypassDelay === true;
  const source = body.source === "CRON" ? "CRON" : "MANUAL";

  if (!isAuthorized(request, source)) {
    return NextResponse.json(
      { error: "Invalid or missing dispatch secret." },
      { status: 401 },
    );
  }

  /*
   * Manual runs must carry a live unlock from the security gate. The overlay in
   * the console is the front door; this is the lock — a hand-rolled fetch gets
   * the same 403 a stray tap would.
   */
  if (source === "MANUAL" && isGateConfigured()) {
    const unlock = readUnlockToken(cookies().get(UNLOCK_COOKIE)?.value);
    if (!unlock.valid) {
      return NextResponse.json(
        {
          error:
            "This dispatch is locked. Pass the security challenge and try again.",
          locked: true,
        },
        { status: 403 },
      );
    }
  }

  // A holiday exception silences the scheduler, never the operator: manual runs
  // stay available on an excepted day, cron runs do not.
  if (source === "CRON") {
    const armed = await scheduleArmedToday();
    if (!armed.armed) {
      return NextResponse.json(
        {
          skipped: true,
          reason: armed.reason,
          message: `No run was started: ${armed.reason}.`,
        },
        { status: 200 },
      );
    }

    const skip = await exceptionForToday();
    if (skip) {
      return NextResponse.json(
        {
          skipped: true,
          reason: skip.reason,
          exceptionDate: skip.exceptionDate,
          message: `${skip.exceptionDate} is marked as an exception (${skip.reason}). No run was started.`,
        },
        { status: 200 },
      );
    }
  }

  const preWaited =
    typeof body.queueDelayMs === "number" && Number.isFinite(body.queueDelayMs);

  const ceiling = Math.min(
    Math.max(0, body.maxDelayMs ?? MAX_MANUAL_DELAY_MS),
    MAX_MANUAL_DELAY_MS,
  );

  const delayMs = preWaited
    ? Math.max(0, Math.round(body.queueDelayMs as number))
    : bypassDelay
      ? 0
      : Math.floor(Math.random() * ceiling);

  const id = randomUUID();
  const startedAt = Date.now();

  const payload: DispatchPayload = {
    runId: id,
    action,
    bypassDelay,
    delayMs,
    source,
    triggeredAt: new Date().toISOString(),
  };

  // Claim the run before doing anything slow so the console shows it live.
  try {
    await db.insert(dispatchLogs).values({
      id,
      actionType: action,
      status: "EXECUTING",
      payload,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not write to Neon: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }

  if (!preWaited && delayMs > 0) await sleep(delayMs);

  let status: "SUCCESS" | "FAILED" = "SUCCESS";
  let errorMessage: string | null = null;
  let artifactUrl: string | null = null;
  let driver = "UNKNOWN";

  try {
    const result = await triggerDownstream(payload);
    driver = result.driver;
    artifactUrl = result.artifactUrl ?? null;

    if (!result.ok) {
      status = "FAILED";
      errorMessage =
        result.detail ??
        `Downstream driver ${result.driver} returned ${result.statusCode ?? "no status"}.`;
    }
  } catch (error) {
    status = "FAILED";
    errorMessage =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  }

  const executionDurationMs = Date.now() - startedAt;

  if (source === "MANUAL") {
    await recordAudit({
      action: "MANUAL_DISPATCH",
      summary: `${action} dispatched manually — ${status.toLowerCase()}`,
      details: { runId: id, bypassDelay, delayMs, driver, status },
    });
  }

  await db
    .update(dispatchLogs)
    .set({
      status,
      executionDurationMs,
      errorMessage,
      artifactUrl,
      payload: { ...payload, driver },
    })
    .where(eq(dispatchLogs.id, id));

  return NextResponse.json(
    {
      id,
      status,
      actionType: action,
      executionDurationMs,
      driver,
      errorMessage,
      artifactUrl,
    },
    { status: status === "SUCCESS" ? 200 : 502 },
  );
}
