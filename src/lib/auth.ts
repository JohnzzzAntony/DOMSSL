import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

/**
 * Authentication & RBAC (spec §32, §62).
 * - Password hashing: scrypt (memory-hard KDF, Argon2id-equivalent class)
 * - Sessions: opaque random tokens, SHA-256 hashed in DB, httpOnly secure cookies
 * - RBAC: OWNER > ADMIN > OPERATOR > VIEWER with granular permissions
 */

export const SESSION_COOKIE = "dsm_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Password hashing ────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const hash = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64, {
      N: 16384,
      r: 8,
      p: 1,
    });
    const expected = Buffer.from(hashHex, "hex");
    return (
      hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
    );
  } catch {
    return false;
  }
}

// ─── Sessions ────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      ip: ip || null,
      userAgent: userAgent || null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  // Opportunistic cleanup of expired sessions
  db.session
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }
  store.delete(SESSION_COOKIE);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  twoFactorEnabled: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const session = await db.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    if (!session.user.isActive) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      twoFactorEnabled: session.user.twoFactorEnabled,
    };
  } catch {
    return null;
  }
}

// ─── RBAC (spec §32) ─────────────────────────────────────────────────

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

export function hasPermission(role: string, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.VIEWER).includes(
    permission
  );
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Require an authenticated user with the given permission, else throw. */
export async function requirePermission(
  permission: Permission
): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  if (!hasPermission(user.role, permission)) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      `Your role (${user.role}) does not include permission: ${permission}`
    );
  }
  return user;
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  return user;
}
