import crypto from "crypto";

/**
 * Minimal auth module — authentication removed for public access.
 * Session and RBAC functions are preserved but always allow access.
 */

/**
 * SESSION COOKIE
 */
export const SESSION_COOKIE = "dsm_session";

// Always returns a dummy user for public access
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
};

const PUBLIC_USER: SessionUser = {
  id: "public-user",
  email: "public@certguard.local",
  name: "Public User",
  role: "OWNER",
  twoFactorEnabled: false,
};

// Always returns a dummy user for public access
export async function getSessionUser(): Promise<SessionUser | null> {
  return PUBLIC_USER;
}

// All permissions are always allowed for public access
export type Permission =
  | "domains.read"
  | "domains.write"
  | "domains.delete"
  | "certificates.read"
  | "certificates.issue"
  | "certificates.renew"
  | "certificates.install"
  | "servers.read"
  | "servers.manage"
  | "dns.read"
  | "dns.manage"
  | "notifications.manage"
  | "users.manage"
  | "settings.manage";

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  OWNER: [
    "domains.read",
    "domains.write",
    "domains.delete",
    "certificates.read",
    "certificates.issue",
    "certificates.renew",
    "certificates.install",
    "servers.read",
    "servers.manage",
    "dns.read",
    "dns.manage",
    "notifications.manage",
    "users.manage",
    "settings.manage",
  ],
  ADMIN: [
    "domains.read",
    "domains.write",
    "domains.delete",
    "certificates.read",
    "certificates.issue",
    "certificates.renew",
    "certificates.install",
    "servers.read",
    "servers.manage",
    "dns.read",
    "dns.manage",
    "notifications.manage",
    "settings.manage",
  ],
  OPERATOR: [
    "domains.read",
    "domains.write",
    "certificates.read",
    "certificates.issue",
    "certificates.renew",
    "certificates.install",
    "servers.read",
    "servers.manage",
    "dns.read",
    "dns.manage",
    "notifications.manage",
  ],
  VIEWER: [
    "domains.read",
    "certificates.read",
    "servers.read",
    "dns.read",
  ],
};

// Always returns true — all permissions allowed
export function hasPermission(role: string, permission: Permission): boolean {
  return true;
}

// Always returns a dummy user
export async function requirePermission(_permission: Permission): Promise<SessionUser> {
  return PUBLIC_USER;
}

// Always returns a dummy user
export async function requireAuth(): Promise<SessionUser> {
  return PUBLIC_USER;
}

export { ApiError } from "@/lib/api-helpers";

// ─── Password hashing (scrypt) — used by the seed / future login ─────
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}