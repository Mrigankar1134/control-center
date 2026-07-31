import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  UNLOCK_COOKIE,
  UNLOCK_TTL_MS,
  attemptStatus,
  clearFailures,
  clientKey,
  isGateConfigured,
  isValidPin,
  mintUnlockToken,
  readUnlockToken,
  registerFailure,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — what the console needs to render the gate before showing it. */
export async function GET() {
  const configured = isGateConfigured();
  const state = readUnlockToken(cookies().get(UNLOCK_COOKIE)?.value);

  return NextResponse.json({
    configured,
    unlocked: configured ? state.valid : true,
    method: state.method,
    expiresAt: state.valid ? state.expiresAt : null,
    ttlMs: UNLOCK_TTL_MS,
  });
}

/**
 * POST — pass the security challenge.
 *   { method: "PIN", pin: "1234" }  → verified server-side, mints an unlock
 *   { method: "WEBAUTHN" }          → renews an unlock the PIN already granted
 */
export async function POST(request: Request) {
  if (!isGateConfigured()) {
    return NextResponse.json(
      {
        error:
          "No PIN is configured. Set DISPATCH_PIN to a 4-digit value to arm the security gate.",
        configured: false,
      },
      { status: 409 },
    );
  }

  let body: { method?: unknown; pin?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const method = body.method === "WEBAUTHN" ? "WEBAUTHN" : "PIN";
  const key = clientKey(request);
  const throttle = attemptStatus(key);

  if (throttle.locked) {
    return NextResponse.json(
      {
        error: `Too many incorrect attempts. Try again in ${Math.ceil(
          throttle.retryAfterMs / 1000,
        )}s.`,
        retryAfterMs: throttle.retryAfterMs,
      },
      { status: 429 },
    );
  }

  if (method === "WEBAUTHN") {
    /*
     * The browser has confirmed the device owner is present, but that proof is
     * local. It may only extend an unlock the PIN already established —
     * otherwise a biometric prompt on any device would mint a fresh one.
     */
    const existing = readUnlockToken(cookies().get(UNLOCK_COOKIE)?.value);
    if (!existing.valid) {
      return NextResponse.json(
        {
          error:
            "Biometric unlock needs a PIN unlock first in this session.",
          requiresPin: true,
        },
        { status: 403 },
      );
    }
  } else if (!isValidPin(body.pin)) {
    const remaining = registerFailure(key);
    return NextResponse.json(
      {
        error:
          remaining > 0
            ? `Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : "Incorrect PIN. Further attempts are locked for 60 seconds.",
        remaining,
      },
      { status: 401 },
    );
  }

  clearFailures(key);

  const token = mintUnlockToken(method);
  const response = NextResponse.json({
    unlocked: true,
    method,
    expiresAt: Date.now() + UNLOCK_TTL_MS,
    ttlMs: UNLOCK_TTL_MS,
  });

  response.cookies.set({
    name: UNLOCK_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
  });

  return response;
}

/** DELETE — lock the console again (used by the "Lock" control). */
export async function DELETE() {
  const response = NextResponse.json({ unlocked: false });
  response.cookies.set({
    name: UNLOCK_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
