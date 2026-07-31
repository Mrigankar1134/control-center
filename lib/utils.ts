import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 2026-07-31T09:19:00Z -> "09:19:04" */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

/** Absolute timestamp rendered for the log console: "31 Jul · 09:19:04". */
export function formatLogTimestamp(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
  return `${day} · ${date.toLocaleTimeString("en-GB", { hour12: false })}`;
}

/** "12s ago", "4m ago", "2h ago", "3d ago" */
export function formatRelativeTime(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** 1480 -> "1.48s", 640 -> "640ms" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 29_700_000 -> "08h 15m". Null renders the placeholder clock. */
export function formatHoursMinutes(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "--:--";
  const minutes = Math.floor(ms / 60_000);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(
    minutes % 60,
  ).padStart(2, "0")}m`;
}

/** Guards the HH:mm strings coming out of the time pickers. */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** "09:19" + 25 -> "09:44" (wraps across midnight). */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

/** Human summary of the jitter band a schedule row will fire within. */
export function describeWindow(time: string, offsetMinutes: number): string {
  if (offsetMinutes <= 0) return `exactly ${time}`;
  return `${time} – ${addMinutes(time, offsetMinutes)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
