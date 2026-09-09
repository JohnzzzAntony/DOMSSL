import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

/** GET /api/health — system health indicators (spec §55). */
export async function GET() {
  try {
    await requireAuth();
    const checks: Array<{ name: string; status: "OK" | "WARN" | "ERROR"; detail: string }> = [];

    // Database
    try {
      await db.$queryRaw`SELECT 1`;
      checks.push({ name: "PostgreSQL / SQLite", status: "OK", detail: "Database responsive" });
    } catch {
      checks.push({ name: "PostgreSQL / SQLite", status: "ERROR", detail: "Database unreachable" });
    }

    // Worker (in-process job engine) — inspect recent job activity
    const recentJob = await db.automationJob.findFirst({ orderBy: { createdAt: "desc" } });
    checks.push({
      name: "Worker",
      status: recentJob ? "OK" : "WARN",
      detail: recentJob ? `Last job: ${recentJob.type} at ${recentJob.createdAt.toISOString().slice(11, 19)}` : "No jobs recorded yet",
    });

    // Scheduler
    const lastRun = await db.setting.findUnique({ where: { key: "scheduler.lastDailyRun" } });
    checks.push({
      name: "Scheduler",
      status: lastRun ? "OK" : "WARN",
      detail: lastRun ? `Daily batch last ran ${JSON.parse(lastRun.value).slice(0, 19).replace("T", " ")}` : "Awaiting first scheduled run",
    });

    // Integrations
    const integrations = await db.integration.findMany();
    for (const i of integrations) {
      checks.push({
        name: i.name,
        status: i.status === "CONNECTED" ? "OK" : "WARN",
        detail: i.status === "CONNECTED" ? "Connected" : "Not connected",
      });
    }

    // Notification channels
    const channels = await db.notificationChannel.findMany({ where: { enabled: true } });
    if (channels.length === 0) {
      checks.push({ name: "Notifications", status: "WARN", detail: "No enabled channels" });
    } else {
      checks.push({ name: "Notifications", status: "OK", detail: `${channels.length} enabled channel(s)` });
    }

    // DNS / server connections
    const dns = await db.dNSProvider.findFirst();
    checks.push({
      name: "DNS APIs",
      status: dns?.status === "CONNECTED" ? "OK" : "WARN",
      detail: dns ? `${dns.name}: ${dns.status}` : "No DNS provider configured",
    });
    const serversOnline = await db.server.count({ where: { status: "ONLINE" } });
    const serversTotal = await db.server.count();
    checks.push({
      name: "Server connections",
      status: serversTotal === 0 ? "WARN" : serversOnline > 0 ? "OK" : "ERROR",
      detail: `${serversOnline}/${serversTotal} servers online`,
    });

    return ok({ checks, checkedAt: new Date().toISOString() });
  } catch (e) {
    return structuredError(e);
  }
}
