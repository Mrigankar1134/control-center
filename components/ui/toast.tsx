"use client";

import * as React from "react";

import { cx } from "@/components/glass";

/*
 * Toasts. The API is deliberately unchanged from the previous implementation
 * because lib/hooks.ts calls toast() from a dozen places; only the surface is
 * new. Notifications stack bottom-centre on phones and bottom-right on desktop,
 * which is where iOS and macOS respectively put them.
 */

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds on screen. Errors default to longer than the rest. */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

const ToastContext = React.createContext<{
  toast: (options: ToastOptions) => void;
} | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}

const ACCENT: Record<ToastVariant, string> = {
  success: "var(--ok)",
  error: "var(--bad)",
  warning: "var(--warn)",
  info: "var(--tint-in)",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastRecord[]>([]);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = "info", duration }: ToastOptions) => {
      const id = nextId.current++;
      const ms = duration ?? (variant === "error" ? 9000 : 5000);
      setItems((current) => [...current, { id, title, description, variant, duration: ms }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // aria-live so a dispatch result is announced without stealing focus.
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => dismiss(item.id)}
            className={cx(
              "glass glass-raised sheen pointer-events-auto w-full max-w-sm rounded-card",
              "animate-rise-in px-4 py-3 text-left",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: ACCENT[item.variant],
                  boxShadow: `0 0 10px ${ACCENT[item.variant]}`,
                }}
              />
              <div className="min-w-0">
                <p className="text-subhead font-semibold text-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-footnote leading-snug text-ink-soft">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </div>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
