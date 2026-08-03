"use server";

import crypto from "node:crypto";

import { Octokit } from "@octokit/rest";
import { revalidatePath } from "next/cache";

import type { RunAction } from "@/db/schema";

/**
 * Manual dispatch, gated on a PIN.
 *
 * The PIN is never stored in plaintext: `DASHBOARD_PIN_HASH` holds its SHA-256
 * digest, and the submitted value is hashed and compared in constant time. This
 * runs server-side only, so a hand-written fetch cannot reach the workflow
 * without the PIN either.
 */

const WORKFLOW_FILE = "automation.yml";

/** Mirrors the workflow's `action` input, which the bot reads as DISPATCH_ACTION. */
export type DispatchAction = "ACTION_ALPHA" | "ACTION_BETA";

export interface DispatchResult {
  readonly ok: boolean;
  readonly message: string;
  /** Present only on success — correlates with `run_logs.runId`. */
  readonly runId?: string;
}

/**
 * Maps the dispatched action onto the punch it performs, for logging.
 * Not exported: a "use server" module may only export async functions.
 */
const ACTION_TO_PUNCH: Readonly<Record<DispatchAction, RunAction>> = {
  ACTION_ALPHA: "Check-in",
  ACTION_BETA: "Check-out",
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Timing-safe comparison of two hex digests.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak a bit of
 * information, so both sides are hashed to a fixed width before comparing.
 */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Verify the PIN and trigger a manual `workflow_dispatch` run.
 *
 * @param pin    Operator-supplied PIN, compared against DASHBOARD_PIN_HASH.
 * @param action ACTION_ALPHA for a check-in, ACTION_BETA for a check-out.
 */
export async function dispatchRun(
  pin: string,
  action: DispatchAction,
): Promise<DispatchResult> {
  const expected = process.env.DASHBOARD_PIN_HASH;
  if (!expected) {
    return { ok: false, message: "DASHBOARD_PIN_HASH is not configured." };
  }

  if (!pin || !digestsMatch(sha256(pin), expected.trim().toLowerCase())) {
    // Deliberately identical message for "no PIN" and "wrong PIN".
    return { ok: false, message: "Invalid PIN." };
  }

  const runId = crypto.randomUUID();

  try {
    const octokit = new Octokit({ auth: requireEnv("GITHUB_TOKEN") });

    await octokit.rest.actions.createWorkflowDispatch({
      owner: requireEnv("GITHUB_OWNER"),
      repo: requireEnv("GITHUB_REPO"),
      workflow_id: WORKFLOW_FILE,
      ref: process.env.GITHUB_REF ?? "master",
      inputs: {
        mode: "PUNCH",
        action,
        source: "MANUAL",
        // The operator is watching; the scheduled jitter would only make them
        // wait. The bot reads this and skips randomize_start().
        bypass_delay: "true",
        run_id: runId,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Could not trigger the workflow: ${detail}` };
  }

  revalidatePath("/dashboard");

  return {
    ok: true,
    runId,
    message: `Dispatched ${ACTION_TO_PUNCH[action]} (${action}).`,
  };
}
