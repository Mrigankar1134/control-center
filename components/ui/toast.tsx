"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "loading" | "success" | "error";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** ms; `loading` toasts never auto-dismiss. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

type ToastInput = Omit<Toast, "id" | "variant"> & { variant?: ToastVariant };

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  update: (id: string, input: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const DEFAULT_DURATION = 4500;

const VARIANT_META: Record<
  ToastVariant,
  { icon: React.ReactNode; border: string }
> = {
  info: {
    icon: <Info className="h-4 w-4 text-info" aria-hidden />,
    border: "border-[var(--border-strong)]",
  },
  loading: {
    icon: <Loader2 className="h-4 w-4 animate-spin text-warning" aria-hidden />,
    border: "border-warning/25",
  },
  success: {
    icon: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />,
    border: "border-success/25",
  },
  error: {
    icon: <XCircle className="h-4 w-4 text-danger" aria-hidden />,
    border: "border-danger/25",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = React.useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = React.useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((current) => current.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const scheduleDismiss = React.useCallback(
    (id: string, variant: ToastVariant, duration?: number) => {
      clearTimer(id);
      if (variant === "loading") return;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration ?? DEFAULT_DURATION),
      );
    },
    [clearTimer, dismiss],
  );

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const variant = input.variant ?? "info";
      setToasts((current) => [...current.slice(-3), { ...input, id, variant }]);
      scheduleDismiss(id, variant, input.duration);
      return id;
    },
    [scheduleDismiss],
  );

  const update = React.useCallback(
    (id: string, input: Partial<ToastInput>) => {
      setToasts((current) =>
        current.map((t) => (t.id === id ? { ...t, ...input } : t)),
      );
      if (input.variant) scheduleDismiss(id, input.variant, input.duration);
    },
    [scheduleDismiss],
  );

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = React.useMemo(
    () => ({ toast, update, dismiss }),
    [toast, update, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    /*
     * Toasts are supplementary: run state also lives on the action panel.
     * The live region ensures screen readers still announce outcomes.
     */
    <div
      role="region"
      aria-label="Notifications"
      /* Clears the mobile bottom nav and the home-indicator inset; on lg the
         nav is gone, so the stack drops back to the corner. */
      className="pointer-events-none fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] right-4 z-[80] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2.5 sm:right-5 lg:bottom-5"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const meta = VARIANT_META[t.variant];
          return (
            <motion.div
              key={t.id}
              layout
              role={t.variant === "error" ? "alert" : "status"}
              aria-live={t.variant === "error" ? "assertive" : "polite"}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 16, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              className={cn(
                "pointer-events-auto relative rounded-control border bg-bg-elevated p-3.5 pr-10 shadow-elevated",
                meta.border,
              )}
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-px shrink-0">{meta.icon}</span>
                <div className="min-w-0">
                  <p className="text-body font-medium text-content-primary">
                    {t.title}
                  </p>
                  {t.description && (
                    <p className="mt-1 break-words text-support leading-relaxed text-content-muted">
                      {t.description}
                    </p>
                  )}
                  {t.action && (
                    <button
                      onClick={() => {
                        t.action?.onClick();
                        onDismiss(t.id);
                      }}
                      className="mt-2 text-support font-medium text-alpha underline-offset-2 hover:underline focus-ring"
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>
              </div>
              <button
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss notification"
                className="absolute right-2.5 top-2.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-content-disabled transition-colors hover:bg-white/[0.06] hover:text-content-secondary focus-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
