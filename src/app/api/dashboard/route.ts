import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ok, structuredError } from "@/lib/api-helpers";
import { daysRemaining } from "@/lib/status";
import { startScheduler } from "@/lib/jobs/scheduler";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAuth();
    startScheduler(); // idempotent — ensures automation is running

    const [domains, certificates, servers, notifications, jobs] = await Promise.all([
      db.domain.findMany({
        include: {
          server: { select: { id: true, name: true, status: true, webServer: true } },
          certificates: { where: { status: { not: "REVOKED" } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.certificate.findMany({ where: { status: { not: "REVOKED" } } }),
      db.server.findMany(),
      db.notification.findMany({ where: { read: false }, orderBy: { createdAt: "desc" } }),
      db.automationJob.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    ]);

    const sslDays = (d: (typeof domains)[number]) =>
      d.certificates[0] ? daysRemaining(d.certificates[0].validUntil) : null;
    const domainDays = (d: (typeof domains)[number]) =>
      d.expiresAt ? daysRemaining(d.expiresAt) : null;

    const metrics = {
      totalDomains: domains.length,
      certificates: certificates.length,
      servers: servers.filter((s) => s.status === "ONLINE").length,
      serversTotal: servers.length,
      pendingNotifications: notifications.length,
      expiringSoon: domains.filter((d) => {
        const s = sslDays(d);
        const dd = domainDays(d);
        return (s !== null && s > 0 && s <= 30) || (dd !== null && dd > 0 && dd <= 30);
      }).length,
      expired: domains.filter((d) => {
        const s = sslDays(d);
        const dd = domainDays(d);
        return (s !== null && s <= 0) || (dd !== null && dd <= 0);
      }).length,
      sslErrors: domains.filter((d) =>
        d.certificates[0] &&
        ["HOSTNAME_MISMATCH", "INVALID_CHAIN", "DEPLOY_FAILED"].includes(d.certificates[0].status)
      ).length,
      verified: domains.filter((d) => d.verificationStatus === "VERIFIED").length,
      unverified: domains.filter((d) => d.verificationStatus !== "VERIFIED").length,
    };

    // Donut chart distribution
    const donut = { healthy: 0, expiring: 0, expired: 0, sslError: 0, unverified: 0 };
    for (const d of domains) {
      if (d.verificationStatus !== "VERIFIED" && !["EXPIRED", "CRITICAL", "SSL_ERROR"].includes(d.status)) donut.unverified++;
      else if (d.status === "SSL_ERROR") donut.sslError++;
      else if (d.status === "EXPIRED" || sslDays(d) !== null && sslDays(d)! <= 0 || domainDays(d) !== null && domainDays(d)! <= 0) donut.expired++;
      else if (d.status === "HEALTHY" || d.status === "VERIFIED") donut.healthy++;
      else donut.expiring++;
    }

    const overview = domains.slice(0, 10).map((d) => ({
      id: d.id,
      hostname: d.hostname,
      environment: d.environment,
      sslExpiry: d.certificates[0]?.validUntil?.toISOString() || null,
      sslDays: sslDays(d),
      domainExpiry: d.expiresAt?.toISOString() || null,
      domainDays: domainDays(d),
      status: d.status,
      verificationStatus: d.verificationStatus,
      autoRenew: d.autoRenew,
      autoInstall: d.autoInstall,
      server: d.server,
    }));

    const recentJobs = jobs.map((j) => ({
      id: j.id,
      type: j.type,
      title: j.title,
      status: j.status,
      createdAt: j.createdAt.toISOString(),
      durationMs: j.durationMs,
    }));

    const unreadNotifications = notifications.slice(0, 8).map((n) => ({
      id: n.id,
      type: n.type,
      severity: n.severity,
      title: n.title,
      createdAt: n.createdAt.toISOString(),
      deliveryStatus: n.deliveryStatus,
    }));

    return ok({ metrics, donut, overview, recentJobs, unreadNotifications });
  } catch (e) {
    return structuredError(e);
  }
}
