"use client";

import { motion } from "framer-motion";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  /** Small trailing count, e.g. number of failures. */
  count?: number;
}

/**
 * Single-select control used for view switching, timeframe selection, and
 * the mobile Alpha/Beta action chooser.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  fullWidth,
  layoutId,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  fullWidth?: boolean;
  layoutId: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex gap-0.5 rounded-control border border-[var(--border-subtle)] bg-white/[0.03] p-1",
        fullWidth && "w-full",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-status focus-ring",
              size === "sm"
                ? "h-8 px-3 text-support"
                : "h-9 px-3.5 text-body",
              fullWidth && "flex-1",
              active
                ? "text-content-primary"
                : "text-content-muted hover:text-content-secondary",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="absolute inset-0 rounded-md border border-[var(--border-default)] bg-white/[0.07]"
              />
            )}
            {option.icon && (
              <span className="relative shrink-0" aria-hidden>
                {option.icon}
              </span>
            )}
            <span className="relative">{option.label}</span>
            {option.count !== undefined && option.count > 0 && (
              <span className="relative rounded bg-danger/15 px-1.5 py-px text-meta font-semibold text-danger">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
