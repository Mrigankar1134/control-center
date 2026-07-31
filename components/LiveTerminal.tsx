"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  ChevronDown,
  Copy,
  Radio,
  Square,
  TerminalSquare,
} from "lucide-react";
import * as React from "react";

import { useToast } from "@/components/ui/toast";
import type { ActionType } from "@/db/schema";
import type { TerminalLevel, TerminalLine } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL_STYLE: Record<TerminalLevel, { tag: string; text: string }> = {
  SYSTEM: { tag: "text-[#4FACFE]", text: "text-[#7f9ab5]" },
  INFO: { tag: "text-[#4FACFE]", text: "text-[#9fb4c8]" },
  SUCCESS: { tag: "text-[#00F5A0]", text: "text-[#00F5A0]" },
  WARN: { tag: "text-[#FFB300]", text: "text-[#e2ae55]" },
  ERROR: { tag: "text-[#FF3366]", text: "text-[#ff7a99]" },
};

export type StreamState = "idle" | "connecting" | "streaming" | "done" | "error";

export interface TerminalSession {
  action: ActionType;
  runId: string;
  /** Bumped on every new run so a repeat of the same run id still reconnects. */
  key: number;
}

/** "00:04.320" — elapsed since the stream opened. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}.${String(ms % 1000).padStart(3, "0")}`;
}

/**
 * Streaming execution log for the run in progress.
 *
 * Opens an EventSource against the Edge route and appends each frame as it
 * arrives. Auto-scroll follows the tail until the operator scrolls up to read
 * something — then it stops fighting them and offers a jump-to-latest control.
 */
export function LiveTerminal({
  session,
  onClose,
}: {
  session: TerminalSession | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [lines, setLines] = React.useState<TerminalLine[]>([]);
  const [state, setState] = React.useState<StreamState>("idle");
  const [expanded, setExpanded] = React.useState(true);
  const [following, setFollowing] = React.useState(true);

  const scroller = React.useRef<HTMLDivElement | null>(null);
  const sourceRef = React.useRef<EventSource | null>(null);

  const stop = React.useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    setState((current) => (current === "streaming" || current === "connecting" ? "done" : current));
  }, []);

  React.useEffect(() => {
    if (!session) return;

    setLines([]);
    setFollowing(true);
    setExpanded(true);
    setState("connecting");

    const url = `/api/dispatch/stream?action=${encodeURIComponent(
      session.action,
    )}&runId=${encodeURIComponent(session.runId)}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.addEventListener("line", (event) => {
      try {
        const line = JSON.parse((event as MessageEvent).data) as TerminalLine;
        setState("streaming");
        setLines((current) => [...current, line]);
      } catch {
        /* A malformed frame is dropped rather than killing the stream. */
      }
    });

    source.addEventListener("done", () => {
      setState("done");
      source.close();
      sourceRef.current = null;
    });

    source.onerror = () => {
      // EventSource fires this on normal end-of-stream too; only surface it as
      // an error when nothing has been received yet.
      setState((current) => {
        source.close();
        sourceRef.current = null;
        return current === "streaming" || current === "done" ? "done" : "error";
      });
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [session]);

  // Tail-follow, unless the operator has scrolled away from the bottom.
  React.useEffect(() => {
    if (!following) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines, following, expanded]);

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const node = event.currentTarget;
    const atBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setFollowing(atBottom);
  }

  function jumpToLatest() {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
    setFollowing(true);
  }

  async function copyTranscript() {
    const text = lines
      .map(
        (line) =>
          `[${formatElapsed(line.elapsedMs)}] [${line.level}] ${line.message}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Transcript copied",
        description: `${lines.length} lines copied to the clipboard.`,
        variant: "success",
      });
    } catch {
      toast({
        title: "Could not copy",
        description: "The clipboard is unavailable in this context.",
        variant: "error",
      });
    }
  }

  if (!session) return null;

  const live = state === "connecting" || state === "streaming";

  return (
    <motion.section
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      aria-label="Live execution log"
      className="overflow-hidden rounded-panel border border-white/10 bg-surface-primary/60 backdrop-blur-xl"
    >
      <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-control text-left focus-ring"
        >
          <TerminalSquare
            className="h-4 w-4 shrink-0 text-content-muted"
            aria-hidden
          />
          <span className="truncate text-body font-medium text-content-primary">
            Execution stream
          </span>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-meta font-medium",
              live
                ? "border-success/25 bg-success/10 text-success"
                : state === "error"
                  ? "border-danger/25 bg-danger/10 text-danger"
                  : "border-white/10 bg-white/[0.04] text-content-muted",
            )}
          >
            {live ? (
              <Radio className="h-3 w-3 animate-breathe" aria-hidden />
            ) : null}
            {state === "connecting"
              ? "Connecting"
              : state === "streaming"
                ? "Live"
                : state === "error"
                  ? "Disconnected"
                  : "Complete"}
          </span>
          <span className="ml-auto hidden shrink-0 font-mono text-meta text-content-disabled sm:inline">
            {lines.length} lines
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-content-muted transition-transform duration-expand",
              expanded ? "rotate-180" : "rotate-0",
            )}
            aria-hidden
          />
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-meta text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary focus-ring"
            >
              <Square className="h-3 w-3" aria-hidden />
              Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyTranscript()}
            disabled={lines.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-meta text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary disabled:opacity-40 focus-ring"
          >
            <Copy className="h-3 w-3" aria-hidden />
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              stop();
              onClose();
            }}
            className="inline-flex h-8 items-center rounded-control px-2 text-meta text-content-muted transition-colors hover:bg-white/[0.06] hover:text-content-primary focus-ring"
          >
            Close
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="relative overflow-hidden"
          >
            <div
              ref={scroller}
              onScroll={onScroll}
              role="log"
              aria-live="polite"
              aria-atomic="false"
              className="terminal-scroll h-[280px] overflow-y-auto bg-black px-4 py-3 font-mono text-support leading-relaxed"
            >
              {lines.length === 0 && (
                <p className="text-[#4a5a6a]">
                  {state === "error"
                    ? "Stream could not be established."
                    : "Awaiting first frame from the runner…"}
                </p>
              )}

              {lines.map((line) => {
                const style = LEVEL_STYLE[line.level];
                return (
                  <div
                    key={line.id}
                    className="flex gap-2.5 whitespace-pre-wrap break-words py-[1px]"
                  >
                    <span className="shrink-0 tabular text-[#3d4a58]">
                      {formatElapsed(line.elapsedMs)}
                    </span>
                    <span className={cn("shrink-0 font-semibold", style.tag)}>
                      [{line.level}]
                    </span>
                    <span className={style.text}>{line.message}</span>
                  </div>
                );
              })}

              {live && (
                <div className="flex gap-2.5 py-[1px]" aria-hidden>
                  <span className="text-[#00F5A0] drop-shadow-[0_0_6px_rgba(0,245,160,0.6)]">
                    ▍
                  </span>
                </div>
              )}
            </div>

            {/* Only offered once the operator has scrolled off the tail. */}
            <AnimatePresence>
              {!following && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  onClick={jumpToLatest}
                  className="absolute bottom-3 right-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/80 px-3 py-1.5 text-meta text-[#00F5A0] backdrop-blur-sm focus-ring"
                >
                  <ArrowDownToLine className="h-3 w-3" aria-hidden />
                  Jump to latest
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
