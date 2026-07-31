"use client";

import { Minus, Plus } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Precise numeric entry with steppers. Sliders are imprecise for
 * operational settings, so the number is the primary control and the
 * slider (where shown) is the secondary, coarse one.
 */
export function NumberField({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit,
  label,
  disabled,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = React.useState(String(value));
  const id = React.useId();

  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  function commit(raw: string) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(Math.round(parsed / step) * step);
    setDraft(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-control border border-[var(--border-default)] bg-bg-elevated/60 transition-colors focus-within:border-alpha/50",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
        className="flex w-8 items-center justify-center rounded-l-control text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary disabled:opacity-30 focus-ring"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>

      <div className="flex min-w-0 items-baseline gap-1 px-1">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value);
          }}
          className="tabular w-8 bg-transparent text-center font-mono text-body text-content-primary outline-none"
        />
        {unit && (
          <span className="shrink-0 pr-0.5 text-meta text-content-muted">
            {unit}
          </span>
        )}
      </div>

      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
        className="flex w-8 items-center justify-center rounded-r-control text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary disabled:opacity-30 focus-ring"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
