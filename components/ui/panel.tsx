"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The single surface treatment for the product. A Panel is a *workspace* —
 * group content inside it with PanelSection and dividers rather than nesting
 * more panels.
 */
export function Panel({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("panel", className)} {...props} />;
}

export function PanelHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 border-b border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 shrink-0 text-content-muted" aria-hidden>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-card-title font-semibold text-content-primary">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-support text-content-muted">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function PanelBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function PanelFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}

/** Labelled group inside a panel — replaces the old nested-card pattern. */
export function PanelSection({
  label,
  action,
  children,
  className,
}: {
  label?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-5 py-4", className)}>
      {(label || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {label && <h3 className="eyebrow">{label}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
