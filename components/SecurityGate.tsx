"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import {
  Delete,
  Fingerprint,
  Loader2,
  Lock,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PIN_LENGTH = 4;

export interface GateStatus {
  /** A PIN is configured server-side, so the gate is armed. */
  configured: boolean;
  unlocked: boolean;
  method: "PIN" | "WEBAUTHN" | null;
  expiresAt: number | null;
}

const INITIAL: GateStatus = {
  configured: true, // Assume armed until told otherwise — fail closed in the UI.
  unlocked: false,
  method: null,
  expiresAt: null,
};

/**
 * Client half of the execution gate. The server is the authority: this hook
 * only mirrors what /api/auth/verify reports, so a stale `unlocked` here can
 * never let a dispatch through on its own.
 */
export function useSecurityGate() {
  const [status, setStatus] = React.useState<GateStatus>(INITIAL);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/auth/verify", { cache: "no-store" });
      const data = (await response.json()) as GateStatus;
      setStatus({
        configured: data.configured,
        unlocked: data.unlocked,
        method: data.method ?? null,
        expiresAt: data.expiresAt ?? null,
      });
    } catch {
      // Network trouble must not silently unlock the console.
      setStatus((s) => ({ ...s, unlocked: false }));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-lock the UI the moment the unlock expires, without waiting for a poll.
  React.useEffect(() => {
    if (!status.unlocked || !status.expiresAt) return;
    const remaining = status.expiresAt - Date.now();
    if (remaining <= 0) {
      setStatus((s) => ({ ...s, unlocked: false, expiresAt: null }));
      return;
    }
    const timer = setTimeout(
      () => setStatus((s) => ({ ...s, unlocked: false, expiresAt: null })),
      remaining,
    );
    return () => clearTimeout(timer);
  }, [status.unlocked, status.expiresAt]);

  const lock = React.useCallback(async () => {
    try {
      await fetch("/api/auth/verify", { method: "DELETE" });
    } finally {
      setStatus((s) => ({ ...s, unlocked: false, method: null, expiresAt: null }));
    }
  }, []);

  return { status, setStatus, loading, refresh, lock };
}

/** True when the browser can even offer a biometric prompt. */
function webAuthnAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials?.get
  );
}

/**
 * Native presence check. This proves the device owner is here; it is not a
 * server-verifiable assertion, which is why the API only lets it renew an
 * unlock the PIN already established.
 */
async function requestBiometric(): Promise<boolean> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60_000,
      userVerification: "required",
      rpId: window.location.hostname,
    },
  });
  return credential !== null;
}

export function SecurityGate({
  open,
  onOpenChange,
  actionLabel,
  accent = "alpha",
  onUnlocked,
  onStatusChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dispatch being authorised, e.g. "Action Alpha". */
  actionLabel: string;
  accent?: "alpha" | "beta";
  onUnlocked: () => void;
  onStatusChange?: (status: GateStatus) => void;
}) {
  const [digits, setDigits] = React.useState<string[]>(
    Array(PIN_LENGTH).fill(""),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [shake, setShake] = React.useState(0);
  const [biometricOffered, setBiometricOffered] = React.useState(false);

  const inputs = React.useRef<Array<HTMLInputElement | null>>([]);
  const pin = digits.join("");

  React.useEffect(() => {
    if (!open) return;
    setDigits(Array(PIN_LENGTH).fill(""));
    setError(null);
    setBusy(false);
    setBiometricOffered(webAuthnAvailable());
    // Radix moves focus into the panel; steer it to the first cell.
    const timer = setTimeout(() => inputs.current[0]?.focus(), 220);
    return () => clearTimeout(timer);
  }, [open]);

  const succeed = React.useCallback(
    (status: GateStatus) => {
      onStatusChange?.(status);
      onOpenChange(false);
      onUnlocked();
    },
    [onOpenChange, onStatusChange, onUnlocked],
  );

  const reject = React.useCallback((message: string) => {
    setError(message);
    setShake((n) => n + 1);
    setDigits(Array(PIN_LENGTH).fill(""));
    setBusy(false);
    inputs.current[0]?.focus();
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([12, 60, 12]);
    }
  }, []);

  const submitPin = React.useCallback(
    async (value: string) => {
      if (value.length !== PIN_LENGTH || busy) return;
      setBusy(true);
      setError(null);

      try {
        const response = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "PIN", pin: value }),
        });
        const data = (await response.json()) as {
          error?: string;
          expiresAt?: number;
        };

        if (!response.ok) {
          reject(data.error ?? `Verification failed (HTTP ${response.status}).`);
          return;
        }

        succeed({
          configured: true,
          unlocked: true,
          method: "PIN",
          expiresAt: data.expiresAt ?? null,
        });
      } catch (err) {
        reject(err instanceof Error ? err.message : String(err));
      }
    },
    [busy, reject, succeed],
  );

  async function useBiometric() {
    setBusy(true);
    setError(null);
    try {
      const ok = await requestBiometric();
      if (!ok) {
        reject("Biometric check was dismissed.");
        return;
      }

      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "WEBAUTHN" }),
      });
      const data = (await response.json()) as {
        error?: string;
        expiresAt?: number;
      };

      if (!response.ok) {
        reject(data.error ?? "Biometric unlock was refused.");
        return;
      }

      succeed({
        configured: true,
        unlocked: true,
        method: "WEBAUTHN",
        expiresAt: data.expiresAt ?? null,
      });
    } catch (err) {
      // NotAllowedError is the normal "user cancelled" path — not a fault.
      const name = err instanceof Error ? err.name : "";
      reject(
        name === "NotAllowedError"
          ? "Biometric check was cancelled. Enter the PIN instead."
          : `Biometric unlock unavailable: ${
              err instanceof Error ? err.message : String(err)
            }`,
      );
    }
  }

  function setDigit(index: number, raw: string) {
    const value = raw.replace(/\D/g, "");
    const next = [...digits];

    if (!value) {
      next[index] = "";
      setDigits(next);
      return;
    }

    // A paste fills forward from the focused cell.
    value
      .slice(0, PIN_LENGTH - index)
      .split("")
      .forEach((char, offset) => {
        next[index + offset] = char;
      });

    setDigits(next);
    setError(null);
    inputs.current[Math.min(index + value.length, PIN_LENGTH - 1)]?.focus();

    // Submitting on the last digit is what makes this feel like a device PIN.
    if (next.every((digit) => digit !== "")) void submitPin(next.join(""));
  }

  function onKeyDown(index: number, event: React.KeyboardEvent) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
      setDigits((current) => {
        const next = [...current];
        next[index - 1] = "";
        return next;
      });
    }
    if (event.key === "ArrowLeft" && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < PIN_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
    if (event.key === "Enter") void submitPin(pin);
  }

  const accentRing =
    accent === "alpha"
      ? "focus:border-alpha/60 focus:shadow-[0_0_0_3px_rgba(79,172,254,0.18)]"
      : "focus:border-beta/60 focus:shadow-[0_0_0_3px_rgba(180,124,255,0.18)]";

  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Root open onOpenChange={onOpenChange}>
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 bg-bg-primary/80 backdrop-blur-md"
              />
            </DialogPrimitive.Overlay>

            <DialogPrimitive.Content asChild forceMount>
              {/* Slides up from the thumb, not down from the top. */}
              <motion.div
                initial={{ y: "100%", opacity: 0.6 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "100%", opacity: 0.4 }}
                transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
                className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md focus:outline-none sm:bottom-8 sm:px-4"
              >
                <motion.div
                  key={shake}
                  animate={
                    shake > 0 ? { x: [0, -9, 8, -5, 0] } : undefined
                  }
                  transition={{ duration: 0.34 }}
                  className="overflow-hidden rounded-t-panel border border-white/10 bg-surface-primary/70 shadow-elevated backdrop-blur-xl sm:rounded-panel"
                  style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                  <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control border",
                          accent === "alpha"
                            ? "border-alpha/25 bg-alpha/10 text-alpha"
                            : "border-beta/25 bg-beta/10 text-beta",
                        )}
                        aria-hidden
                      >
                        <Lock className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <DialogPrimitive.Title className="text-card-title font-semibold text-content-primary">
                          Authorise dispatch
                        </DialogPrimitive.Title>
                        <DialogPrimitive.Description className="mt-0.5 text-support leading-relaxed text-content-muted">
                          {actionLabel} is gated. Confirm it is you before the
                          run is sent.
                        </DialogPrimitive.Description>
                      </div>
                    </div>
                    <DialogPrimitive.Close
                      aria-label="Cancel authorisation"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary focus-ring"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </DialogPrimitive.Close>
                  </header>

                  <div className="px-5 py-5">
                    <label
                      htmlFor="pin-0"
                      className="block text-support font-medium text-content-secondary"
                    >
                      Security PIN
                    </label>

                    <div className="mt-2.5 flex justify-between gap-2.5">
                      {digits.map((digit, index) => (
                        <input
                          key={index}
                          id={`pin-${index}`}
                          ref={(node) => {
                            inputs.current[index] = node;
                          }}
                          value={digit}
                          onChange={(event) =>
                            setDigit(index, event.target.value)
                          }
                          onKeyDown={(event) => onKeyDown(index, event)}
                          onFocus={(event) => event.currentTarget.select()}
                          disabled={busy}
                          type="password"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={PIN_LENGTH}
                          size={1}
                          aria-label={`PIN digit ${index + 1} of ${PIN_LENGTH}`}
                          aria-invalid={error ? true : undefined}
                          /* min-w-0 is load-bearing: without it the intrinsic
                             input width refuses to shrink and the four cells
                             overflow the sheet on narrow screens. */
                          className={cn(
                            "h-14 w-full min-w-0 flex-1 rounded-control border border-white/10 bg-white/[0.04] px-0 text-center font-mono text-metric text-content-primary outline-none transition-all",
                            "disabled:opacity-50",
                            error ? "border-danger/50" : accentRing,
                          )}
                        />
                      ))}
                    </div>

                    <div className="mt-3 min-h-[20px]" aria-live="polite">
                      {error && (
                        <p className="flex items-start gap-1.5 text-support text-danger">
                          <ShieldAlert
                            className="mt-px h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                          {error}
                        </p>
                      )}
                      {!error && busy && (
                        <p className="flex items-center gap-1.5 text-support text-content-muted">
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden
                          />
                          Verifying…
                        </p>
                      )}
                    </div>

                    {biometricOffered && (
                      <>
                        <div className="my-4 flex items-center gap-3">
                          <span className="h-px flex-1 bg-white/[0.08]" />
                          <span className="text-meta uppercase tracking-wider text-content-disabled">
                            or
                          </span>
                          <span className="h-px flex-1 bg-white/[0.08]" />
                        </div>

                        <Button
                          variant="secondary"
                          size="lg"
                          fullWidth
                          disabled={busy}
                          onClick={() => void useBiometric()}
                          icon={<Fingerprint className="h-4 w-4" aria-hidden />}
                        >
                          Use Face ID / Touch ID
                        </Button>
                        <p className="mt-2 text-meta leading-relaxed text-content-disabled">
                          Biometric unlock extends a PIN unlock from earlier in
                          this session.
                        </p>
                      </>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setDigits(Array(PIN_LENGTH).fill(""))}
                        disabled={busy || !pin}
                        className="inline-flex items-center gap-1.5 text-support text-content-muted transition-colors hover:text-content-primary disabled:opacity-40 focus-ring rounded-control px-1 py-1"
                      >
                        <Delete className="h-3.5 w-3.5" aria-hidden />
                        Clear
                      </button>
                      <Button
                        variant={accent}
                        size="sm"
                        loading={busy}
                        disabled={pin.length !== PIN_LENGTH}
                        onClick={() => void submitPin(pin)}
                        icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
                      >
                        Unlock
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </AnimatePresence>
  );
}
