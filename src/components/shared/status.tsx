"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Play,
  HelpCircle,
  ShieldCheck,
  Undo2,
  Loader2,
  Circle,
} from "lucide-react";

/**
 * Status system (spec §42): color + icon + text — never color alone.
 */

const TONE_CLASSES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200",
  blue: "bg-sky-50 text-sky-700 border-sky-200",
  purple: "bg-violet-50 text-violet-700 border-violet-200",
  gray: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  HEALTHY: CheckCircle2,
  VERIFIED: ShieldCheck,
  CONNECTED: CheckCircle2,
  ONLINE: CheckCircle2,
  INSTALLED: CheckCircle2,
  SUCCESS: CheckCircle2,
  VALID: CheckCircle2,
  EXPIRING_SOON: Clock,
  DOMAIN_EXPIRING: Clock,
  WARNING: AlertTriangle,
  PENDING: Clock,
  RUNNING: Loader2,
  QUEUED: Clock,
  UNVERIFIED: HelpCircle,
  NOT_CONNECTED: HelpCircle,
  NOT_INSTALLED: HelpCircle,
  UNKNOWN: HelpCircle,
  MANUAL_ACTION: HelpCircle,
  ROLLED_BACK: Undo2,
  CRITICAL: AlertTriangle,
  EXPIRED: XCircle,
  ERROR: XCircle,
  FAILED: XCircle,
  OFFLINE: XCircle,
  SSL_ERROR: XCircle,
  MISMATCH: AlertTriangle,
  HOSTNAME_MISMATCH: XCircle,
  INVALID_CHAIN: XCircle,
  DEPLOY_FAILED: XCircle,
  CANCELLED: Circle,
};

const STATUS_LABELS: Record<string, string> = {
  HEALTHY: "Healthy",
  VERIFIED: "Verified",
  MISMATCH: "Mismatch",
  UNVERIFIED: "Unverified",
  FAILED: "Failed",
  PENDING: "Pending",
  EXPIRING_SOON: "Expiring Soon",
  DOMAIN_EXPIRING: "Domain Expiring",
  WARNING: "Warning",
  CRITICAL: "Critical",
  EXPIRED: "Expired",
  SSL_ERROR: "SSL Error",
  VALID: "Valid",
  EXPIRING: "Expiring",
  HOSTNAME_MISMATCH: "Hostname Mismatch",
  INVALID_CHAIN: "Invalid Chain",
  DEPLOY_FAILED: "Deployment Failed",
  INSTALLED: "Installed",
  NOT_INSTALLED: "Not Installed",
  ROLLED_BACK: "Rolled Back",
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Unknown",
  CONNECTED: "Connected",
  NOT_CONNECTED: "Not Connected",
  SUCCESS: "Success",
  RUNNING: "Running",
  QUEUED: "Queued",
  CANCELLED: "Cancelled",
};

export function statusTone(status: string): string {
  const map: Record<string, string> = {
    HEALTHY: "green", VERIFIED: "green", CONNECTED: "green", ONLINE: "green",
    INSTALLED: "green", SUCCESS: "green", VALID: "green",
    EXPIRING_SOON: "amber", DOMAIN_EXPIRING: "amber", WARNING: "amber", EXPIRING: "amber",
    PENDING: "blue", RUNNING: "blue", QUEUED: "blue",
    UNVERIFIED: "gray", NOT_CONNECTED: "gray", NOT_INSTALLED: "gray", UNKNOWN: "gray", CANCELLED: "gray",
    MANUAL_ACTION: "purple", ROLLED_BACK: "purple",
  };
  return map[status] || "red";
}

export function StatusBadge({ status, className, size }: { status: string; className?: string; size?: "sm" | "default" }) {
  const tone = statusTone(status);
  const Icon = STATUS_ICONS[status] || HelpCircle;
  const label = STATUS_LABELS[status] || status.replace(/_/g, " ");
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        size === "sm" ? "px-1.5 py-0 text-[10px]" : "text-xs",
        className
      )}
    >
      <Icon className={cn("shrink-0", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3", status === "RUNNING" && "animate-spin")} />
      {label}
    </Badge>
  );
}

/** Days-remaining pill with semantic color. */
export function DaysBadge({ days, kind }: { days: number | null | undefined; kind: "SSL" | "DOMAIN" }) {
  if (days === null || days === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  let tone = "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (days <= 0) tone = "text-red-700 bg-red-50 border-red-200";
  else if (days <= (kind === "SSL" ? 7 : 15)) tone = "text-red-700 bg-red-50 border-red-200";
  else if (days <= (kind === "SSL" ? 30 : 60)) tone = "text-amber-700 bg-amber-50 border-amber-200";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tone)}>
      {days <= 0 ? "Expired" : `${days} days`}
    </span>
  );
}

/** Verification status chip — the core trust indicator (spec §2, §49). */
export function VerificationChip({ status }: { status: string }) {
  if (status === "VERIFIED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <ShieldCheck className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  if (status === "MISMATCH") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
        <AlertTriangle className="h-3.5 w-3.5" /> Date Mismatch
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
        <XCircle className="h-3.5 w-3.5" /> Check Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
      <HelpCircle className="h-3.5 w-3.5" /> Unverified
    </span>
  );
}

/** Automation ON/OFF indicator (spec §68). */
export function AutomationChip({ autoRenew, autoInstall }: { autoRenew: boolean; autoInstall: boolean }) {
  const on = autoRenew || autoInstall;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", on ? "text-emerald-700" : "text-slate-400")}>
      {on ? (
        <>
          <Play className="h-3 w-3 fill-current" /> ON
        </>
      ) : (
        <>
          <Circle className="h-3 w-3" /> OFF
        </>
      )}
    </span>
  );
}
