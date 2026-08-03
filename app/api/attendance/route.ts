import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { attendanceSnapshots } from "@/db/schema";
import type { AttendanceSnapshot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "07:04:47" or "7h 4m" -> 25487. Returns null for anything unparseable. */
function parseDuration(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value !== "string") return null;

  const colon = value.trim().match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (colon) {
    const [, h, m, s] = colon;
    return Number(h) * 3600 + Number(m) * 60 + Number(s ?? 0);
  }

  const spelled = value.trim().match(/^(\d{1,3})\s*h[^\d]*(\d{1,2})?\s*m?/i);
  if (spelled) {
    return Number(spelled[1]) * 3600 + Number(spelled[2] ?? 0) * 60;
  }

  return null;
}

function serialize(row: typeof attendanceSnapshots.$inferSelect): AttendanceSnapshot {
  return {
    capturedAt: row.capturedAt.toISOString(),
    status: row.status,
    loggedSeconds: row.loggedSeconds,
    rawTime: row.rawTime,
    source: row.source,
    runId: row.runId,
  };
}

/**
 * Writes are gated on the shared secret when one is configured — this is the
 * only endpoint an outside caller can put data *into*, and a fabricated
 * snapshot would show a check-out as safe when it is not.
 */
function authorised(request: Request): boolean {
  const secret = process.env.DISPATCH_SECRET;
  if (!secret) return true;

  // Accept either header, matching POST /api/dispatch. `Authorization` is the
  // obvious choice but CDNs in front of this app can strip it before it reaches
  // the runtime, which is indistinguishable from a wrong secret at this layer;
  // `x-dispatch-secret` is a custom name nothing has a reason to touch.
  const presented =
    request.headers.get("x-dispatch-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  return presented === secret;
}

/** GET /api/attendance — the most recent snapshot, or null if none exists. */
export async function GET() {
  try {
    const [row] = await db
      .select()
      .from(attendanceSnapshots)
      .orderBy(desc(attendanceSnapshots.capturedAt))
      .limit(1);

    return NextResponse.json({ snapshot: row ? serialize(row) : null });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not read the attendance snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/attendance — the bot reporting what Zoho's widget showed.
 * { status, loggedSeconds | rawTime, source, runId }
 */
export async function POST(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const rawTime = typeof body.rawTime === "string" ? body.rawTime.trim() : null;
  const loggedSeconds = parseDuration(body.loggedSeconds) ?? parseDuration(rawTime);

  if (loggedSeconds === null && !body.status) {
    return NextResponse.json(
      { error: "Provide at least `status` or a parseable `loggedSeconds`/`rawTime`." },
      { status: 400 },
    );
  }

  try {
    const [row] = await db
      .insert(attendanceSnapshots)
      .values({
        status: typeof body.status === "string" ? body.status.slice(0, 60) : null,
        loggedSeconds,
        rawTime,
        source: typeof body.source === "string" ? body.source.slice(0, 40) : null,
        runId: typeof body.runId === "string" ? body.runId.slice(0, 64) : null,
      })
      .returning();

    return NextResponse.json({ snapshot: serialize(row) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not store the attendance snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
