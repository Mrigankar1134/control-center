import { randomUUID } from "crypto";

import { db } from "@/db";
import { auditLog, type AuditAction } from "@/db/schema";

/**
 * Appends an audit entry. Deliberately non-throwing: losing an audit row must
 * never fail the operation the user actually asked for, but it is logged
 * server-side so the gap is visible.
 *
 * `actor` stays null until an auth layer exists to attribute changes.
 */
export async function recordAudit(entry: {
  action: AuditAction;
  summary: string;
  actor?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: randomUUID(),
      action: entry.action,
      summary: entry.summary,
      actor: entry.actor ?? null,
      details: entry.details ?? null,
    });
  } catch (error) {
    console.error("[audit] failed to record entry", entry.action, error);
  }
}
