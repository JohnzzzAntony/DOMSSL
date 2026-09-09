import { db } from "@/lib/db";
import { queueDailyChecks, createJob } from "@/lib/jobs/engine";

/**
 * In-process scheduler (spec §36, §38):
 * - Daily: domain checks, SSL checks, expiry calc, notifications, eligible renewals
 * - Server health: every 10 minutes
 *
 * The scheduler is idempotent (guards against overlapping runs) and uses a
 * DB-backed watermark so a restart does not re-run the same day's batch.
 * For multi-instance production deployments, swap `setInterval` for a
 * BullMQ repeatable job backed by Redis.
 */

let started = false;

const SERVER_HEALTH_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes (spec: 5–15)
const TICK_MS = 60 * 1000;

async function runDailyBatch(): Promise<void> {
  const key = "scheduler.lastDailyRun";
  const last = await db.setting.findUnique({ where: { key } });
  const now = new Date();
  const lastRun = last ? new Date(JSON.parse(last.value)) : null;
  // Run once per day (spec §36) — or immediately on first boot
  if (lastRun && now.getTime() - lastRun.getTime() < 20 * 3600 * 1000) return;
  await db.setting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(now.toISOString()) },
    update: { key, value: JSON.stringify(now.toISOString()) },
  });
  console.log("[scheduler] queueing daily domain + SSL checks…");
  const result = await queueDailyChecks();
  console.log(`[scheduler] daily batch queued: ${result.domains} domains, ${result.certs} certificates`);
}

async function runServerHealth(): Promise<void> {
  const servers = await db.server.findMany();
  for (const server of servers) {
    const stale =
      !server.lastHealthCheck ||
      Date.now() - server.lastHealthCheck.getTime() > SERVER_HEALTH_INTERVAL_MS - 60000;
    if (!stale) continue;
    await createJob({
      type: "SERVER_HEALTH",
      title: `Server Health — ${server.name}`,
      serverId: server.id,
      steps: ["SSH handshake", "Web server process check"],
    });
  }
}

let dailyTimer: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (started) return;
  started = true;
  // Initial run after boot (give the DB a moment)
  setTimeout(() => {
    runDailyBatch().catch((e) => console.error("[scheduler] daily batch error", e));
    runServerHealth().catch((e) => console.error("[scheduler] health error", e));
  }, 3000);
  // Ticker
  dailyTimer = setInterval(() => {
    runDailyBatch().catch(() => {});
    runServerHealth().catch(() => {});
  }, TICK_MS);
  console.log("[scheduler] started — daily checks + server health every 10 min");
}

export function stopScheduler(): void {
  if (dailyTimer) clearInterval(dailyTimer);
  started = false;
}
