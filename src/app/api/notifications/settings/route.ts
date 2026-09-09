import { db } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, structuredError, readJson, fail } from "@/lib/api-helpers";
import { notificationSettingsSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const row = await db.setting.findUnique({ where: { key: "notifications" } });
    const val = row ? JSON.parse(row.value) : {};
    return ok({
      settings: {
        sslThresholds: val.sslThresholds || [30, 15, 7, 5],
        domainThresholds: val.domainThresholds || [60, 30, 15, 7, 5],
        mandatoryAlertDays: val.mandatoryAlertDays || 5,
      },
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requirePermission("notifications.manage");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = notificationSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;
    if (data.mandatoryAlertDays !== 5) {
      return fail(400, "MANDATORY_THRESHOLD", "The 5-day critical alert threshold is mandatory and cannot be disabled (spec §64.12)");
    }
    const value = JSON.stringify({
      sslThresholds: data.sslThresholds.sort((a, b) => b - a),
      domainThresholds: data.domainThresholds.sort((a, b) => b - a),
      mandatoryAlertDays: 5,
    });
    await db.setting.upsert({
      where: { key: "notifications" },
      create: { key: "notifications", value },
      update: { value },
    });
    await audit({
      actor: user.email,
      action: "SETTINGS_UPDATED",
      resourceType: "SETTING",
      detail: `Notification thresholds updated — SSL: ${data.sslThresholds.join("/")}, Domain: ${data.domainThresholds.join("/")}`,
    });
    return ok({ settings: JSON.parse(value) });
  } catch (e) {
    return structuredError(e);
  }
}
