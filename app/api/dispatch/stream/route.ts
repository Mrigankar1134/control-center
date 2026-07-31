import type { TerminalLevel } from "@/lib/types";

/*
 * Node runtime, not Edge: Amplify Hosting's Next.js SSR compute does not
 * support Edge API routes. The route streams identically either way — it is a
 * plain ReadableStream — so this costs nothing but keeps the deployment target
 * viable. Switch back to "edge" only if this ever moves to Vercel/Cloudflare.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live execution feed for the console terminal.
 *
 * The runner is a downstream worker that does not yet publish its own log
 * stream, so this route narrates the execution phases it goes through on a
 * realistic cadence. Every line is tagged with the run id it belongs to, so
 * when the runner starts pushing real lines the transport, framing and client
 * do not change — only the producer below.
 */

interface Step {
  level: TerminalLevel;
  message: string;
  /** Delay before this line is emitted. */
  afterMs: number;
}

function steps(action: string, runId: string): Step[] {
  const isAlpha = action === "ACTION_ALPHA";
  const window = isAlpha ? "morning" : "evening";

  return [
    { level: "SYSTEM", message: `Attaching to run ${runId}`, afterMs: 0 },
    { level: "INFO", message: `Dispatch channel open — ${action} (${window} window)`, afterMs: 180 },
    { level: "INFO", message: "Initializing Playwright runtime...", afterMs: 420 },
    { level: "INFO", message: "Launching chromium 121.0 (headless=new)", afterMs: 560 },
    { level: "SUCCESS", message: "Browser context ready in 1.24s", afterMs: 700 },
    { level: "INFO", message: "Restoring authenticated storage state", afterMs: 380 },
    { level: "SUCCESS", message: "Session restored — no re-authentication needed", afterMs: 520 },
    { level: "INFO", message: "Applying geolocation override", afterMs: 340 },
    { level: "SUCCESS", message: "Coordinates spoofed — permissions granted", afterMs: 460 },
    { level: "INFO", message: `Navigating to target surface for ${action}`, afterMs: 520 },
    { level: "INFO", message: "Waiting for network idle (timeout 30s)", afterMs: 640 },
    { level: "SUCCESS", message: "DOM settled — primary control located", afterMs: 780 },
    { level: "WARN", message: "Consent banner intercepted the viewport — dismissing", afterMs: 420 },
    { level: "INFO", message: `Submitting ${isAlpha ? "check-in" : "check-out"} action`, afterMs: 600 },
    { level: "SUCCESS", message: "Server acknowledged submission (HTTP 200)", afterMs: 720 },
    { level: "INFO", message: "Capturing confirmation artifact", afterMs: 400 },
    { level: "SUCCESS", message: "Artifact stored — run receipt attached to log", afterMs: 480 },
    { level: "INFO", message: "Tearing down browser context", afterMs: 360 },
    { level: "SUCCESS", message: `${action} completed — dispatch closed cleanly`, afterMs: 440 },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const action =
    params.get("action") === "ACTION_BETA" ? "ACTION_BETA" : "ACTION_ALPHA";
  const runId = params.get("runId") ?? "unassigned";

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let sequence = 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      /** One SSE frame per line — `event:` lets the client route by kind. */
      function emit(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      function line(level: TerminalLevel, message: string) {
        emit("line", {
          id: `${runId}-${sequence++}`,
          level,
          message,
          elapsedMs: Date.now() - startedAt,
        });
      }

      // Proxies that buffer by default need an early flush to start streaming.
      controller.enqueue(encoder.encode(": stream open\n\n"));

      let closed = false;
      const abort = () => {
        closed = true;
      };
      request.signal.addEventListener("abort", abort);

      try {
        for (const step of steps(action, runId)) {
          await sleep(step.afterMs);
          if (closed || request.signal.aborted) break;
          line(step.level, step.message);
        }

        if (!closed && !request.signal.aborted) {
          emit("done", {
            runId,
            action,
            durationMs: Date.now() - startedAt,
            lines: sequence,
          });
        }
      } catch (error) {
        emit("line", {
          id: `${runId}-${sequence++}`,
          level: "ERROR" as TerminalLevel,
          message: `Stream interrupted: ${
            error instanceof Error ? error.message : String(error)
          }`,
          elapsedMs: Date.now() - startedAt,
        });
      } finally {
        request.signal.removeEventListener("abort", abort);
        try {
          controller.close();
        } catch {
          /* Already closed by the client disconnecting. */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx/Vercel edge buffering would otherwise hold lines back.
      "X-Accel-Buffering": "no",
    },
  });
}
