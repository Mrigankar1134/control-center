"use client";

import * as React from "react";

import { Button, Card, CardHeader, Dot, cx } from "@/components/glass";
import { useToast } from "@/components/ui/toast";
import type { ActionType } from "@/db/schema";
import type { DispatchResponse } from "@/lib/types";

/*
 * The only part of the console that changes anything in the real world, so it
 * is the only part that gets colour and the largest hit targets on the page.
 *
 * ACTION_ALPHA is the morning punch and ACTION_BETA the evening one. The old
 * console showed them under those code names; here they say what they do,
 * because "Action Beta" tells an operator at 18:40 nothing useful.
 */

const ACTIONS: Record<
  ActionType,
  { title: string; caption: string; tone: "in" | "out" }
> = {
  ACTION_ALPHA: {
    title: "Check in",
    caption: "Morning punch",
    tone: "in",
  },
  ACTION_BETA: {
    title: "Check out",
    caption: "Evening punch",
    tone: "out",
  },
};

interface GateStatus {
  configured: boolean;
  unlocked: boolean;
  expiresAt: string | null;
}

/** Reads and refreshes the security gate that guards manual dispatch. */
function useGate() {
  const [status, setStatus] = React.useState<GateStatus>({
    configured: false,
    unlocked: true,
    expiresAt: null,
  });
  const [checked, setChecked] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/auth/verify", { cache: "no-store" });
      const data = (await response.json()) as GateStatus;
      setStatus(data);
    } catch {
      // A gate we cannot read is treated as locked: the server enforces it
      // regardless, so guessing "unlocked" would only produce a confusing 403.
      setStatus({ configured: true, unlocked: false, expiresAt: null });
    } finally {
      setChecked(true);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const unlock = React.useCallback(
    async (pin: string) => {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "PIN", pin }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      await refresh();
    },
    [refresh],
  );

  return { status, checked, unlock, refresh };
}

export function DispatchCard({ onDispatched }: { onDispatched: () => void }) {
  const { toast } = useToast();
  const gate = useGate();

  const [pending, setPending] = React.useState<ActionType | null>(null);
  const [confirming, setConfirming] = React.useState<ActionType | null>(null);
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);
  const [unlocking, setUnlocking] = React.useState(false);

  const locked = gate.status.configured && !gate.status.unlocked;

  async function submitPin(event: React.FormEvent) {
    event.preventDefault();
    setUnlocking(true);
    setPinError(null);
    try {
      await gate.unlock(pin);
      setPin("");
      toast({ title: "Unlocked", description: "Manual dispatch is available.", variant: "success" });
    } catch (error) {
      setPinError(error instanceof Error ? error.message : String(error));
      setPin("");
    } finally {
      setUnlocking(false);
    }
  }

  async function dispatch(action: ActionType) {
    setConfirming(null);
    setPending(action);
    try {
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: "MANUAL", bypassDelay: true }),
      });
      const data = (await response.json()) as DispatchResponse & {
        error?: string;
        locked?: boolean;
      };

      if (data.locked) {
        // The unlock expired between arming and sending; re-arm rather than
        // reporting a failure the operator can do nothing about.
        await gate.refresh();
        throw new Error("The security unlock expired. Authorise again.");
      }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

      toast({
        title: `${ACTIONS[action].title} dispatched`,
        description: "The workflow starts within a few seconds.",
        variant: "success",
      });
      onDispatched();
    } catch (error) {
      toast({
        title: "Dispatch failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Dispatch"
        subtitle="Runs now, outside the schedule"
        right={
          locked ? (
            <span className="inline-flex items-center gap-1.5 text-caption text-ink-faint">
              <Dot tone="warn" /> Locked
            </span>
          ) : gate.status.configured ? (
            <span className="inline-flex items-center gap-1.5 text-caption text-ink-faint">
              <Dot tone="ok" /> Unlocked
            </span>
          ) : null
        }
      />

      {locked ? (
        <form onSubmit={submitPin} className="px-5 pb-5">
          <label htmlFor="pin" className="text-footnote text-ink-soft">
            Enter the 4-digit PIN to enable manual dispatch.
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="pin"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="––––"
              className="glass-sunken tnum h-11 w-32 rounded-control px-3 text-center text-headline tracking-[0.4em] text-ink outline-none"
            />
            <Button type="submit" tone="in" disabled={pin.length !== 4 || unlocking}>
              {unlocking ? "Checking…" : "Unlock"}
            </Button>
          </div>
          {pinError ? (
            <p className="mt-2 text-footnote" style={{ color: "var(--bad)" }}>
              {pinError}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          {(Object.keys(ACTIONS) as ActionType[]).map((action) => {
            const meta = ACTIONS[action];
            const isConfirming = confirming === action;
            const isPending = pending === action;

            return (
              <div key={action} className="flex flex-col gap-2">
                <Button
                  tone={isConfirming ? "danger" : meta.tone}
                  size="lg"
                  disabled={pending !== null || !gate.checked}
                  onClick={() => (isConfirming ? void dispatch(action) : setConfirming(action))}
                  className="w-full flex-col !items-start gap-0.5"
                >
                  <span className="text-body font-semibold">
                    {isPending ? "Dispatching…" : isConfirming ? "Tap again to confirm" : meta.title}
                  </span>
                  <span className="text-caption font-normal opacity-80">
                    {isConfirming ? "This punches for real" : meta.caption}
                  </span>
                </Button>
                {isConfirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="text-caption text-ink-faint underline-offset-2 hover:underline"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className={cx("px-5 pb-4 text-caption text-ink-faint")}>
        A manual check-out skips the 9.5-hour verification — the schedule does not.
      </p>
    </Card>
  );
}
