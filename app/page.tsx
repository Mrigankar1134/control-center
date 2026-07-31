"use client";

import * as React from "react";

import { AppShell, type Environment, type SystemStatus } from "@/components/AppShell";
import { AuditTrail } from "@/components/AuditTrail";
import { ExceptionCalendar } from "@/components/ExceptionCalendar";
import { ExecutionActivity } from "@/components/ExecutionActivity";
import { ExecutionLogs } from "@/components/ExecutionLogs";
import { ManualConsole } from "@/components/ManualConsole";
import { MetricsPanel } from "@/components/MetricsPanel";
import { ScheduleMatrix } from "@/components/ScheduleMatrix";
import { SystemPanel } from "@/components/SystemPanel";
import { UpcomingTimeline } from "@/components/UpcomingTimeline";
import { useToast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { VIEWS, type TimeframeId, type ViewId } from "@/lib/constants";
import { useExceptions, useLogs, useSchedule } from "@/lib/hooks";
import type { LogRow } from "@/lib/types";

const ENVIRONMENT = ((process.env.NEXT_PUBLIC_ENVIRONMENT ??
  "development") as Environment) satisfies Environment;

export default function DashboardPage() {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={300}>
      <Dashboard />
    </TooltipProvider>
  );
}

function Dashboard() {
  const { toast } = useToast();
  const schedule = useSchedule();
  const logs = useLogs();
  const exceptions = useExceptions();

  const [view, setView] = React.useState<ViewId>("overview");

  /*
   * Home-screen shortcuts land on /?view=dispatch. Read after mount so the
   * server-rendered markup and the first client render agree.
   */
  React.useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (VIEWS.some((item) => item.id === requested)) {
      setView(requested as ViewId);
    }
  }, []);

  const [timeframe, setTimeframe] = React.useState<TimeframeId>("7d");
  const [selectedLog, setSelectedLog] = React.useState<LogRow | null>(null);
  const [auditKey, setAuditKey] = React.useState(0);

  const refreshAll = React.useCallback(() => {
    void logs.refresh();
    setAuditKey((k) => k + 1);
  }, [logs]);

  function handleSetAutomation(enabled: boolean) {
    schedule.setAllEnabled(
      enabled,
      enabled
        ? "Resumed from the system panel"
        : "Paused from the system panel",
    );
    setAuditKey((k) => k + 1);
    toast({
      title: enabled ? "Automation resumed" : "Automation paused",
      description: enabled
        ? "All five weekday windows are active again."
        : "No scheduled window will fire until automation is resumed.",
      variant: enabled ? "success" : "info",
    });
  }

  /** Re-running from the drawer hands off to the Dispatch view. */
  function handleRetryDispatch(log: LogRow) {
    setSelectedLog(null);
    setView("dispatch");
    toast({
      title: "Ready to re-run",
      description: `Confirm the ${log.actionType === "ACTION_ALPHA" ? "Alpha" : "Beta"} dispatch below to retry.`,
      variant: "info",
    });
  }

  const failuresToday = React.useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return logs.logs.filter(
      (log) =>
        log.status === "FAILED" &&
        new Date(log.timestamp).getTime() >= startOfDay.getTime(),
    ).length;
  }, [logs.logs]);

  // Database unreachable is a system-health fact, not a table-level error.
  const degraded = schedule.error && logs.error ? "Database unreachable" : null;

  const systemStatus: SystemStatus = degraded
    ? "degraded"
    : schedule.automationEnabled
      ? "online"
      : "paused";

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      systemStatus={systemStatus}
      failureCount={failuresToday}
    >
      {view === "overview" && (
        <div className="flex flex-col gap-5">
          <SystemPanel
            schedule={schedule.schedule}
            exceptions={exceptions.exceptions}
            scheduleLoading={schedule.loading}
            automationEnabled={schedule.automationEnabled}
            activeDays={schedule.activeDays}
            onSetAutomation={handleSetAutomation}
            logs={logs.logs}
            degraded={degraded}
          />

          {/* 12-column intent: 8 for work, 4 for context. */}
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="flex flex-col gap-5 xl:col-span-2">
              <MetricsPanel
                logs={logs.logs}
                loading={logs.loading}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
              />
              <ManualConsole
                schedule={schedule.schedule}
                exceptions={exceptions.exceptions}
                logs={logs.logs}
                environment={ENVIRONMENT}
                onDispatched={refreshAll}
              />
            </div>

            <div className="flex flex-col gap-5">
              <ExecutionActivity
                logs={logs.logs}
                loading={logs.loading}
                onViewAll={() => setView("executions")}
                onInspect={(log) => {
                  setSelectedLog(log);
                  setView("executions");
                }}
              />
              <UpcomingTimeline
                schedule={schedule.schedule}
                exceptions={exceptions.exceptions}
                automationEnabled={schedule.automationEnabled}
                limit={5}
              />
            </div>
          </div>

          {/* Compact enough now to live on the overview without burying the console. */}
          <ScheduleMatrix
            schedule={schedule.schedule}
            loading={schedule.loading}
            saveState={schedule.saveState}
            lastSavedAt={schedule.lastSavedAt}
            patchDay={schedule.patchDay}
            patchMany={(days, patch, reason) => {
              schedule.patchMany(days, patch, reason);
              setAuditKey((k) => k + 1);
            }}
            onRetry={schedule.retry}
          />
        </div>
      )}

      {view === "dispatch" && (
        <div className="flex flex-col gap-5">
          <SystemPanel
            schedule={schedule.schedule}
            exceptions={exceptions.exceptions}
            scheduleLoading={schedule.loading}
            automationEnabled={schedule.automationEnabled}
            activeDays={schedule.activeDays}
            onSetAutomation={handleSetAutomation}
            logs={logs.logs}
            degraded={degraded}
          />
          <ManualConsole
            schedule={schedule.schedule}
            exceptions={exceptions.exceptions}
            logs={logs.logs}
            environment={ENVIRONMENT}
            onDispatched={refreshAll}
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <ExecutionActivity
              logs={logs.logs}
              loading={logs.loading}
              onViewAll={() => setView("executions")}
              onInspect={(log) => {
                setSelectedLog(log);
                setView("executions");
              }}
            />
            <UpcomingTimeline
              schedule={schedule.schedule}
              exceptions={exceptions.exceptions}
              automationEnabled={schedule.automationEnabled}
              limit={5}
            />
          </div>
        </div>
      )}

      {view === "schedule" && (
        <div className="flex flex-col gap-5">
          <ScheduleMatrix
            schedule={schedule.schedule}
            loading={schedule.loading}
            saveState={schedule.saveState}
            lastSavedAt={schedule.lastSavedAt}
            patchDay={schedule.patchDay}
            patchMany={(days, patch, reason) => {
              schedule.patchMany(days, patch, reason);
              setAuditKey((k) => k + 1);
            }}
            onRetry={schedule.retry}
          />

          {/* The calendar sits beside the matrix: one says when, one says never. */}
          <div className="grid gap-5 lg:grid-cols-2">
            <ExceptionCalendar
              exceptions={exceptions.exceptions}
              loading={exceptions.loading}
              error={exceptions.error}
              onSave={async (date, reason) => {
                const ok = await exceptions.save(date, reason);
                if (ok) setAuditKey((k) => k + 1);
                return ok;
              }}
              onRemove={async (date) => {
                const ok = await exceptions.remove(date);
                if (ok) setAuditKey((k) => k + 1);
                return ok;
              }}
            />
            <UpcomingTimeline
              schedule={schedule.schedule}
              exceptions={exceptions.exceptions}
              automationEnabled={schedule.automationEnabled}
              limit={8}
            />
          </div>

          <AuditTrail refreshKey={auditKey} />
        </div>
      )}

      {view === "executions" && (
        <div className="flex flex-col gap-5">
          <MetricsPanel
            logs={logs.logs}
            loading={logs.loading}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />
          <ExecutionLogs
            logs={logs.logs}
            loading={logs.loading}
            refreshing={logs.refreshing}
            error={logs.error}
            onRefresh={refreshAll}
            selected={selectedLog}
            onSelect={setSelectedLog}
            onRetryDispatch={handleRetryDispatch}
          />
        </div>
      )}
    </AppShell>
  );
}
