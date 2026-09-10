"use client";

import * as React from "react";

import { Dot, cx } from "@/components/glass";

export type SystemStatus = "online" | "paused" | "degraded";

type Theme = "system" | "light" | "dark";

const STATUS_TEXT: Record<SystemStatus, string> = {
  online: "Armed",
  paused: "Paused",
  degraded: "Degraded",
};

const STATUS_TONE: Record<SystemStatus, "ok" | "warn" | "bad"> = {
  online: "ok",
  paused: "warn",
  degraded: "bad",
};

/**
 * Applies the stored theme to the root element.
 *
 * "system" means *no* data-theme attribute, which is what lets the
 * prefers-color-scheme block in globals.css decide. Reads and writes are
 * wrapped because localStorage throws outright in some embedded contexts.
 */
function useTheme() {
  const [theme, setTheme] = React.useState<Theme>("system");

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      /* Blocked site data: keep the system default. */
    }
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch {
      /* Not fatal: the choice simply will not survive a reload. */
    }
  }, [theme]);

  return { theme, setTheme };
}

export function TopBar({ status }: { status: SystemStatus }) {
  const { theme, setTheme } = useTheme();

  const order: Theme[] = ["system", "light", "dark"];
  const icon = { system: "◐", light: "☀", dark: "☾" }[theme];

  return (
    <header
      className="sticky top-0 z-30 -mx-4 mb-5 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:-mx-6 sm:px-6"
      style={{
        // A narrow blur strip rather than a solid bar, so cards scrolling under
        // it stay visible as shapes. This is the one place a backdrop filter is
        // applied to something that is not a card.
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--field) 72%, transparent), transparent)",
      }}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-title font-semibold text-ink">Attendance</h1>
          <p className="text-caption text-ink-faint">Control center</p>
        </div>

        <span
          className="glass ml-auto inline-flex shrink-0 items-center gap-2 rounded-pill px-3 py-1.5 text-caption font-medium text-ink"
          title={`Automation is ${STATUS_TEXT[status].toLowerCase()}`}
        >
          <Dot tone={STATUS_TONE[status]} live={status === "online"} />
          {STATUS_TEXT[status]}
        </span>

        <button
          type="button"
          aria-label={`Theme: ${theme}. Tap to change.`}
          onClick={() => setTheme(order[(order.indexOf(theme) + 1) % order.length])}
          className={cx(
            "glass flex h-9 w-9 shrink-0 items-center justify-center rounded-pill",
            "text-body text-ink transition-transform duration-150 ease-apple active:scale-95",
          )}
        >
          <span aria-hidden>{icon}</span>
        </button>
      </div>
    </header>
  );
}
