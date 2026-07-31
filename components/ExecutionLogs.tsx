"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  ImageOff,
  Inbox,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import * as React from "react";

import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Drawer, Modal } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { InfoHint } from "@/components/ui/tooltip";
import {
  ACTION_META,
  LOGS_POLL_INTERVAL_MS,
  TOOLTIPS,
  TRIGGER_SOURCE_LABEL,
} from "@/lib/constants";
import type { LogRow } from "@/lib/types";
import {
  cn,
  formatDuration,
  formatLogTimestamp,
  formatRelativeTime,
} from "@/lib/utils";

type Filter = "ALL" | "SUCCESS" | "FAILED" | "EXECUTING";

const FILTERS = [
  { id: "ALL" as const, label: "All" },
  { id: "SUCCESS" as const, label: "Success" },
  { id: "FAILED" as const, label: "Failed" },
  { id: "EXECUTING" as const, label: "Running" },
];

function triggerSource(log: LogRow): string {
  const raw = log.payload?.source;
  return TRIGGER_SOURCE_LABEL[String(raw ?? "")] ?? "Unknown";
}

function queueDelay(log: LogRow): number | null {
  const raw = log.payload?.delayMs;
  return typeof raw === "number" ? raw : null;
}

export function ExecutionLogs({
  logs,
  loading,
  refreshing,
  error,
  onRefresh,
  selected,
  onSelect,
  onRetryDispatch,
}: {
  logs: LogRow[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  selected: LogRow | null;
  onSelect: (log: LogRow | null) => void;
  onRetryDispatch: (log: LogRow) => void;
}) {
  const [filter, setFilter] = React.useState<Filter>("ALL");

  const visible = React.useMemo(
    () => (filter === "ALL" ? logs : logs.filter((l) => l.status === filter)),
    [logs, filter],
  );

  // Keep the open drawer in sync with polled data (EXECUTING → FAILED).
  React.useEffect(() => {
    if (!selected) return;
    const fresh = logs.find((log) => log.id === selected.id);
    if (fresh && fresh !== selected) onSelect(fresh);
  }, [logs, selected, onSelect]);

  return (
    <>
      <Panel>
        <PanelHeader
          title="Execution history"
          description={`Most recent dispatches · refreshed every ${LOGS_POLL_INTERVAL_MS / 1000}s`}
          actions={
            <>
              <Segmented
                options={FILTERS}
                value={filter}
                onChange={setFilter}
                layoutId="log-filter"
                ariaLabel="Filter executions by status"
                size="sm"
              />
              <IconButton label="Refresh execution history" onClick={onRefresh}>
                <RefreshCw
                  className={cn("h-4 w-4", refreshing && "animate-spin")}
                  aria-hidden
                />
              </IconButton>
            </>
          }
        />

        {error && (
          <div
            role="alert"
            className="border-b border-danger/20 bg-danger/[0.06] px-5 py-3 text-support text-danger"
          >
            {error}
          </div>
        )}

        {/* ------------------------------- Desktop ------------------------------- */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <Th>Timestamp</Th>
                <Th>Action</Th>
                <Th>
                  <span className="inline-flex items-center gap-1">
                    Trigger
                    <InfoHint
                      content={TOOLTIPS.triggerSource}
                      label="About trigger source"
                    />
                  </span>
                </Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Queue delay
                    <InfoHint
                      content={TOOLTIPS.queueDelay}
                      label="About queue delay"
                    />
                  </span>
                </Th>
                <Th className="text-right">Duration</Th>
                <Th className="w-[92px] text-right">Inspect</Th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--border-subtle)]">
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <div className="h-4 animate-pulse rounded bg-white/[0.05]" />
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading &&
                visible.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => onSelect(log)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(log);
                      }
                    }}
                    className={cn(
                      "cursor-pointer border-b border-[var(--border-subtle)] transition-colors last:border-b-0",
                      "hover:bg-surface-hover/50 focus:bg-surface-hover/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--border-focus)]",
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className="tabular block font-mono text-support text-content-primary">
                        {formatLogTimestamp(log.timestamp)}
                      </span>
                      <span className="mt-0.5 block text-meta text-content-disabled">
                        {formatRelativeTime(log.timestamp)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          log.actionType === "ACTION_ALPHA" ? "alpha" : "beta"
                        }
                        size="sm"
                      >
                        {ACTION_META[log.actionType].shortLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-support text-content-secondary">
                      {triggerSource(log)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={log.status} size="sm" />
                    </td>
                    <td className="tabular px-4 py-3 text-right font-mono text-support text-content-muted">
                      {formatDuration(queueDelay(log))}
                    </td>
                    <td className="tabular px-4 py-3 text-right font-mono text-support text-content-secondary">
                      {formatDuration(log.executionDurationMs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Search
                        className="ml-auto h-4 w-4 text-content-disabled"
                        aria-hidden
                      />
                      <span className="sr-only">Inspect run</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* -------------------------------- Mobile ------------------------------- */}
        <ul className="divide-y divide-[var(--border-subtle)] md:hidden">
          {!loading &&
            visible.map((log) => (
              <li key={log.id}>
                <button
                  onClick={() => onSelect(log)}
                  className="flex min-h-[64px] w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-hover/40 focus-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-body text-content-primary">
                        {ACTION_META[log.actionType].shortLabel}
                      </span>
                      <StatusBadge status={log.status} size="sm" />
                    </div>
                    <p className="tabular mt-1 font-mono text-support text-content-muted">
                      {formatLogTimestamp(log.timestamp)} ·{" "}
                      {formatDuration(log.executionDurationMs)}
                    </p>
                  </div>
                  <Search
                    className="h-4 w-4 shrink-0 text-content-disabled"
                    aria-hidden
                  />
                </button>
              </li>
            ))}
        </ul>

        {!loading && visible.length === 0 && <LogsEmptyState filter={filter} />}
      </Panel>

      <InspectionDrawer
        log={selected}
        onClose={() => onSelect(null)}
        onRetryDispatch={onRetryDispatch}
      />
    </>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-meta font-medium uppercase tracking-[0.06em] text-content-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function LogsEmptyState({ filter }: { filter: Filter }) {
  if (filter === "FAILED") {
    // An absence of failures is good news, not a broken table.
    return (
      <EmptyState
        tone="positive"
        icon={<CheckCircle2 className="h-5 w-5" aria-hidden />}
        title="No failures"
        description="Every recorded execution in this range completed successfully."
      />
    );
  }

  if (filter === "EXECUTING") {
    return (
      <EmptyState
        icon={<Inbox className="h-5 w-5" aria-hidden />}
        title="Nothing running"
        description="No dispatch is currently in flight."
      />
    );
  }

  return (
    <EmptyState
      icon={<Inbox className="h-5 w-5" aria-hidden />}
      title={filter === "ALL" ? "No executions yet" : "No matching executions"}
      description="Runs appear here as soon as a manual or scheduled dispatch starts."
    />
  );
}

/* --------------------------- Inspection drawer ---------------------------- */

/**
 * The first screen stays readable for non-developers; raw payloads and
 * traces live behind a disclosure.
 */
function InspectionDrawer({
  log,
  onClose,
  onRetryDispatch,
}: {
  log: LogRow | null;
  onClose: () => void;
  onRetryDispatch: (log: LogRow) => void;
}) {
  const { toast } = useToast();
  const failed = log?.status === "FAILED";
  const artifact = React.useMemo(
    () => (log ? resolveArtifact(log) : null),
    [log],
  );

  async function copyDetails() {
    if (!log) return;
    const text = [
      `Run ID: ${log.id}`,
      `Action: ${log.actionType}`,
      `Status: ${log.status}`,
      `Timestamp: ${log.timestamp}`,
      `Duration: ${formatDuration(log.executionDurationMs)}`,
      `Trigger: ${triggerSource(log)}`,
      log.errorMessage ? `Error: ${log.errorMessage}` : null,
      `Payload: ${JSON.stringify(log.payload, null, 2)}`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Error details copied", variant: "success" });
    } catch {
      toast({
        title: "Could not copy to clipboard",
        description: "Your browser blocked clipboard access.",
        variant: "error",
      });
    }
  }

  return (
    <Drawer
      open={Boolean(log)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Execution details"
      description={
        log
          ? `${ACTION_META[log.actionType].label} · ${formatLogTimestamp(log.timestamp)}`
          : undefined
      }
      footer={
        log && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={failed ? "primary" : "secondary"}
              size="sm"
              onClick={() => onRetryDispatch(log)}
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
            >
              Retry dispatch
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={copyDetails}
              icon={<Copy className="h-3.5 w-3.5" aria-hidden />}
            >
              Copy details
            </Button>
          </div>
        )
      }
    >
      {log && (
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center gap-2">
              <StatusBadge status={log.status} />
              <span className="text-support text-content-muted">
                {formatRelativeTime(log.timestamp)}
              </span>
            </div>
            <SummaryGrid
              items={[
                { label: "Action", value: ACTION_META[log.actionType].label },
                { label: "Trigger source", value: triggerSource(log) },
                {
                  label: "Started",
                  value: formatLogTimestamp(log.timestamp),
                },
                {
                  label: "Execution time",
                  value: formatDuration(log.executionDurationMs),
                },
                {
                  label: "Queue delay",
                  value: formatDuration(queueDelay(log)),
                },
                {
                  label: "Driver",
                  value: String(log.payload?.driver ?? "—"),
                },
                {
                  label: "Initiated by",
                  // Honest placeholder: there is no auth layer to attribute this.
                  value: "Not attributed",
                },
                { label: "Run ID", value: log.id, mono: true },
              ]}
            />
          </section>

          {log.errorMessage && (
            <section>
              <h3 className="eyebrow mb-2">Error</h3>
              <div className="rounded-control border border-danger/25 bg-danger/[0.06] p-3.5">
                <p className="break-words text-body leading-relaxed text-danger">
                  {log.errorMessage}
                </p>
              </div>
            </section>
          )}

          {failed && (
            <section>
              <h3 className="eyebrow mb-2 inline-flex items-center gap-1">
                Failure artifact
                <InfoHint content={TOOLTIPS.artifact} label="About artifacts" />
              </h3>
              {artifact ? (
                artifact.kind === "image" ? (
                  <ArtifactViewer url={artifact.url} runUrl={artifact.runUrl} />
                ) : artifact.kind === "github" ? (
                  <GitHubArtifactLink url={artifact.url} />
                ) : (
                  <RunLink url={artifact.url} />
                )
              ) : (
                <div className="flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-5">
                  <ImageOff
                    className="h-4 w-4 shrink-0 text-content-disabled"
                    aria-hidden
                  />
                  <p className="text-support text-content-muted">
                    The runner did not capture an artifact for this run.
                  </p>
                </div>
              )}
            </section>
          )}

          <Disclosure label="Technical details">
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-support text-content-muted">
                  Request payload
                </p>
                <pre className="max-h-72 overflow-auto rounded-control border border-[var(--border-subtle)] bg-bg-primary/70 p-3.5 font-mono text-support leading-relaxed text-content-secondary">
                  {JSON.stringify(log.payload, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1.5 text-support text-content-muted">
                  Correlation ID
                </p>
                <p className="tabular font-mono text-support text-content-secondary">
                  {log.id}
                </p>
              </div>
            </div>
          </Disclosure>
        </div>
      )}
    </Drawer>
  );
}

function SummaryGrid({
  items,
}: {
  items: Array<{ label: string; value: string; mono?: boolean }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-control border border-[var(--border-subtle)] bg-[var(--border-subtle)]">
      {items.map((item) => (
        <div key={item.label} className="bg-bg-elevated px-3.5 py-2.5">
          <dt className="text-meta text-content-muted">{item.label}</dt>
          <dd
            className={cn(
              "mt-0.5 truncate text-body text-content-primary",
              item.mono && "tabular font-mono text-support",
            )}
            title={item.value}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <section className="rounded-control border border-[var(--border-subtle)]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left focus-ring"
      >
        <span className="text-body font-medium text-content-secondary">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-content-muted transition-transform duration-expand",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-[var(--border-subtle)] px-3.5 py-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * Only an actual image can go in an <img>. The GitHub driver reports the run's
 * Actions page as its artifact, and `upload-artifact` produces an auth-gated
 * zip rather than a hotlinkable PNG — feeding either to the viewer just renders
 * a broken-image fallback. Anything that is not plainly an image is offered as
 * a link out instead.
 */
function isRenderableImage(url: string): boolean {
  if (url.startsWith("data:image/")) return true;
  try {
    const { pathname } = new URL(url, "https://placeholder.invalid");
    return /\.(png|jpe?g|webp|gif|avif)$/i.test(pathname);
  } catch {
    return false;
  }
}

function isGitHubActions(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions/.test(url);
}

/** Payload keys a runner is likely to hang a direct screenshot URL off. */
const IMAGE_PAYLOAD_KEYS = [
  "screenshotUrl",
  "screenshot_url",
  "screenshot",
  "imageUrl",
  "image_url",
  "image",
  "artifactImageUrl",
  "previewUrl",
  "preview_url",
];

type Artifact =
  | { kind: "image"; url: string; runUrl: string | null }
  | { kind: "github"; url: string }
  | { kind: "link"; url: string };

/**
 * Resolves what the drawer can actually show. A direct image wins wherever it
 * comes from — `artifactUrl` itself, or an S3/Cloudinary/base64 URL the runner
 * attached to the payload — because that is the only case an <img> can render.
 * A GitHub Actions URL is a page, not a file, so it becomes a link out.
 */
function resolveArtifact(log: LogRow): Artifact | null {
  const direct = log.artifactUrl;

  if (direct && isRenderableImage(direct)) {
    return { kind: "image", url: direct, runUrl: null };
  }

  const payload = log.payload ?? {};
  for (const key of IMAGE_PAYLOAD_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && isRenderableImage(value)) {
      return {
        kind: "image",
        url: value,
        // The run page stays reachable alongside the inline screenshot.
        runUrl: direct && isGitHubActions(direct) ? direct : null,
      };
    }
  }

  if (!direct) return null;
  return isGitHubActions(direct)
    ? { kind: "github", url: direct }
    : { kind: "link", url: direct };
}

/**
 * GitHub artifacts are zipped and behind auth — there is nothing to embed, so
 * the honest affordance is a single action that leaves the app.
 */
function GitHubArtifactLink({ url }: { url: string }) {
  return (
    <div className="rounded-control border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-4">
      <p className="text-support leading-relaxed text-content-muted">
        Screenshots are uploaded to the workflow run as a zipped artifact.
        GitHub requires sign-in to download them, so they cannot be shown here.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex h-9 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-[var(--border-default)] bg-white/[0.05] px-3 text-support text-content-primary transition-all duration-press hover:-translate-y-px hover:border-[var(--border-strong)] hover:bg-white/[0.09] active:translate-y-0 focus-ring"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        View Run Artifacts on GitHub
      </a>
    </div>
  );
}

/** Escape hatch for artifacts that live behind a page rather than at a URL. */
function RunLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-control border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-4 transition-colors hover:bg-white/[0.05] focus-ring"
    >
      <ExternalLink
        className="mt-0.5 h-4 w-4 shrink-0 text-content-muted"
        aria-hidden
      />
      <span className="min-w-0">
        <span className="block text-body text-content-primary">
          Open the artifact
        </span>
        <span className="mt-0.5 block break-all text-support text-content-muted">
          {url}
        </span>
      </span>
    </a>
  );
}

function ArtifactViewer({
  url,
  runUrl,
}: {
  url: string;
  /** Present when the screenshot came from the payload of a GitHub run. */
  runUrl?: string | null;
}) {
  const [zoom, setZoom] = React.useState(1);
  const [lightbox, setLightbox] = React.useState(false);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">(
    "loading",
  );

  React.useEffect(() => {
    setZoom(1);
    setStatus("loading");
    setLightbox(false);
  }, [url]);

  const clamp = (value: number) => Math.min(4, Math.max(1, value));

  return (
    <div className="overflow-hidden rounded-control border border-[var(--border-subtle)] bg-bg-primary/70">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-2.5 py-2">
        <div className="flex items-center gap-1">
          <IconButton
            label="Zoom out"
            onClick={() => setZoom((z) => clamp(z - 0.25))}
            disabled={zoom <= 1}
            className="h-8 w-8"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </IconButton>
          <span className="tabular w-12 text-center font-mono text-support text-content-muted">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton
            label="Zoom in"
            onClick={() => setZoom((z) => clamp(z + 0.25))}
            disabled={zoom >= 4}
            className="h-8 w-8"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </IconButton>
          <IconButton
            label="Reset zoom"
            onClick={() => setZoom(1)}
            className="h-8 w-8"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </IconButton>
          <IconButton
            label="Expand artifact"
            onClick={() => setLightbox(true)}
            disabled={status === "error"}
            className="h-8 w-8"
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </IconButton>
        </div>

        <div className="flex items-center gap-1">
          {runUrl && (
            <a
              href={runUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-support text-content-muted transition-colors hover:bg-white/[0.05] hover:text-content-primary focus-ring"
            >
              GitHub run
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-support text-content-muted transition-colors hover:bg-white/[0.05] hover:text-content-primary focus-ring"
          >
            Open original
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </div>

      <div className="relative h-[300px] overflow-auto">
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-support text-content-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading artifact…
          </div>
        )}

        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <ImageOff className="h-5 w-5 text-content-disabled" aria-hidden />
            <p className="text-support text-content-muted">
              Artifact could not be rendered inline.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-support text-alpha underline underline-offset-2"
            >
              Open in a new tab
            </a>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt="Screenshot captured when this dispatch failed"
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("error")}
            style={{ transform: `scale(${zoom})` }}
            className={cn(
              "block w-full origin-top-left cursor-zoom-in transition-transform duration-200",
              status === "loading" && "opacity-0",
            )}
            onClick={() => setLightbox(true)}
          />
        )}
      </div>

      {/* Full-bleed preview; the modal is centred and capped at the viewport. */}
      <Modal
        open={lightbox}
        onOpenChange={setLightbox}
        title="Failure artifact"
        description="Screenshot captured when this dispatch failed."
        className="max-w-4xl"
        footer={
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-[var(--border-default)] bg-white/[0.05] px-3 text-support text-content-primary transition-colors hover:bg-white/[0.09] focus-ring"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Open original
          </a>
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Screenshot captured when this dispatch failed"
          className="mx-auto block h-auto w-full rounded-control"
        />
      </Modal>
    </div>
  );
}
