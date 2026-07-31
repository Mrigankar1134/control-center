"use client";

import {
  CalendarRange,
  Gauge,
  History,
  Hexagon,
  Zap,
} from "lucide-react";
import * as React from "react";

import { Segmented } from "@/components/ui/segmented";
import { VIEWS, type ViewId } from "@/lib/constants";
import { useMounted, useTicker } from "@/lib/hooks";
import { timeZoneAbbreviation } from "@/lib/schedule";
import { cn, formatClock } from "@/lib/utils";

const VIEW_ICONS: Record<ViewId, React.ReactNode> = {
  overview: <Gauge className="h-4 w-4" />,
  dispatch: <Zap className="h-4 w-4" />,
  schedule: <CalendarRange className="h-4 w-4" />,
  executions: <History className="h-4 w-4" />,
};

export type Environment = "production" | "staging" | "development";

/** Header health signal. Never names the deployment environment. */
export type SystemStatus = "online" | "paused" | "degraded";

const STATUS_META: Record<
  SystemStatus,
  { label: string; dot: string; glow: string; text: string }
> = {
  online: {
    label: "Systems nominal",
    dot: "bg-success",
    glow: "shadow-[0_0_10px_2px_rgba(0,245,160,0.55)]",
    text: "text-success",
  },
  paused: {
    label: "Automation paused",
    dot: "bg-warning",
    glow: "shadow-[0_0_10px_2px_rgba(255,179,0,0.5)]",
    text: "text-warning",
  },
  degraded: {
    label: "Link degraded",
    dot: "bg-danger",
    glow: "shadow-[0_0_10px_2px_rgba(255,51,102,0.5)]",
    text: "text-danger",
  },
};

export function AppShell({
  view,
  onViewChange,
  systemStatus,
  failureCount,
  children,
}: {
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  systemStatus: SystemStatus;
  failureCount: number;
  children: React.ReactNode;
}) {
  const navOptions = VIEWS.map((v) => ({
    id: v.id,
    label: v.label,
    icon: VIEW_ICONS[v.id],
    count: v.id === "executions" ? failureCount : undefined,
  }));

  return (
    <div className="min-h-screen pb-20 lg:pb-0">
      <TopBar
        systemStatus={systemStatus}
        view={view}
        onViewChange={onViewChange}
        navOptions={navOptions}
      />

      <main
        id="main"
        className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
      >
        {children}
      </main>

      <BottomNav
        view={view}
        onViewChange={onViewChange}
        failureCount={failureCount}
      />
    </div>
  );
}

function TopBar({
  systemStatus,
  view,
  onViewChange,
  navOptions,
}: {
  systemStatus: SystemStatus;
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  navOptions: Array<{
    id: ViewId;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }>;
}) {
  const status = STATUS_META[systemStatus];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-bg-primary/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Hexagon
            className="h-5 w-5 shrink-0 text-alpha"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="truncate text-body-lg font-semibold text-content-primary">
            Neural Control
          </span>
          {/*
            The header carries system health only — deliberately no
            environment pill, so the title area stays clean.
          */}
          <span
            className="ml-1.5 flex shrink-0 items-center gap-1.5"
            title={status.label}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 animate-breathe rounded-full",
                status.dot,
                status.glow,
              )}
              aria-hidden
            />
            <span
              className={cn(
                "hidden text-meta font-medium sm:inline",
                status.text,
              )}
            >
              {status.label}
            </span>
            <span className="sr-only">{status.label}</span>
          </span>
        </div>

        <nav className="mx-auto hidden lg:block" aria-label="Primary">
          <Segmented
            options={navOptions}
            value={view}
            onChange={onViewChange}
            layoutId="primary-nav"
            ariaLabel="Primary navigation"
            size="sm"
          />
        </nav>

        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          <Clock />
        </div>
      </div>
    </header>
  );
}

function Clock() {
  const mounted = useMounted();
  useTicker(1000);

  return (
    <div className="flex items-center gap-2 text-right">
      <span
        className="tabular font-mono text-body text-content-secondary"
        suppressHydrationWarning
      >
        {mounted ? formatClock(new Date()) : "--:--:--"}
      </span>
      <span className="hidden text-meta text-content-disabled sm:inline">
        {mounted ? timeZoneAbbreviation() : ""}
      </span>
    </div>
  );
}

/** Thumb-reachable navigation on small screens. */
function BottomNav({
  view,
  onViewChange,
  failureCount,
}: {
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  failureCount: number;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-default)] bg-bg-primary/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-md">
        {VIEWS.map((item) => {
          const active = item.id === view;
          const showBadge = item.id === "executions" && failureCount > 0;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-meta transition-colors focus-ring",
                active ? "text-alpha" : "text-content-muted",
              )}
            >
              <span aria-hidden>{VIEW_ICONS[item.id]}</span>
              <span className="font-medium">{item.label}</span>
              {showBadge && (
                <span className="absolute right-[22%] top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                  {failureCount}
                </span>
              )}
              {active && (
                <span
                  className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-alpha"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
