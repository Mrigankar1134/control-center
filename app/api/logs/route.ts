import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { dispatchLogs } from "@/db/schema";
import { LOG_PAGE_SIZE } from "@/lib/constants";
import type { LogRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.round(requested), 200)
      : LOG_PAGE_SIZE;

  try {
    const rows = await db
      .select()
      .from(dispatchLogs)
      .orderBy(desc(dispatchLogs.timestamp))
      .limit(limit);

    const logs: LogRow[] = rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      actionType: row.actionType,
      status: row.status,
      executionDurationMs: row.executionDurationMs,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      artifactUrl: row.artifactUrl,
      errorMessage: row.errorMessage,
    }));

    return NextResponse.json({ logs });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not read logs from Neon: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }
}
