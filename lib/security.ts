import { createHmac, timingSafeEqual } from "crypto";

/**
 * Execution gate for manual dispatch.
 *
 * The PIN lives on the server only. A correct PIN mints a short-lived signed
 * unlock cookie, and POST /api/dispatch refuses browser-originated runs
 * without one — so the guard is not merely a UI overlay that could be stepped
 * around with a hand-written fetch.
 *
 * WebAuthn is a local presence check performed by the browser. It cannot be
 * verified server-side without a registered credential store, so it is used to
 * *renew* an unlock the PIN already established, never to create one.
 */

export const UNLOCK_COOKIE = "dispatch_unlock";

/** Long enough to confirm and run, short enough that a left-open tab re-locks. */
export const UNLOCK_TTL_MS = 5 * 60_000;

export type UnlockMethod = "PIN" | "WEBAUTHN";

function signingKey(): string {
  // DISPATCH_SECRET is the deployment's existing shared secret; falling back to
  // the PIN keeps single-secret deployments working.
  return process.env.DISPATCH_SECRET || process.env.DISPATCH_PIN || "";
}

/** The gate is only enforceable when a PIN has actually been configured. */
export function isGateConfigured(): boolean {
  return /^\d{4}$/.test(process.env.DISPATCH_PIN ?? "");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isValidPin(candidate: unknown): boolean {
  if (typeof candidate !== "string" || !/^\d{4}$/.test(candidate)) return false;
  return safeEqual(candidate, process.env.DISPATCH_PIN ?? "");
}

/** `<expiresAt>.<method>.<hmac>` */
export function mintUnlockToken(
  method: UnlockMethod,
  now = Date.now(),
): string {
  const expiresAt = now + UNLOCK_TTL_MS;
  const body = `${expiresAt}.${method}`;
  const mac = createHmac("sha256", signingKey()).update(body).digest("hex");
  return `${body}.${mac}`;
}

export interface UnlockState {
  valid: boolean;
  method: UnlockMethod | null;
  expiresAt: number | null;
}

export function readUnlockToken(
  token: string | undefined,
  now = Date.now(),
): UnlockState {
  const invalid: UnlockState = { valid: false, method: null, expiresAt: null };
  if (!token) return invalid;

  const [expiresRaw, method, mac] = token.split(".");
  if (!expiresRaw || !method || !mac) return invalid;
  if (method !== "PIN" && method !== "WEBAUTHN") return invalid;

  const expected = createHmac("sha256", signingKey())
    .update(`${expiresRaw}.${method}`)
    .digest("hex");
  if (!safeEqual(mac, expected)) return invalid;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { valid: false, method, expiresAt };
  }

  return { valid: true, method, expiresAt };
}

/*
 * Attempt throttling. Deliberately in-process: this dashboard runs as a single
 * deployment and a 4-digit space only needs to be slowed, not distributed-rate-
 * limited. Move to Neon or KV if this ever runs multi-region.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

interface AttemptRecord {
  count: number;
  lockedUntil: number;
}

const attempts = new Map<string, AttemptRecord>();

export function attemptStatus(
  key: string,
  now = Date.now(),
): { locked: boolean; retryAfterMs: number; remaining: number } {
  const record = attempts.get(key);
  if (!record) return { locked: false, retryAfterMs: 0, remaining: MAX_ATTEMPTS };
  if (record.lockedUntil > now) {
    return {
      locked: true,
      retryAfterMs: record.lockedUntil - now,
      remaining: 0,
    };
  }
  if (record.lockedUntil !== 0) attempts.delete(key); // lockout served
  return {
    locked: false,
    retryAfterMs: 0,
    remaining: Math.max(0, MAX_ATTEMPTS - record.count),
  };
}

export function registerFailure(key: string, now = Date.now()): number {
  const record = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.count = 0;
  }
  attempts.set(key, record);
  return Math.max(0, MAX_ATTEMPTS - record.count);
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** Best-effort caller identity for throttling. */
export function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}
