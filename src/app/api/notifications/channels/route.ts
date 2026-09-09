import { db } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { channelConfigSchema } from "@/lib/validators";
import { encryptJSON } from "@/lib/crypto";
import { sendTestNotification } from "@/lib/engines/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const channels = await db.notificationChannel.findMany({ orderBy: { type: "asc" } });
    return ok({
      channels: channels.map((c) => ({
        id: c.id,
        type: c.type,
        enabled: c.enabled,
        status: c.status,
        lastTestedAt: c.lastTestedAt?.toISOString() || null,
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requirePermission("notifications.manage");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = channelConfigSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;
    // Encrypt channel secrets at rest (spec §33)
    await db.notificationChannel.upsert({
      where: { type: data.type },
      create: {
        type: data.type,
        enabled: data.enabled,
        encryptedConf: encryptJSON(data.config),
        status: data.enabled ? "CONNECTED" : "NOT_CONNECTED",
      },
      update: {
        enabled: data.enabled,
        encryptedConf: encryptJSON(data.config),
        status: data.enabled ? "CONNECTED" : "NOT_CONNECTED",
      },
    });
    await audit({
      actor: user.email,
      action: "CHANNEL_UPDATED",
      resourceType: "NOTIFICATION_CHANNEL",
      detail: `Channel ${data.type} ${data.enabled ? "enabled" : "disabled"} — config encrypted at rest`,
    });
    return ok({ updated: true });
  } catch (e) {
    return structuredError(e);
  }
}

/** POST — send a test notification through a specific channel. */
export async function POST(req: Request) {
  try {
    await requirePermission("notifications.manage");
    const body = await readJson<{ type?: string }>(req);
    const type = (body.type || "").toUpperCase();
    if (!["EMAIL", "WHATSAPP", "TELEGRAM", "SLACK"].includes(type)) {
      return fail(400, "VALIDATION_ERROR", "type must be one of EMAIL, WHATSAPP, TELEGRAM, SLACK");
    }
    const result = await sendTestNotification(type as "EMAIL" | "WHATSAPP" | "TELEGRAM" | "SLACK");
    return ok(result);
  } catch (e) {
    return structuredError(e);
  }
}
