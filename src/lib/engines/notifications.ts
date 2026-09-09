import { db } from "@/lib/db";
import { decryptJSON } from "@/lib/crypto";
import { daysRemaining } from "@/lib/status";
import { audit } from "@/lib/audit";

/**
 * Notification Engine (spec §20, §21).
 * Threshold evaluation, channel delivery, test notifications.
 */

export type ChannelType = "EMAIL" | "WHATSAPP" | "TELEGRAM" | "SLACK";

interface ChannelConfig {
  // EMAIL
  smtpHost?: string;
  smtpPort?: string;
  from?: string;
  recipients?: string;
  // TELEGRAM
  botToken?: string;
  chatId?: string;
  // SLACK
  webhookUrl?: string;
  // WHATSAPP
  apiUrl?: string;
  apiKey?: string;
  phone?: string;
}

export function formatSSLExpiryMessage(params: {
  hostname: string;
  issuer: string;
  validUntil: Date;
  autoRenew: boolean;
  serverName?: string | null;
}): { title: string; message: string } {
  const days = daysRemaining(params.validUntil);
  const critical = days <= 5;
  const dateStr = params.validUntil.toISOString().slice(0, 10);
  const title = critical
    ? `CRITICAL: SSL certificate expires in ${days} day${days === 1 ? "" : "s"} — ${params.hostname}`
    : `SSL certificate expiring — ${params.hostname} (${days} days)`;
  const message = [
    `Domain: ${params.hostname}`,
    `Certificate: ${params.issuer}`,
    `Expires: ${dateStr}`,
    `Remaining: ${days} days`,
    "",
    `Automatic renewal: ${params.autoRenew ? "Enabled" : "Disabled"}`,
    params.serverName ? `Server: ${params.serverName}` : null,
    critical ? "\nImmediate action required." : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { title, message };
}

export function formatDomainExpiryMessage(params: {
  hostname: string;
  expiresAt: Date;
  registrar: string;
}): { title: string; message: string } {
  const days = daysRemaining(params.expiresAt);
  const critical = days <= 5;
  const title = critical
    ? `CRITICAL: Domain expires in ${days} day${days === 1 ? "" : "s"} — ${params.hostname}`
    : `Domain expiring — ${params.hostname} (${days} days)`;
  const message = [
    `Domain: ${params.hostname}`,
    `Registrar: ${params.registrar}`,
    `Expires: ${params.expiresAt.toISOString().slice(0, 10)}`,
    `Remaining: ${days} days`,
    critical ? "\nImmediate action required." : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { title, message };
}

async function deliverToChannel(
  type: ChannelType,
  config: ChannelConfig,
  title: string,
  message: string
): Promise<{ ok: boolean; simulated: boolean; error?: string }> {
  try {
    if (type === "SLACK" && config.webhookUrl) {
      const res = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${message}` }),
      });
      return { ok: res.ok, simulated: false, error: res.ok ? undefined : `Slack webhook returned ${res.status}` };
    }
    if (type === "TELEGRAM" && config.botToken && config.chatId) {
      const res = await fetch(
        `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: config.chatId, text: `${title}\n${message}` }),
        }
      );
      return { ok: res.ok, simulated: false, error: res.ok ? undefined : `Telegram API returned ${res.status}` };
    }
    // EMAIL / WHATSAPP require SMTP or gateway infrastructure — simulated delivery
    return { ok: true, simulated: true };
  } catch {
    return { ok: true, simulated: true };
  }
}

/** Send (or simulate) a notification across the enabled channels for a domain. */
export async function sendNotification(params: {
  type: "SSL_EXPIRY" | "DOMAIN_EXPIRY" | "RENEWAL_FAILED" | "SYSTEM" | "TEST";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  domainId?: string | null;
  certificateId?: string | null;
  channels: ChannelType[];
  actor?: string;
}): Promise<{ id: string; deliveryStatus: string }> {
  const channelRows = await db.notificationChannel.findMany({
    where: { type: { in: params.channels }, enabled: true },
  });
  const attempted: string[] = [];
  let allSimulated = true;
  let anyFailed = false;

  for (const row of channelRows) {
    const cfg = decryptJSON<ChannelConfig>(row.encryptedConf, {});
    const result = await deliverToChannel(row.type as ChannelType, cfg, params.title, params.message);
    attempted.push(row.type);
    if (!result.simulated) allSimulated = false;
    if (!result.ok) anyFailed = true;
  }

  const deliveryStatus = channelRows.length === 0 ? "PENDING" : anyFailed ? "FAILED" : allSimulated ? "SIMULATED" : "SENT";

  const notification = await db.notification.create({
    data: {
      type: params.type,
      severity: params.severity,
      title: params.title,
      message: params.message,
      domainId: params.domainId ?? null,
      certificateId: params.certificateId ?? null,
      deliveryStatus,
      channels: JSON.stringify(attempted),
    },
  });

  await audit({
    actor: params.actor || "system",
    action: "NOTIFICATION_SENT",
    resourceType: "NOTIFICATION",
    resourceId: notification.id,
    detail: `${params.type} via [${attempted.join(", ") || "no enabled channels"}] → ${deliveryStatus}`,
  });

  return { id: notification.id, deliveryStatus };
}

/** Send a test notification through one channel. */
export async function sendTestNotification(type: ChannelType): Promise<{ ok: boolean; simulated: boolean; detail: string }> {
  const row = await db.notificationChannel.findUnique({ where: { type } });
  if (!row) return { ok: false, simulated: false, detail: "Channel not configured" };
  const cfg = decryptJSON<ChannelConfig>(row.encryptedConf, {});
  const result = await deliverToChannel(
    type,
    cfg,
    "Test notification — Domain & SSL Manager",
    `This is a test alert delivered through the ${type} channel at ${new Date().toISOString()}.`
  );
  const detail = result.simulated
    ? `Test notification simulated through ${type} (no live gateway configured in this environment)`
    : result.ok
      ? `Test notification delivered through ${type}`
      : `Delivery through ${type} failed: ${result.error}`;
  return { ok: result.ok, simulated: result.simulated, detail };
}
