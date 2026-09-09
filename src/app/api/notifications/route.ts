import { db } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { sendNotification } from "@/lib/engines/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    const notifications = await db.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const unread = await db.notification.count({ where: { read: false } });
    return ok({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        severity: n.severity,
        title: n.title,
        message: n.message,
        domainId: n.domainId,
        read: n.read,
        deliveryStatus: n.deliveryStatus,
        channels: JSON.parse(n.channels || "[]"),
        createdAt: n.createdAt.toISOString(),
      })),
      unread,
    });
  } catch (e) {
    return structuredError(e);
  }
}

/** PATCH — mark notifications read (or all). */
export async function PATCH(req: Request) {
  try {
    await requireAuth();
    const body = await readJson<{ ids?: string[]; markAllRead?: boolean }>(req);
    if (body.markAllRead) {
      await db.notification.updateMany({ data: { read: true } });
      return ok({ updated: true });
    }
    if (body.ids?.length) {
      await db.notification.updateMany({ where: { id: { in: body.ids } }, data: { read: true } });
      return ok({ updated: true });
    }
    return fail(400, "VALIDATION_ERROR", "Provide ids or markAllRead");
  } catch (e) {
    return structuredError(e);
  }
}

/** POST — send a test notification through all enabled channels. */
export async function POST() {
  try {
    await requirePermission("notifications.manage");
    const result = await sendNotification({
      type: "TEST",
      severity: "INFO",
      title: "Test notification — Domain & SSL Manager",
      message: `This is a test alert generated at ${new Date().toISOString()}.\nIf you can read this, your notification channels are working.`,
      channels: [],
    });
    // Also fan out across enabled channels
    const channels = await db.notificationChannel.findMany({ where: { enabled: true } });
    const { sendTestNotification } = await import("@/lib/engines/notifications");
    const results = [];
    for (const ch of channels) {
      const r = await sendTestNotification(ch.type as "EMAIL" | "WHATSAPP" | "TELEGRAM" | "SLACK");
      results.push({ channel: ch.type, ...r });
    }
    await audit({ action: "NOTIFICATION_SENT", detail: "Test notification issued" });
    return ok({ notificationId: result.id, deliveryStatus: result.deliveryStatus, channelResults: results });
  } catch (e) {
    return structuredError(e);
  }
}
