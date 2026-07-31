"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    /** Renders min/max endpoints beneath the track. */
    bounds?: [string, string];
  }
>(({ className, bounds, ...props }, ref) => (
  <div className="w-full">
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center py-2",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-white/[0.08]">
        <SliderPrimitive.Range className="absolute h-full bg-alpha/70" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block h-4 w-4 rounded-full border border-alpha/60 bg-bg-elevated shadow transition-transform duration-press",
          "hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50 focus-ring",
        )}
      />
    </SliderPrimitive.Root>
    {bounds && (
      <div className="flex justify-between px-0.5 text-meta text-content-disabled">
        <span>{bounds[0]}</span>
        <span>{bounds[1]}</span>
      </div>
    )}
  </div>
));
Slider.displayName = "Slider";
