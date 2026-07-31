import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { auditLog } from "@/db/schema";
import type { AuditRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.round(requested), 100)
      : 25;

  try {
    const rows = await db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.timestamp))
      .limit(limit);

    const entries: AuditRow[] = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      action: row.action,
      actor: row.actor,
      summary: row.summary,
      details: (row.details as Record<string, unknown> | null) ?? null,
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not read audit history: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
