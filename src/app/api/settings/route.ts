import { db } from "@/lib/db";
import { requirePermission, hasPermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, structuredError, readJson, fail } from "@/lib/api-helpers";
import { settingsSchema } from "@/lib/validators";


export const dynamic = "force-dynamic";

async function getSetting(key: string, fallback: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? { ...fallback, ...JSON.parse(row.value || "{}") } : fallback;
}

export async function GET() {
  try {
    await requirePermission("settings.manage");
    const [general, security, automation] = await Promise.all([
      getSetting("general", { organizationName: "Acme Infrastructure", timezone: "UTC" }),
      getSetting("security", { twoFactorRequired: false, sessionTimeoutMinutes: 10080, ipAllowlist: "", loginProtection: true, auditLogging: true }),
      getSetting("automation", { renewalThresholdDays: 30 }),
    ]);
    const integrations = await db.integration.findMany({ orderBy: { name: "asc" } });
    const users = await db.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      general,
      security,
      automation,
      integrations: integrations.map((i) => ({ id: i.id, key: i.key, name: i.name, category: i.category, status: i.status, lastTestedAt: i.lastTestedAt?.toISOString() || null })),
      users,
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requirePermission("settings.manage");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;

    if (data.organizationName !== undefined || data.timezone !== undefined) {
      const current = await getSetting("general", {});
      const value = JSON.stringify({ ...current, ...data.organizationName !== undefined ? { organizationName: data.organizationName } : {}, ...data.timezone !== undefined ? { timezone: data.timezone } : {} });
      await db.setting.upsert({ where: { key: "general" }, create: { key: "general", value }, update: { value } });
    }
    if (data.twoFactorRequired !== undefined || data.sessionTimeoutMinutes !== undefined || data.ipAllowlist !== undefined || data.loginProtection !== undefined || data.auditLogging !== undefined) {
      const current = await getSetting("security", {});
      const value = JSON.stringify({ ...current, ...data });
      await db.setting.upsert({ where: { key: "security" }, create: { key: "security", value }, update: { value } });
    }
    if (data.renewalThresholdDays !== undefined) {
      const value = JSON.stringify({ renewalThresholdDays: data.renewalThresholdDays });
      await db.setting.upsert({ where: { key: "automation" }, create: { key: "automation", value }, update: { value } });
    }
    await audit({ actor: user.email, action: "SETTINGS_UPDATED", detail: `Updated settings: ${Object.keys(data).join(", ")}` });
    return ok({ updated: true });
  } catch (e) {
    return structuredError(e);
  }
}
