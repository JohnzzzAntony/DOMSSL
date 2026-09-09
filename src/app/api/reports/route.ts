import { db } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, structuredError } from "@/lib/api-helpers";
import { daysRemaining } from "@/lib/status";

export const dynamic = "force-dynamic";

type ReportKey = "domain-expiry" | "ssl-expiry" | "failed-renewals" | "server-health" | "automation-success" | "notification-history";

export async function GET(req: Request) {
  try {
    await requireAuth();
    const url = new URL(req.url);
    const report = (url.searchParams.get("report") || "ssl-expiry") as ReportKey;
    const format = url.searchParams.get("format");

    const domains = await db.domain.findMany({
      include: {
        certificates: { where: { status: { not: "REVOKED" } }, orderBy: { createdAt: "desc" }, take: 1 },
        server: { select: { name: true } },
      },
      orderBy: { hostname: "asc" },
    });

    let rows: Array<Record<string, string | number>> = [];
    let title = "";

    if (report === "domain-expiry") {
      title = "Domain Expiry Report";
      rows = domains.map((d) => ({
        Domain: d.hostname,
        Environment: d.environment,
        Registrar: d.registrar,
        "Stored Expiry": d.expiresAt?.toISOString().slice(0, 10) || "—",
        "Verified Expiry": d.verifiedExpiresAt?.toISOString().slice(0, 10) || "—",
        "Days Remaining": d.expiresAt ? daysRemaining(d.expiresAt) : "—",
        Verification: d.verificationStatus,
        Status: d.status,
      }));
    } else if (report === "ssl-expiry") {
      title = "SSL Expiry Report";
      rows = domains
        .filter((d) => d.certificates[0])
        .map((d) => {
          const c = d.certificates[0]!;
          return {
            Domain: d.hostname,
            Issuer: c.issuer,
            "Valid From": c.validFrom.toISOString().slice(0, 10),
            Expires: c.validUntil.toISOString().slice(0, 10),
            "Days Remaining": daysRemaining(c.validUntil),
            Status: c.status,
            "Auto Renew": c.autoRenew ? "ON" : "OFF",
            Server: d.server?.name || "—",
          };
        });
    } else if (report === "failed-renewals") {
      title = "Failed Renewals Report";
      const failedJobs = await db.automationJob.findMany({
        where: { type: { in: ["SSL_RENEWAL", "SSL_INSTALLATION", "SSL_REQUEST"] }, status: { in: ["FAILED", "ROLLED_BACK"] } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { domain: { select: { hostname: true } } },
      });
      rows = failedJobs.map((j) => ({
        Date: j.createdAt.toISOString().slice(0, 16).replace("T", " "),
        Domain: j.domain?.hostname || "—",
        Type: j.type,
        Status: j.status,
        Error: j.error || "—",
        "Duration (ms)": j.durationMs ?? "—",
      }));
    } else if (report === "server-health") {
      title = "Server Health Report";
      const servers = await db.server.findMany({ include: { _count: { select: { domains: true, deployments: true } } } });
      rows = servers.map((s) => ({
        Server: s.name,
        Host: `${s.host}:${s.port}`,
        Status: s.status,
        "Web Server": s.webServer,
        OS: s.operatingSystem,
        Domains: s._count.domains,
        Deployments: s._count.deployments,
        "Last Check": s.lastHealthCheck?.toISOString().slice(0, 16).replace("T", " ") || "—",
      }));
    } else if (report === "automation-success") {
      title = "Automation Success Rate Report";
      const jobs = await db.automationJob.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
      const byType: Record<string, { total: number; success: number; failed: number; rolled: number }> = {};
      for (const j of jobs) {
        byType[j.type] = byType[j.type] || { total: 0, success: 0, failed: 0, rolled: 0 };
        byType[j.type].total++;
        if (j.status === "SUCCESS") byType[j.type].success++;
        else if (j.status === "FAILED") byType[j.type].failed++;
        else if (j.status === "ROLLED_BACK") byType[j.type].rolled++;
      }
      rows = Object.entries(byType).map(([type, v]) => ({
        "Job Type": type,
        Total: v.total,
        Success: v.success,
        Failed: v.failed,
        "Rolled Back": v.rolled,
        "Success Rate": v.total ? `${Math.round((v.success / v.total) * 100)}%` : "—",
      }));
    } else if (report === "notification-history") {
      title = "Notification History Report";
      const notifications = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
      rows = notifications.map((n) => ({
        Date: n.createdAt.toISOString().slice(0, 16).replace("T", " "),
        Type: n.type,
        Severity: n.severity,
        Title: n.title,
        Delivery: n.deliveryStatus,
        Channels: JSON.parse(n.channels || "[]").join(" "),
      }));
    }

    // CSV export
    if (format === "csv") {
      const user = await requirePermission("notifications.manage").catch(() => null);
      await audit({
        actor: user?.email || "viewer",
        action: "SETTINGS_UPDATED",
        detail: `Exported ${title} as CSV`,
      }).catch(() => {});
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${report}-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    return ok({ title, rows, generatedAt: new Date().toISOString() });
  } catch (e) {
    return structuredError(e);
  }
}
