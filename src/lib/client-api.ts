"use client";

import React from "react";


/**
 * Client-side API layer — typed fetch helpers for the SPA.
 */

export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "same-origin",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const err = new Error(json.message || `Request failed (${res.status})`);
    (err as Error & { code?: string; status?: number }).code = json.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  delete: <T>(url: string) => request<T>(url, { method: "DELETE" }),
};

// ─── Shared types ──────────────────────────────────────────────────────

export interface ServerRef {
  id: string;
  name: string;
  host?: string;
  status?: string;
  webServer?: string;
  operatingSystem?: string;
}

export interface DomainRow {
  id: string;
  hostname: string;
  environment: string;
  registrar: string;
  sslProvider: string;
  expiresAt: string | null;
  verifiedExpiresAt?: string | null;
  registrarExpiresAt?: string | null;
  registeredAt?: string | null;
  sslExpiresAt: string | null;
  certificateId: string | null;
  sslStatus?: string | null;
  sslDays: number | null;
  domainDays: number | null;
  status: string;
  verificationStatus: string;
  autoRenew: boolean;
  autoInstall: boolean;
  dnsAutomation?: boolean;
  alertThresholdDays?: number;
  server?: ServerRef | null;
  lastCheckedAt: string | null;
  isDemo?: boolean;
}

export interface CertificateRow {
  id: string;
  commonName: string;
  domain?: { id: string; hostname: string; environment: string; server?: { id: string; name: string } | null } | null;
  domainId?: string | null;
  issuer: string;
  subject: string;
  serialNumber?: string | null;
  fingerprint?: string | null;
  signatureAlgorithm?: string | null;
  keyType?: string | null;
  tlsVersion?: string | null;
  validFrom: string;
  validUntil: string;
  liveValidUntil?: string | null;
  sans: string[];
  status: string;
  daysRemaining: number;
  hostnameMatch: boolean;
  chainValid: boolean;
  provider: string;
  installationStatus: string;
  autoRenew: boolean;
  verificationStatus: string;
  isDemo?: boolean;
  lastCheckedAt?: string | null;
  lastDeployment?: string | null;
  history?: CertificateHistoryEntry[];
  deployments?: CertificateDeployment[];
}

export interface CertificateHistoryEntry {
  id: string;
  event: string;
  detail: string | null;
  actor: string;
  createdAt: string;
}

export interface CertificateDeployment {
  id: string;
  status: string;
  server?: { id: string; name: string; webServer: string; status: string };
  configTestPassed: boolean;
  liveVerified: boolean;
  error?: string | null;
  createdAt: string;
}

export interface ServerRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  operatingSystem: string;
  webServer: string;
  status: string;
  sshVerified?: boolean;
  lastHealthCheck: string | null;
  domainCount?: number;
  deploymentCount?: number;
  isDemo?: boolean;
  domains?: Array<{ id: string; hostname: string; status: string }>;
  deployments?: Array<{ id: string; status: string; certificate?: { commonName: string }; createdAt: string }>;
  backups?: Array<{ id: string; label: string; path: string; createdAt: string }>;
  jobs?: JobRow[];
}

export interface JobStep {
  name: string;
  status: string;
  detail?: string;
  at?: string;
}

export interface JobLogLine {
  t: string;
  level: string;
  message: string;
}

export interface JobRow {
  id: string;
  type: string;
  title: string;
  status: string;
  domain?: string | null;
  domainId?: string | null;
  progress?: number;
  durationMs?: number | null;
  error?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  steps?: JobStep[];
  logs?: JobLogLine[];
  metadata?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  domainId?: string | null;
  read: boolean;
  deliveryStatus: string;
  channels: string[];
  createdAt: string;
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  detail?: string | null;
  ip?: string | null;
  result: string;
  createdAt: string;
}

// ─── Hash router ───────────────────────────────────────────────────────

export function useHashRoute(): { path: string; navigate: (to: string) => void } {
  const [path, setPath] = React.useState(() =>
    typeof window !== "undefined" ? window.location.hash.slice(1) || "/dashboard" : "/dashboard"
  );
  React.useEffect(() => {
    const onChange = () => setPath(window.location.hash.slice(1) || "/dashboard");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = React.useCallback((to: string) => {
    window.location.hash = to;
    setPath(to);
  }, []);
  return { path, navigate };
}


export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function daysLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  if (days <= 0) return "expired";
  if (days === 1) return "1 day";
  return `${days} days`;
}
