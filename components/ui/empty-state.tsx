"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Empty states carry a tone: an absence of failures is good news and should
 * not read like a broken table.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "positive" | "warning" | "error";
  className?: string;
}) {
  const toneStyles = {
    neutral:
      "border-[var(--border-subtle)] bg-white/[0.02] text-content-disabled",
    positive: "border-success/20 bg-success/[0.06] text-success",
    warning: "border-warning/20 bg-warning/[0.06] text-warning",
    error: "border-danger/20 bg-danger/[0.06] text-danger",
  }[tone];

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-control border",
          toneStyles,
        )}
        aria-hidden
      >
        {icon}
      </div>
      <div className="max-w-sm">
        <p className="text-body-lg font-medium text-content-primary">{title}</p>
        {description && (
          <p className="mt-1.5 text-support leading-relaxed text-content-muted">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
