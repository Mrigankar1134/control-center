"use client";

import * as React from "react";

import type { DispatchStatus } from "@/db/schema";
import { STATUS_META } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "alpha"
  | "beta"
  | "info";

const TONES: Record<Tone, string> = {
  neutral:
    "text-content-secondary bg-white/[0.05] border-[var(--border-default)]",
  success: "text-success bg-success/10 border-success/25",
  warning: "text-warning bg-warning/10 border-warning/25",
  danger: "text-danger bg-danger/10 border-danger/25",
  alpha: "text-alpha bg-alpha/10 border-alpha/25",
  beta: "text-beta bg-beta/10 border-beta/25",
  info: "text-info bg-info/10 border-info/25",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-content-muted",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  alpha: "bg-alpha",
  beta: "bg-beta",
  info: "bg-info",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
  size?: "sm" | "md";
}

export function Badge({
  className,
  tone = "neutral",
  dot = false,
  size = "md",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border font-medium",
        size === "sm"
          ? "px-1.5 py-0.5 text-meta"
          : "px-2 py-1 text-support",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOTS[tone])}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<DispatchStatus, Tone> = {
  QUEUED: "neutral",
  EXECUTING: "warning",
  SUCCESS: "success",
  FAILED: "danger",
};

/**
 * Status chip. Always renders the label text, so status is never conveyed
 * by colour alone.
 */
export function StatusBadge({
  status,
  size = "md",
  className,
}: {
  status: DispatchStatus;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = STATUS_META[status];
  const live = status === "EXECUTING";

  return (
    <Badge tone={STATUS_TONE[status]} size={size} className={className}>
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          meta.dot,
          live && "animate-breathe",
        )}
        aria-hidden
      />
      {meta.label}
    </Badge>
  );
}
