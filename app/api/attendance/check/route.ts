import { NextResponse } from "next/server";

import { triggerStatusCheck } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/check — asks CI to go and look at Zoho.
 *
 * The run is fire-and-forget: signing in takes the better part of a minute and
 * may need an OTP, so the console polls GET /api/attendance for a snapshot
 * newer than the moment it asked, rather than holding a request open.
 */
export async function POST() {
  try {
    const result = await triggerStatusCheck();

    if (!result.ok) {
      return NextResponse.json(
        { error: result.detail ?? "Could not start the status check." },
        { status: 502 },
      );
    }

    return NextResponse.json({ started: true, requestedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not reach GitHub: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 502 },
    );
  }
}
