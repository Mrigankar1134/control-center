import type { ActionType } from "@/db/schema";

export interface DispatchPayload {
  runId: string;
  action: ActionType;
  bypassDelay: boolean;
  delayMs: number;
  source: "MANUAL" | "CRON";
  triggeredAt: string;
}

export interface DispatchResult {
  driver: "WEBHOOK" | "GITHUB_WORKFLOW" | "GITHUB_REPOSITORY" | "SIMULATED";
  ok: boolean;
  statusCode?: number;
  detail?: string;
  artifactUrl?: string | null;
}

const DISPATCH_TIMEOUT_MS = 15_000;

/**
 * Downstream trigger driver.
 *
 * Resolution order:
 *   1. DISPATCH_WEBHOOK_URL  -> generic POST webhook
 *   2. GITHUB_* credentials  -> Actions workflow_dispatch, falling back to
 *                               repository_dispatch when no workflow id is set
 *   3. nothing configured    -> simulated dispatch so the UI stays usable in dev
 */
export async function triggerDownstream(
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const webhookUrl = process.env.DISPATCH_WEBHOOK_URL;
  if (webhookUrl) {
    return dispatchWebhook(webhookUrl, payload);
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (token && owner && repo) {
    return dispatchGitHub({ token, owner, repo }, payload);
  }

  return {
    driver: "SIMULATED",
    ok: true,
    detail:
      "No downstream driver configured (set DISPATCH_WEBHOOK_URL or GITHUB_TOKEN/OWNER/REPO). Dispatch was recorded but not forwarded.",
    artifactUrl: null,
  };
}

async function dispatchWebhook(
  url: string,
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Dispatch-Run-Id": payload.runId,
  };

  const secret = process.env.DISPATCH_WEBHOOK_SECRET;
  if (secret) headers["X-Dispatch-Secret"] = secret;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const body = await safeText(response);

  return {
    driver: "WEBHOOK",
    ok: response.ok,
    statusCode: response.status,
    detail: response.ok ? undefined : body || response.statusText,
    artifactUrl: extractArtifactUrl(body),
  };
}

async function dispatchGitHub(
  creds: { token: string; owner: string; repo: string },
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const { token, owner, repo } = creds;
  const workflowId = process.env.GITHUB_WORKFLOW_ID;
  const ref = process.env.GITHUB_REF || "main";

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const url = workflowId
    ? `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`
    : `https://api.github.com/repos/${owner}/${repo}/dispatches`;

  // workflow_dispatch inputs must be strings; repository_dispatch takes free JSON.
  const body = workflowId
    ? {
        ref,
        inputs: {
          action: payload.action,
          run_id: payload.runId,
          bypass_delay: String(payload.bypassDelay),
          delay_ms: String(payload.delayMs),
          source: payload.source,
        },
      }
    : {
        event_type: payload.action.toLowerCase(),
        client_payload: payload,
      };

  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await safeText(response);

  return {
    driver: workflowId ? "GITHUB_WORKFLOW" : "GITHUB_REPOSITORY",
    ok: response.ok,
    statusCode: response.status,
    detail: response.ok
      ? undefined
      : text || `GitHub responded ${response.status} ${response.statusText}`,
    artifactUrl: response.ok
      ? `https://github.com/${owner}/${repo}/actions`
      : null,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 2000);
  } catch {
    return "";
  }
}

/** Downstream runners may return { artifactUrl } pointing at a failure screenshot. */
function extractArtifactUrl(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const value = parsed.artifactUrl ?? parsed.artifact_url;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
