"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Moon,
  Play,
  ShieldCheck,
  Sunrise,
  X,
  XCircle,
} from "lucide-react";
import * as React from "react";

import { LiveTerminal, type TerminalSession } from "@/components/LiveTerminal";
import { SecurityGate, useSecurityGate } from "@/components/SecurityGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, SummaryList } from "@/components/ui/dialog";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { LabeledSwitch } from "@/components/ui/switch";
import { InfoHint } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import type { ActionType } from "@/db/schema";
import {
  ACTION_META,
  MAX_MANUAL_DELAY_MS,
  TOOLTIPS,
} from "@/lib/constants";
import { useTicker } from "@/lib/hooks";
import { formatWhen, nextDispatch } from "@/lib/schedule";
import type {
  DispatchResponse,
  ExceptionRow,
  LogRow,
  ScheduleRow,
} from "@/lib/types";
import { cn, formatDuration, formatRelativeTime } from "@/lib/utils";

type Phase = "idle" | "queued" | "executing" | "success" | "failed";

interface RunState {
  phase: Phase;
  /** Wall-clock ms at which the queued countdown ends. */
  firesAt: number;
  delayMs: number;
  startedAt: number;
  result: DispatchResponse | null;
  error: string | null;
}

const IDLE: RunState = {
  phase: "idle",
  firesAt: 0,
  delayMs: 0,
  startedAt: 0,
  result: null,
  error: null,
};

export function ManualConsole({
  schedule,
  exceptions,
  logs,
  environment,
  onDispatched,
}: {
  schedule: ScheduleRow[];
  exceptions: ExceptionRow[];
  logs: LogRow[];
  environment: string;
  onDispatched: () => void;
}) {
  // Mobile shows one action at a time; desktop shows both side by side.
  const [mobileAction, setMobileAction] =
    React.useState<ActionType>("ACTION_ALPHA");

  const gate = useSecurityGate();
  const [session, setSession] = React.useState<TerminalSession | null>(null);
  const runCounter = React.useRef(0);

  const startStream = React.useCallback((action: ActionType, runId: string) => {
    runCounter.current += 1;
    setSession({ action, runId, key: runCounter.current });
  }, []);

  const todayIsException = React.useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    return exceptions.find((entry) => entry.exceptionDate === key) ?? null;
  }, [exceptions]);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Manual dispatch"
          description="Run a workflow immediately, outside the weekday schedule. Alpha and Beta are independent and may run concurrently."
          icon={<Play className="h-4 w-4" aria-hidden />}
          actions={<GateIndicator gate={gate} />}
        />

        {/* Manual runs are still allowed today — the operator should just know. */}
        {todayIsException && (
          <p className="flex items-start gap-2 border-b border-warning/20 bg-warning/[0.06] px-5 py-2.5 text-support text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Today is marked as an exception ({todayIsException.reason}).
            Scheduled windows are suppressed; manual dispatch still runs.
          </p>
        )}

        <div className="border-b border-[var(--border-subtle)] px-5 py-3 md:hidden">
          <Segmented
            options={[
              { id: "ACTION_ALPHA" as const, label: "Action Alpha" },
              { id: "ACTION_BETA" as const, label: "Action Beta" },
            ]}
            value={mobileAction}
            onChange={setMobileAction}
            layoutId="mobile-action"
            ariaLabel="Choose action to dispatch"
            fullWidth
          />
        </div>

        <div className="grid divide-y divide-[var(--border-subtle)] md:grid-cols-2 md:divide-x md:divide-y-0">
          {(["ACTION_ALPHA", "ACTION_BETA"] as const).map((action) => (
            <ActionPanel
              key={action}
              action={action}
              schedule={schedule}
              exceptions={exceptions}
              logs={logs}
              environment={environment}
              gate={gate}
              onDispatched={onDispatched}
              onStreamStart={startStream}
              className={cn(
                mobileAction === action ? "block" : "hidden",
                "md:block",
              )}
            />
          ))}
        </div>
      </Panel>

      {/* Sits directly beneath the trigger cards, as the run unfolds. */}
      <AnimatePresence initial={false}>
        {session && (
          <LiveTerminal
            key={session.key}
            session={session}
            onClose={() => setSession(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Lock state for the whole console, shown once in the panel header. */
function GateIndicator({
  gate,
}: {
  gate: ReturnType<typeof useSecurityGate>;
}) {
  const { status, loading, lock } = gate;

  if (loading) return null;

  if (!status.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-meta text-content-muted">
        <Lock className="h-3 w-3" aria-hidden />
        Gate off — set DISPATCH_PIN
      </span>
    );
  }

  if (!status.unlocked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-meta text-content-secondary">
        <Lock className="h-3 w-3" aria-hidden />
        Locked
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void lock()}
      className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-meta text-success transition-colors hover:bg-success/20 focus-ring"
    >
      <ShieldCheck className="h-3 w-3" aria-hidden />
      Unlocked · lock now
    </button>
  );
}

function ActionPanel({
  action,
  schedule,
  exceptions,
  logs,
  environment,
  gate,
  onDispatched,
  onStreamStart,
  className,
}: {
  action: ActionType;
  schedule: ScheduleRow[];
  exceptions: ExceptionRow[];
  logs: LogRow[];
  environment: string;
  gate: ReturnType<typeof useSecurityGate>;
  onDispatched: () => void;
  onStreamStart: (action: ActionType, runId: string) => void;
  className?: string;
}) {
  const meta = ACTION_META[action];
  const isAlpha = action === "ACTION_ALPHA";
  const { toast } = useToast();

  const [immediate, setImmediate] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [challenging, setChallenging] = React.useState(false);
  const [run, setRun] = React.useState<RunState>(IDLE);

  const cancelled = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tapping Run opens the security challenge first. Once the gate is open —
   * or if no PIN is configured — the confirmation summary follows, so the
   * final CTA is still an explicit, named action.
   */
  function requestRun() {
    if (gate.status.configured && !gate.status.unlocked) {
      setChallenging(true);
      return;
    }
    setConfirming(true);
  }

  useTicker(run.phase === "queued" || run.phase === "executing" ? 250 : 60_000);

  const busy = run.phase === "queued" || run.phase === "executing";
  const lastRun = logs.find((log) => log.actionType === action) ?? null;
  const upcoming = React.useMemo(
    () => nextDispatch(schedule, new Date(), exceptions),
    [schedule, exceptions],
  );
  const nextForThisAction = React.useMemo(() => {
    const all = schedule.length
      ? nextDispatch(schedule, new Date(), exceptions)
      : null;
    return all?.action === action ? all : null;
  }, [schedule, exceptions, action]);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  async function send(delayMs: number) {
    setRun((r) => ({ ...r, phase: "executing", startedAt: Date.now() }));

    /*
     * The terminal opens as execution starts, not when the run settles — the
     * point of the stream is to watch it happen. The correlation id is local
     * until the API returns the run's real id.
     */
    const correlationId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().slice(0, 8)
        : String(Date.now());
    onStreamStart(action, correlationId);

    try {
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          bypassDelay: immediate,
          queueDelayMs: delayMs,
        }),
      });
      const data = (await response.json()) as DispatchResponse & {
        error?: string;
        locked?: boolean;
      };

      // The unlock expired between the challenge and the send — re-arm the UI
      // so the next attempt shows the gate rather than failing silently.
      if (response.status === 403 && data.locked) {
        void gate.refresh();
        const message =
          data.error ?? "The security unlock expired. Authorise again.";
        setRun((r) => ({ ...r, phase: "failed", error: message, result: null }));
        toast({
          title: "Dispatch locked",
          description: message,
          variant: "error",
        });
        return;
      }

      if (!response.ok || data.status === "FAILED") {
        const message = data.errorMessage ?? data.error ?? `HTTP ${response.status}`;
        setRun((r) => ({ ...r, phase: "failed", error: message, result: null }));
        toast({
          title: `${meta.label} failed`,
          description: message,
          variant: "error",
          duration: 9000,
        });
      } else {
        setRun((r) => ({ ...r, phase: "success", result: data, error: null }));
        toast({
          title: `${meta.label} completed`,
          description: `Finished in ${formatDuration(data.executionDurationMs)}.`,
          variant: "success",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRun((r) => ({ ...r, phase: "failed", error: message, result: null }));
      toast({
        title: `${meta.label} could not be sent`,
        description: message,
        variant: "error",
        duration: 9000,
      });
    } finally {
      onDispatched();
    }
  }

  function begin() {
    setConfirming(false);
    cancelled.current = false;

    const delayMs = immediate
      ? 0
      : Math.floor(Math.random() * MAX_MANUAL_DELAY_MS);

    if (delayMs === 0) {
      setRun({ ...IDLE, phase: "executing", startedAt: Date.now() });
      void send(0);
      return;
    }

    setRun({
      ...IDLE,
      phase: "queued",
      firesAt: Date.now() + delayMs,
      delayMs,
    });

    timerRef.current = setTimeout(() => {
      if (cancelled.current) return;
      void send(delayMs);
    }, delayMs);
  }

  function cancel() {
    cancelled.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    setRun(IDLE);
    toast({
      title: `${meta.label} cancelled`,
      description: "The run was cancelled before it started.",
      variant: "info",
    });
  }

  return (
    <div className={cn("flex flex-col gap-4 px-5 py-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn("mt-0.5 shrink-0", meta.accentText)}
            aria-hidden
          >
            {isAlpha ? (
              <Sunrise className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-card-title font-semibold text-content-primary">
                {meta.label}
              </h3>
              <InfoHint content={meta.tooltip} label={`About ${meta.label}`} />
            </div>
            <p className="mt-0.5 text-support text-content-muted">
              {meta.role}
            </p>
          </div>
        </div>
        <Badge tone={isAlpha ? "alpha" : "beta"} size="sm">
          {meta.shortLabel}
        </Badge>
      </div>

      {/* The panel itself carries run state — toasts are only supplementary. */}
      <div className="min-h-[104px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={run.phase}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {run.phase === "idle" && (
              <IdleState
                meta={meta}
                isAlpha={isAlpha}
                onRun={requestRun}
                locked={gate.status.configured && !gate.status.unlocked}
              />
            )}
            {run.phase === "queued" && (
              <QueuedState run={run} onCancel={cancel} />
            )}
            {run.phase === "executing" && <ExecutingState meta={meta} run={run} />}
            {(run.phase === "success" || run.phase === "failed") && (
              <SettledState
                run={run}
                meta={meta}
                isAlpha={isAlpha}
                onReset={() => setRun(IDLE)}
                onRunAgain={requestRun}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="well px-3.5 py-3">
        <LabeledSwitch
          label="Start immediately"
          stateLabels={["On", "Off"]}
          checked={immediate}
          onCheckedChange={setImmediate}
          disabled={busy}
          hint={
            <span className="inline-flex items-start gap-1">
              Skip the random execution delay for this run.
              <InfoHint content={TOOLTIPS.immediate} label="About the execution delay" />
            </span>
          }
        />

        {/* Warning appears only while the risky option is active. */}
        <AnimatePresence initial={false}>
          {immediate && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              role="status"
              className="overflow-hidden text-support text-warning"
            >
              <span className="mt-2.5 flex items-start gap-1.5">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                This run will start immediately without the configured safety
                delay.
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-support">
        <div className="flex gap-1.5">
          <dt className="text-content-muted">Last run</dt>
          <dd className="text-content-secondary">
            {lastRun
              ? `${formatRelativeTime(lastRun.timestamp)} · ${lastRun.status === "SUCCESS" ? "success" : lastRun.status.toLowerCase()}`
              : "Never"}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-content-muted">Next scheduled</dt>
          <dd className="text-content-secondary">
            {nextForThisAction ? formatWhen(nextForThisAction.at) : "Not next"}
          </dd>
        </div>
      </dl>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Run ${meta.label} now?`}
        description={meta.description}
        confirmLabel={
          immediate ? "Run Without Random Delay" : meta.confirmCta
        }
        confirmVariant={isAlpha ? "alpha" : "beta"}
        onConfirm={begin}
        warning={
          environment === "production"
            ? "This will execute against the production environment."
            : undefined
        }
      >
        <SummaryList
          items={[
            { label: "Action", value: meta.label },
            {
              label: "Environment",
              value: (
                <span className="capitalize">{environment}</span>
              ),
            },
            {
              label: "Delay behaviour",
              value: immediate
                ? "Immediate — no jitter"
                : `Random, up to ${MAX_MANUAL_DELAY_MS / 1000}s`,
            },
            {
              label: "Last result",
              value: lastRun
                ? `${lastRun.status === "SUCCESS" ? "Success" : "Failed"} · ${formatRelativeTime(lastRun.timestamp)}`
                : "No previous run",
            },
            {
              label: "Next scheduled run",
              value: upcoming ? formatWhen(upcoming.at) : "None",
            },
          ]}
        />
      </ConfirmDialog>

      <SecurityGate
        open={challenging}
        onOpenChange={setChallenging}
        actionLabel={meta.label}
        accent={isAlpha ? "alpha" : "beta"}
        onStatusChange={(status) => gate.setStatus(status)}
        onUnlocked={() => setConfirming(true)}
      />
    </div>
  );
}

function IdleState({
  meta,
  isAlpha,
  locked,
  onRun,
}: {
  meta: (typeof ACTION_META)[ActionType];
  isAlpha: boolean;
  locked: boolean;
  onRun: () => void;
}) {
  return (
    <div>
      <p className="mb-3 text-support leading-relaxed text-content-muted">
        {meta.description}
      </p>
      <Button
        variant={isAlpha ? "alpha" : "beta"}
        size="lg"
        fullWidth
        onClick={onRun}
        icon={
          locked ? (
            <Lock className="h-4 w-4" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )
        }
      >
        {meta.cta}
      </Button>
      {locked && (
        <p className="mt-2 text-center text-meta text-content-disabled">
          Requires PIN or biometric authorisation
        </p>
      )}
    </div>
  );
}

function QueuedState({
  run,
  onCancel,
}: {
  run: RunState;
  onCancel: () => void;
}) {
  const remaining = Math.max(0, run.firesAt - Date.now());
  const progress =
    run.delayMs > 0 ? 1 - remaining / run.delayMs : 1;

  return (
    <div role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body-lg font-medium text-content-primary">Queued</p>
        <p className="tabular font-mono text-body text-warning">
          begins in {Math.ceil(remaining / 1000)}s
        </p>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Time until execution begins"
      >
        <div
          className="h-full rounded-full bg-warning/70 transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>

      <p className="mt-2.5 text-support text-content-muted">
        Waiting out the random execution delay.
      </p>

      <Button
        variant="secondary"
        size="sm"
        fullWidth
        className="mt-3"
        onClick={onCancel}
        icon={<X className="h-3.5 w-3.5" aria-hidden />}
      >
        Cancel dispatch
      </Button>
    </div>
  );
}

function ExecutingState({
  meta,
  run,
}: {
  meta: (typeof ACTION_META)[ActionType];
  run: RunState;
}) {
  const elapsed = Math.max(0, Date.now() - run.startedAt);
  const seconds = Math.floor(elapsed / 1000);

  return (
    <div role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body-lg font-medium text-content-primary">
          Executing {meta.label}
        </p>
        <p className="tabular font-mono text-body text-content-secondary">
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </p>
      </div>

      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="absolute inset-y-0 w-1/3 animate-indeterminate rounded-full bg-alpha/70" />
      </div>

      <p className="mt-2.5 text-support text-content-muted">
        Dispatch sent — waiting for the downstream runner to respond.
      </p>
    </div>
  );
}

function SettledState({
  run,
  meta,
  isAlpha,
  onReset,
  onRunAgain,
}: {
  run: RunState;
  meta: (typeof ACTION_META)[ActionType];
  isAlpha: boolean;
  onReset: () => void;
  onRunAgain: () => void;
}) {
  const ok = run.phase === "success";

  return (
    <div role="status" aria-live="polite">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 shrink-0", ok ? "text-success" : "text-danger")}>
          {ok ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-lg font-medium text-content-primary">
            {ok
              ? `Completed in ${formatDuration(run.result?.executionDurationMs ?? null)}`
              : "Dispatch failed"}
          </p>
          <p className="mt-1 break-words text-support leading-relaxed text-content-muted">
            {ok
              ? `Delivered via ${run.result?.driver ?? "unknown driver"}${
                  run.delayMs > 0
                    ? ` after a ${Math.round(run.delayMs / 1000)}s queue delay`
                    : ""
                }.`
              : run.error}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          variant={isAlpha ? "alpha" : "beta"}
          size="sm"
          onClick={onRunAgain}
          icon={<Play className="h-3.5 w-3.5" aria-hidden />}
        >
          Run again
        </Button>
        <Button variant="ghost" size="sm" onClick={onReset}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
