"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "alpha"
  | "beta"
  | "secondary"
  | "ghost"
  | "danger";
type Size = "sm" | "md" | "lg";

/**
 * Gradients are reserved for the two primary dispatch actions. Everything
 * else uses a solid semantic surface so the page has one clear focal point.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-alpha text-bg-primary font-medium hover:bg-alpha/90 active:bg-alpha/80",
  alpha:
    "bg-gradient-to-r from-alpha-bright/90 to-alpha text-bg-primary font-semibold shadow-accent-alpha hover:brightness-[1.06]",
  beta: "bg-gradient-to-r from-beta-dim to-beta text-white font-semibold shadow-accent-beta hover:brightness-[1.06]",
  secondary:
    "bg-white/[0.05] text-content-primary border border-[var(--border-default)] hover:bg-white/[0.09] hover:border-[var(--border-strong)]",
  ghost:
    "bg-transparent text-content-secondary hover:bg-white/[0.05] hover:text-content-primary",
  danger:
    "bg-danger/12 text-danger border border-danger/30 hover:bg-danger/20",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-support rounded-control gap-1.5",
  md: "h-10 px-4 text-body rounded-control gap-2",
  lg: "h-12 px-5 text-body-lg rounded-control gap-2",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
  /** Rendered right-aligned, e.g. a keyboard hint. */
  hint?: string;
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "secondary",
      size = "md",
      loading = false,
      icon,
      hint,
      fullWidth,
      disabled,
      children,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap transition-all duration-press focus-ring",
        // A 1px lift reads as responsive without the UI feeling unstable.
        "hover:-translate-y-px active:translate-y-0",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : (
        icon
      )}
      <span>{children}</span>
      {hint && (
        <kbd className="ml-1.5 rounded border border-current/25 px-1.5 py-0.5 font-mono text-[10px] opacity-60">
          {hint}
        </kbd>
      )}
    </button>
  ),
);
Button.displayName = "Button";

/** Square icon-only button that still meets the 44px touch minimum. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(({ className, label, children, ...props }, ref) => (
  <button
    ref={ref}
    aria-label={label}
    title={label}
    className={cn(
      "inline-flex h-9 w-9 items-center justify-center rounded-control border border-[var(--border-default)] bg-white/[0.03] text-content-muted transition-colors duration-press",
      "hover:bg-white/[0.08] hover:text-content-primary",
      "disabled:pointer-events-none disabled:opacity-40 focus-ring",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
IconButton.displayName = "IconButton";
