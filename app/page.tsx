"use client";

import * as React from "react";

import { DispatchCard } from "@/components/DispatchCard";
import { ExceptionsCard } from "@/components/ExceptionsCard";
import { RunsCard } from "@/components/RunsCard";
import { ScheduleCard } from "@/components/ScheduleCard";
import { StatusCard } from "@/components/StatusCard";
import { TopBar, type SystemStatus } from "@/components/TopBar";
import { useExceptions, useLogs, useSchedule } from "@/lib/hooks";

/*
 * One page, five cards, in the order the questions actually get asked:
 * what is happening now, make something happen, when will it happen next,
 * when should it not, and what happened before.
 *
 * The previous console had four tab views over ten panels. Nothing here is
 * behind a tab — on a phone it is a single scroll, and on a wide screen the
 * schedule and skip-days sit side by side.
 */
export default function Page() {
  const schedule = useSchedule();
  const logs = useLogs();
  const exceptions = useExceptions();

  // A single failure is a panel-level error; both failing is a system fact.
  const degraded = schedule.error && logs.error ? "Database unreachable" : null;

  const status: SystemStatus = degraded
    ? "degraded"
    : schedule.automationEnabled
      ? "online"
      : "paused";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
      <TopBar status={status} />

      <main id="main" className="flex flex-col gap-4">
        <StatusCard
          schedule={schedule.schedule}
          exceptions={exceptions.exceptions}
          loading={schedule.loading}
          degraded={degraded}
        />

        <DispatchCard onDispatched={() => void logs.refresh()} />

        <div className="grid gap-4 lg:grid-cols-2">
          <ScheduleCard
            schedule={schedule.schedule}
            loading={schedule.loading}
            saveState={schedule.saveState}
            patchDay={schedule.patchDay}
            patchMany={schedule.patchMany}
            onRetry={schedule.retry}
          />
          <ExceptionsCard
            exceptions={exceptions.exceptions}
            loading={exceptions.loading}
            onSave={exceptions.save}
            onRemove={exceptions.remove}
          />
        </div>

        <RunsCard
          logs={logs.logs}
          loading={logs.loading}
          refreshing={logs.refreshing}
          error={logs.error}
          onRefresh={() => void logs.refresh()}
        />

        <p className="px-1 pt-2 text-caption text-ink-faint">
          Scheduled runs are fired by EventBridge, not GitHub cron. Times shown here
          are what the console holds; the firing clock lives in{" "}
          <code className="font-mono">infra/eventbridge/</code>.
        </p>
      </main>
    </div>
  );
}
