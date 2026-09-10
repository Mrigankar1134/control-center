"use client";

import * as React from "react";

/** Join class names, dropping falsey ones. Small enough not to warrant clsx. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("glass sheen rounded-card animate-rise-in", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h2 className="text-headline font-semibold text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-footnote text-ink-faint">{subtitle}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Button */

type ButtonTone = "neutral" | "in" | "out" | "danger";

export function Button({
  tone = "neutral",
  size = "md",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-8 px-3 text-footnote rounded-pill",
    md: "h-10 px-4 text-subhead rounded-control",
    lg: "h-14 px-5 text-body rounded-control",
  }[size];

  // Tinted buttons carry colour as a translucent wash over the glass rather
  // than a solid fill, so they still read as part of the same material.
  const tones: Record<ButtonTone, string> = {
    neutral: "glass text-ink hover:bg-glass-hover",
    in: "text-white border-transparent",
    out: "text-white border-transparent",
    danger: "text-white border-transparent",
  };

  const tinted =
    tone === "in"
      ? { background: "var(--tint-in)" }
      : tone === "out"
        ? { background: "var(--tint-out)" }
        : tone === "danger"
          ? { background: "var(--bad)" }
          : undefined;

  return (
    <button
      style={tinted}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 border font-medium",
        "transition-[transform,background,opacity] duration-150 ease-apple",
        "active:scale-[0.975] disabled:pointer-events-none disabled:opacity-40",
        tone !== "neutral" && "shadow-[0_8px_24px_-12px_rgba(0,0,0,0.55)]",
        sizes,
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ Pill */

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const color = {
    neutral: "var(--ink-faint)",
    ok: "var(--ok)",
    warn: "var(--warn)",
    bad: "var(--bad)",
  }[tone];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-caption font-medium"
      style={{
        color,
        borderColor: "var(--edge)",
        background: "color-mix(in srgb, currentColor 10%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

/** A presence dot. The only thing on the page that animates continuously. */
export function Dot({ tone = "ok", live = false }: { tone?: "ok" | "warn" | "bad"; live?: boolean }) {
  const color = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)" }[tone];
  return (
    <span
      aria-hidden
      className={cx("inline-block h-2 w-2 rounded-full", live && "animate-pulse-dot")}
      style={{ background: color, boxShadow: `0 0 10px ${color}` }}
    />
  );
}

/* ---------------------------------------------------------------- Toggle */

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[30px] w-[50px] shrink-0 rounded-pill border transition-colors duration-200 ease-apple",
        "disabled:opacity-40",
      )}
      style={{
        background: checked ? "var(--ok)" : "var(--glass-sunken)",
        borderColor: "var(--edge)",
      }}
    >
      <span
        className="absolute top-[2px] block h-[24px] w-[24px] rounded-full bg-white transition-transform duration-200 ease-apple"
        style={{
          transform: checked ? "translateX(23px)" : "translateX(2px)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.28)",
        }}
      />
    </button>
  );
}

/* ----------------------------------------------------------------- Input */

export function TimeInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="time"
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={cx(
        "glass-sunken tnum h-9 rounded-control px-2.5 text-subhead text-ink",
        "outline-none disabled:opacity-40",
        "[color-scheme:light] dark:[color-scheme:dark]",
      )}
    />
  );
}

/* ------------------------------------------------------------- Skeletons */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-control bg-glass-sunken",
        className,
      )}
    >
      <div className="absolute inset-y-0 -left-1/3 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-white/25 to-transparent" />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 pb-5 pt-1 text-subhead text-ink-faint">{children}</p>
  );
}
