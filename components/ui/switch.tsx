"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md";
}

/**
 * Solid semantic fill rather than a gradient glow — this control appears
 * dozens of times and must stay quiet.
 */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, size = "md", ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-status focus-ring",
      "border-[var(--border-default)] bg-white/[0.07]",
      "data-[state=checked]:border-success/40 data-[state=checked]:bg-success/70",
      "disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "h-5 w-9" : "h-6 w-11",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block rounded-full bg-content-secondary shadow transition-transform duration-status",
        "data-[state=checked]:bg-bg-primary",
        size === "sm"
          ? "h-3.5 w-3.5 translate-x-[3px] data-[state=checked]:translate-x-[19px]"
          : "h-4 w-4 translate-x-[4px] data-[state=checked]:translate-x-[24px]",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

/**
 * Switch with a text state label. State is announced in words as well as
 * colour and position, per accessibility requirements.
 */
export function LabeledSwitch({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  stateLabels = ["Enabled", "Disabled"],
  className,
  describedBy,
}: {
  label: string;
  hint?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  stateLabels?: [string, string];
  className?: string;
  describedBy?: string;
}) {
  const id = React.useId();
  const hintId = `${id}-hint`;

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="cursor-pointer text-body font-medium text-content-primary"
        >
          {label}
        </label>
        {hint && (
          <p id={hintId} className="mt-1 text-support text-content-muted">
            {hint}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className={cn(
            "text-support tabular transition-colors duration-status",
            checked ? "text-success" : "text-content-muted",
          )}
        >
          {checked ? stateLabels[0] : stateLabels[1]}
        </span>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-describedby={hint ? hintId : describedBy}
        />
      </div>
    </div>
  );
}
