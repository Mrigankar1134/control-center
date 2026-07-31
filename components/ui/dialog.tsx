"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/* Radix handles focus trapping, Escape-to-close, and inert background. */

/* forwardRef: Radix's Presence attaches a ref to whatever Portal renders. */
const Overlay = React.forwardRef<HTMLDivElement>(function Overlay(_props, ref) {
  return (
    <DialogPrimitive.Overlay asChild forceMount>
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 bg-bg-primary/75 backdrop-blur-sm"
      />
    </DialogPrimitive.Overlay>
  );
});

/** Right-anchored slide-over for inspection surfaces. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Root open onOpenChange={onOpenChange}>
          <DialogPrimitive.Portal forceMount>
            <Overlay />
            <DialogPrimitive.Content asChild forceMount>
              <motion.div
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
                className={cn(
                  // pad-safe-*: installed to the home screen the drawer covers
                  // the whole physical screen, so its own header would sit
                  // under the status bar and its footer under the home bar.
                  "pad-safe-top pad-safe-bottom fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-[var(--border-default)] bg-bg-elevated shadow-elevated focus:outline-none sm:max-w-xl",
                  className,
                )}
              >
                <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="text-card-title font-semibold text-content-primary">
                      {title}
                    </DialogPrimitive.Title>
                    {description && (
                      <DialogPrimitive.Description className="mt-1 text-support text-content-muted">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close
                    aria-label="Close panel"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-[var(--border-default)] bg-white/[0.03] text-content-muted transition-colors hover:bg-white/[0.08] hover:text-content-primary focus-ring"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </DialogPrimitive.Close>
                </header>

                <div className="flex-1 overflow-y-auto px-5 py-5">
                  {children}
                </div>

                {footer && (
                  <footer className="border-t border-[var(--border-subtle)] px-5 py-4">
                    {footer}
                  </footer>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </AnimatePresence>
  );
}

/**
 * Modal backdrop. Unlike the drawer overlay, this one is also the centring
 * container: the content is rendered *inside* it so mobile browsers centre the
 * panel against the real viewport instead of a translated box that can drift
 * off-screen when the URL bar collapses.
 */
const CenteringOverlay = React.forwardRef<
  HTMLDivElement,
  { children: React.ReactNode }
>(function CenteringOverlay({ children }, ref) {
  return (
    <DialogPrimitive.Overlay asChild forceMount>
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        /* inset-safe is p-4, floored to the device's safe-area insets. */
        className="inset-safe fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 backdrop-blur-sm"
      >
        {children}
      </motion.div>
    </DialogPrimitive.Overlay>
  );
});

/** Centred modal used for the two-stage action model. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <DialogPrimitive.Root open onOpenChange={onOpenChange}>
          <DialogPrimitive.Portal forceMount>
            <CenteringOverlay>
              <DialogPrimitive.Content asChild forceMount>
                <motion.div
                  initial={{ opacity: 0, scale: 0.97, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97, y: 4 }}
                  transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                  className={cn(
                    "relative z-50 mx-auto my-auto flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-panel border border-[var(--border-strong)] bg-bg-elevated shadow-elevated focus:outline-none",
                    className,
                  )}
                >
                  <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
                    <div className="min-w-0">
                      <DialogPrimitive.Title className="text-card-title font-semibold text-content-primary">
                        {title}
                      </DialogPrimitive.Title>
                      {description && (
                        <DialogPrimitive.Description className="mt-1 text-support leading-relaxed text-content-muted">
                          {description}
                        </DialogPrimitive.Description>
                      )}
                    </div>
                    <DialogPrimitive.Close
                      aria-label="Cancel"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary focus-ring"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </DialogPrimitive.Close>
                  </header>

                  {children && (
                    <div className="flex-1 px-5 py-4">{children}</div>
                  )}

                  {footer && (
                    <footer className="flex flex-col-reverse gap-2 border-t border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:justify-end">
                      {footer}
                    </footer>
                  )}
                </motion.div>
              </DialogPrimitive.Content>
            </CenteringOverlay>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </AnimatePresence>
  );
}

/**
 * Confirmation for high-impact actions. `confirmLabel` must name the action
 * being taken — never a generic "Confirm".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  cancelLabel = "Cancel",
  onConfirm,
  loading,
  warning,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: React.ComponentProps<typeof Button>["variant"];
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
  warning?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            loading={loading}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {warning && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-control border border-warning/25 bg-warning/[0.07] px-3.5 py-3"
        >
          <AlertTriangle
            className="mt-px h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <p className="text-support leading-relaxed text-warning/90">
            {warning}
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Key/value rows used inside confirmation dialogs. */
export function SummaryList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <dl className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-control border border-[var(--border-subtle)] bg-white/[0.02]">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-4 px-3.5 py-2.5"
        >
          <dt className="shrink-0 text-support text-content-muted">
            {item.label}
          </dt>
          <dd className="min-w-0 text-right text-body text-content-primary">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
