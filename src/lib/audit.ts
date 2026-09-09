import { db } from "@/lib/db";

/**
 * Audit logging (spec §34). Every sensitive action must be recorded.
 */

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "DOMAIN_CREATED"
  | "DOMAIN_UPDATED"
  | "DOMAIN_DELETED"
  | "DOMAIN_VERIFIED"
  | "DOMAIN_DATE_ACCEPTED"
  | "BULK_SCAN"
  | "SSL_INSPECTED"
  | "SSL_REQUESTED"
  | "SSL_RENEWED"
  | "SSL_INSTALLED"
  | "SSL_ROLLBACK"
  | "SERVER_CREATED"
  | "SERVER_UPDATED"
  | "SERVER_DELETED"
  | "SERVER_CONNECTION_TESTED"
  | "SERVER_OPERATION"
  | "DNS_PROVIDER_ADDED"
  | "DNS_PROVIDER_REMOVED"
  | "DNS_RECORD_CREATED"
  | "DNS_RECORD_DELETED"
  | "NOTIFICATION_SENT"
  | "SETTINGS_UPDATED"
  | "USER_CREATED"
  | "CHANNEL_UPDATED";

export async function audit(entry: {
  actor?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  detail?: string;
  ip?: string;
  result?: "SUCCESS" | "FAILED";
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actor: entry.actor || "system",
        action: entry.action,
        resourceType: entry.resourceType || null,
        resourceId: entry.resourceId || null,
        detail: entry.detail || null,
        ip: entry.ip || null,
        result: entry.result || "SUCCESS",
      },
    });
  } catch (e) {
    console.error("[audit] failed to write audit entry", e);
  }
}
