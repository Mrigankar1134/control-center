import { asc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { holidayExceptions } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { ExceptionRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REASON_LENGTH = 80;

/** Local calendar date, not UTC — an exception is the operator's own day. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;

  // Compared in UTC throughout: a local-time round trip would shift the date
  // by the server's offset and reject perfectly valid days.
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Catches 2026-02-31 and friends, which `Date` would silently roll over.
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/exceptions
 * `?upcoming=1` trims the response to today and later, which is all the
 * scheduler and the pill list ever need.
 */
export async function GET(request: Request) {
  const upcoming = new URL(request.url).searchParams.get("upcoming") === "1";

  try {
    const query = db
      .select()
      .from(holidayExceptions)
      .orderBy(asc(holidayExceptions.exceptionDate));

    const rows = upcoming
      ? await query.where(gte(holidayExceptions.exceptionDate, today()))
      : await query;

    const exceptions: ExceptionRow[] = rows.map((row) => ({
      id: row.id,
      exceptionDate: row.exceptionDate,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json({ exceptions });
  } catch (error) {
    return failure(
      `Could not read exceptions from Neon: ${
        error instanceof Error ? error.message : String(error)
      }`,
      500,
    );
  }
}

/** POST /api/exceptions — { exceptionDate: "YYYY-MM-DD", reason: string } */
export async function POST(request: Request) {
  let body: { exceptionDate?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return failure("Request body must be valid JSON.", 400);
  }

  if (!isValidDate(body.exceptionDate)) {
    return failure("`exceptionDate` must be a real date in YYYY-MM-DD form.", 400);
  }

  const reason =
    typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return failure("`reason` is required — an unlabelled exception is unreadable later.", 400);
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return failure(`\`reason\` must be ${MAX_REASON_LENGTH} characters or fewer.`, 400);
  }

  const exceptionDate = body.exceptionDate;

  try {
    // Re-saving the same date relabels it rather than erroring on the unique
    // constraint — that is what tapping an already-marked day means.
    const [row] = await db
      .insert(holidayExceptions)
      .values({ exceptionDate, reason })
      .onConflictDoUpdate({
        target: holidayExceptions.exceptionDate,
        set: { reason },
      })
      .returning();

    await recordAudit({
      action: "EXCEPTION_ADDED",
      summary: `${exceptionDate} marked as an exception — ${reason}`,
      details: { exceptionDate, reason },
    });

    const exception: ExceptionRow = {
      id: row.id,
      exceptionDate: row.exceptionDate,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    };

    return NextResponse.json({ exception }, { status: 201 });
  } catch (error) {
    return failure(
      `Could not save the exception: ${
        error instanceof Error ? error.message : String(error)
      }`,
      500,
    );
  }
}

/** DELETE /api/exceptions?date=YYYY-MM-DD (or ?id=123) */
export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.get("date");
  const id = Number(params.get("id"));

  const byId = Number.isInteger(id) && id > 0;
  if (!byId && !isValidDate(date)) {
    return failure("Provide `date` as YYYY-MM-DD, or a numeric `id`.", 400);
  }

  try {
    const [removed] = await db
      .delete(holidayExceptions)
      .where(
        byId
          ? eq(holidayExceptions.id, id)
          : eq(holidayExceptions.exceptionDate, date as string),
      )
      .returning();

    if (!removed) return failure("No exception matched that date.", 404);

    await recordAudit({
      action: "EXCEPTION_REMOVED",
      summary: `${removed.exceptionDate} cleared — schedule restored`,
      details: { exceptionDate: removed.exceptionDate, reason: removed.reason },
    });

    return NextResponse.json({ removed: removed.exceptionDate });
  } catch (error) {
    return failure(
      `Could not remove the exception: ${
        error instanceof Error ? error.message : String(error)
      }`,
      500,
    );
  }
}
