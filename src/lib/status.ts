/**
 * Expiry logic & status system (spec §37, §42).
 * Shared between engines, API and UI.
 */

export type Severity = "HEALTHY" | "EXPIRING_SOON" | "WARNING" | "CRITICAL" | "EXPIRED";

export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86400000);
}

export function daysRemaining(until: Date): number {
  return daysBetween(new Date(), until);
}

/**
 * SSL status thresholds (spec §37):
 *   > 30 days   → Healthy
 *   8–30 days   → Expiring Soon
 *   5–7 days    → Warning
 *   1–4 days    → Critical
 *   ≤ 0 days    → Expired
 */
export function sslStatusFromDays(days: number): Severity {
  if (days <= 0) return "EXPIRED";
  if (days <= 4) return "CRITICAL";
  if (days <= 7) return "WARNING";
  if (days <= 30) return "EXPIRING_SOON";
  return "HEALTHY";
}

/**
 * Domain status thresholds (configurable; 5-day mandatory alert retained).
 *   > 60  → Healthy
 *   16–60 → Expiring Soon
 *   8–15  → Warning
 *   1–7   → Critical (includes the mandatory 5-day window)
 *   ≤ 0   → Expired
 */
export function domainStatusFromDays(days: number): Severity {
  if (days <= 0) return "EXPIRED";
  if (days <= 7) return "CRITICAL";
  if (days <= 15) return "WARNING";
  if (days <= 60) return "EXPIRING_SOON";
  return "HEALTHY";
}

export function severityToStatus(sev: Severity, kind: "SSL" | "DOMAIN"): string {
  if (kind === "SSL") {
    switch (sev) {
      case "HEALTHY": return "HEALTHY";
      case "EXPIRING_SOON": return "EXPIRING_SOON";
      case "WARNING": return "WARNING";
      case "CRITICAL": return "CRITICAL";
      case "EXPIRED": return "EXPIRED";
    }
  }
  switch (sev) {
    case "HEALTHY": return "HEALTHY";
    case "EXPIRING_SOON": return "DOMAIN_EXPIRING";
    case "WARNING": return "DOMAIN_EXPIRING";
    case "CRITICAL": return "CRITICAL";
    case "EXPIRED": return "EXPIRED";
  }
}

/** Notification threshold gates (spec §20, §37): mandatory ≤5 days alert. */
export const DEFAULT_SSL_THRESHOLDS = [30, 15, 7, 5];
export const DEFAULT_DOMAIN_THRESHOLDS = [60, 30, 15, 7, 5];
export const MANDATORY_ALERT_DAYS = 5;

export function shouldNotify(
  days: number,
  thresholds: number[],
  alreadyNotifiedAt: Map<number, boolean>
): boolean {
  for (const t of thresholds) {
    if (days <= t && !alreadyNotifiedAt.get(t)) return true;
  }
  return false;
}

export const STATUS_META: Record<
  string,
  { label: string; tone: "green" | "amber" | "red" | "blue" | "purple" | "gray" }
> = {
  HEALTHY: { label: "Healthy", tone: "green" },
  VERIFIED: { label: "Verified", tone: "green" },
  CONNECTED: { label: "Connected", tone: "green" },
  ONLINE: { label: "Online", tone: "green" },
  INSTALLED: { label: "Installed", tone: "green" },
  SUCCESS: { label: "Success", tone: "green" },
  VALID: { label: "Valid", tone: "green" },
  EXPIRING_SOON: { label: "Expiring Soon", tone: "amber" },
  DOMAIN_EXPIRING: { label: "Domain Expiring", tone: "amber" },
  WARNING: { label: "Warning", tone: "amber" },
  PENDING: { label: "Pending", tone: "blue" },
  RUNNING: { label: "Running", tone: "blue" },
  QUEUED: { label: "Queued", tone: "blue" },
  UNVERIFIED: { label: "Unverified", tone: "gray" },
  NOT_CONNECTED: { label: "Not Connected", tone: "gray" },
  NOT_INSTALLED: { label: "Not Installed", tone: "gray" },
  UNKNOWN: { label: "Unknown", tone: "gray" },
  MANUAL_ACTION: { label: "Manual Action", tone: "purple" },
  ROLLED_BACK: { label: "Rolled Back", tone: "purple" },
  CRITICAL: { label: "Critical", tone: "red" },
  EXPIRED: { label: "Expired", tone: "red" },
  ERROR: { label: "Error", tone: "red" },
  FAILED: { label: "Failed", tone: "red" },
  OFFLINE: { label: "Offline", tone: "red" },
  SSL_ERROR: { label: "SSL Error", tone: "red" },
  MISMATCH: { label: "Mismatch", tone: "red" },
  HOSTNAME_MISMATCH: { label: "Hostname Mismatch", tone: "red" },
  INVALID_CHAIN: { label: "Invalid Chain", tone: "red" },
  DEPLOY_FAILED: { label: "Deployment Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

/** Domain roll-up status combining domain + SSL state. */
export function computeDomainStatus(input: {
  verificationStatus: string;
  domainExpiresAt?: Date | null;
  sslExpiresAt?: Date | null;
  sslStatus?: string | null;
}): string {
  const now = new Date();
  if (input.sslStatus === "SSL_ERROR" || input.sslStatus === "HOSTNAME_MISMATCH" || input.sslStatus === "INVALID_CHAIN") {
    return "SSL_ERROR";
  }
  if (input.domainExpiresAt) {
    const dDays = daysBetween(now, input.domainExpiresAt);
    if (dDays <= 0) return "EXPIRED";
    if (dDays <= 7) return "CRITICAL";
    if (dDays <= 15) return "DOMAIN_EXPIRING";
  }
  if (input.sslExpiresAt) {
    const sDays = daysBetween(now, input.sslExpiresAt);
    if (sDays <= 0) return "EXPIRED";
    if (sDays <= 7) return "CRITICAL";
    if (sDays <= 30) return "EXPIRING_SOON";
  }
  if (input.verificationStatus === "MISMATCH") return "WARNING";
  if (input.verificationStatus === "UNVERIFIED") return "UNVERIFIED";
  return "HEALTHY";
}
