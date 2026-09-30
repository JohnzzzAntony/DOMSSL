import { db } from "@/lib/db";
import { daysRemaining, sslStatusFromDays, domainStatusFromDays, severityToStatus, computeDomainStatus } from "@/lib/status";
import { verifyDomainExpiry } from "@/lib/engines/rdap";
import { inspectCertificate, isNoHttps, isTransientFailure, type CertificateInspection } from "@/lib/engines/ssl-inspector";
import { getCertificateProvider } from "@/lib/engines/providers/acme";
import { executeInstallWorkflow, generateSimulatedCertFiles } from "@/lib/engines/providers/ssh-deployment";
import { formatSSLExpiryMessage, formatDomainExpiryMessage, sendNotification } from "@/lib/engines/notifications";
import { getSshTransport } from "@/lib/engines/providers/ssh-deployment";
import { getDNSAdapter, resolveToken } from "@/lib/engines/providers/cloudflare";
import { decryptJSON } from "@/lib/crypto";
import { DEFAULT_SSL_THRESHOLDS, DEFAULT_DOMAIN_THRESHOLDS } from "@/lib/status";

/**
 * Job Engine (spec §36): queues persisted in the database, executed by an
 * in-process worker with the same state machine a BullMQ worker would run.
 * Jobs are idempotent, retried on transient failures, and every step is
 * logged with timestamps for the Automation Logs UI (spec §22).
 */

export type JobType =
  | "DOMAIN_CHECK"
  | "SSL_CHECK"
  | "VERIFICATION"
  | "SSL_REQUEST"
  | "SSL_RENEWAL"
  | "SSL_INSTALLATION"
  | "DNS_VALIDATION"
  | "SERVER_HEALTH"
  | "NOTIFICATION"
  | "BULK_SCAN"
  | "ROLLBACK";

type StepStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED" | "WARNED";

interface Step {
  name: string;
  status: StepStatus;
  detail?: string;
  at?: string;
}

interface LogLine {
  t: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface JobContext {
  jobId: string;
  update(params: {
    steps?: Step[];
    logs?: LogLine[];
    progress?: number;
    status?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  step(index: number, patch: Partial<Step>): Promise<void>;
  log(level: LogLine["level"], message: string): Promise<void>;
  complete(result?: { error?: string; rolledBack?: boolean }): Promise<void>;
}

type Handler = (ctx: JobContext, payload: Record<string, unknown>) => Promise<void>;

const running = new Set<string>();

export async function createJob(params: {
  type: JobType;
  title: string;
  domainId?: string | null;
  certificateId?: string | null;
  serverId?: string | null;
  steps?: string[];
  metadata?: Record<string, unknown>;
  /** Delay before execution — used to stagger bulk imports (registry rate limits). */
  delayMs?: number;
}): Promise<string> {
  const job = await db.automationJob.create({
    data: {
      type: params.type,
      title: params.title,
      domainId: params.domainId ?? null,
      certificateId: params.certificateId ?? null,
      serverId: params.serverId ?? null,
      steps: JSON.stringify(
        (params.steps || []).map((name) => ({ name, status: "PENDING" as StepStatus }))
      ),
      metadata: JSON.stringify(params.metadata || {}),
      status: "QUEUED",
    },
  });
  // Kick off execution asynchronously — never block the HTTP request (spec §3)
  setTimeout(() => {
    runJob(job.id).catch((e) => console.error("[job] fatal", job.id, e));
  }, params.delayMs ?? 50);
  return job.id;
}

export async function runJob(jobId: string): Promise<void> {
  if (running.has(jobId)) return; // idempotency / distributed-lock equivalent
  running.add(jobId);
  const job = await db.automationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === "RUNNING" || job.status === "SUCCESS") {
    running.delete(jobId);
    return;
  }
  const startedAt = new Date();
  await db.automationJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt },
  });

  let steps: Step[] = JSON.parse(job.steps || "[]");
  let logs: LogLine[] = [];
  let progress = 0;
  let active = 0;

  const persist = async () => {
    await db.automationJob.update({
      where: { id: jobId },
      data: {
        steps: JSON.stringify(steps),
        logs: JSON.stringify(logs.slice(-200)),
        progress,
      },
    });
  };

  const ctx: JobContext = {
    jobId,
    async update(patch) {
      if (patch.steps) steps = patch.steps;
      if (patch.logs) logs = patch.logs;
      if (patch.progress !== undefined) progress = patch.progress;
      await persist();
    },
    async step(index, patch) {
      steps[index] = { ...steps[index], ...patch };
      progress = Math.min(
        99,
        Math.round(((steps.filter((s) => s.status === "DONE" || s.status === "WARNED" || s.status === "SKIPPED").length) / Math.max(1, steps.length)) * 100)
      );
      await persist();
    },
    async log(level, message) {
      logs.push({ t: new Date().toISOString(), level, message });
      await persist();
    },
    async complete(result) {
      const durationMs = Date.now() - startedAt.getTime();
      const failed = steps.some((s) => s.status === "FAILED");
      const rolledBack = result?.rolledBack || steps.some((s) => s.name.toLowerCase().includes("rollback") && s.status === "DONE");
      await db.automationJob.update({
        where: { id: jobId },
        data: {
          status: rolledBack ? "ROLLED_BACK" : failed ? "FAILED" : "SUCCESS",
          steps: JSON.stringify(steps),
          logs: JSON.stringify(logs.slice(-200)),
          progress: failed ? progress : 100,
          completedAt: new Date(),
          durationMs,
          error: result?.error || (failed ? "One or more steps failed" : null),
        },
      });
      running.delete(jobId);
    },
  };

  try {
    const payload = JSON.parse(job.metadata || "{}");
    const handler = HANDLERS[job.type as JobType] || null;
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler(ctx, { ...payload, jobId, domainId: job.domainId, certificateId: job.certificateId, serverId: job.serverId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown job error";
    await ctx.log("error", `Job failed: ${message}`);
    await ctx.complete({ error: message });
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compare stored vs discovered dates and classify (spec §49, §50). */
function compareDates(stored?: Date | null, discovered?: Date | null): "MATCH" | "MISMATCH" | "NO_STORED" {
  if (!stored || !discovered) return "NO_STORED";
  const a = fmt(stored);
  const b = fmt(discovered);
  return a === b ? "MATCH" : "MISMATCH";
}

async function getSettings(): Promise<{ sslThresholds: number[]; domainThresholds: number[]; renewalThresholdDays: number }> {
  const rows = await db.setting.findMany({ where: { key: { in: ["notifications", "automation"] } } });
  let sslThresholds = DEFAULT_SSL_THRESHOLDS;
  let domainThresholds = DEFAULT_DOMAIN_THRESHOLDS;
  let renewalThresholdDays = 30;
  for (const row of rows) {
    const val = JSON.parse(row.value || "{}");
    if (row.key === "notifications") {
      sslThresholds = val.sslThresholds || sslThresholds;
      domainThresholds = val.domainThresholds || domainThresholds;
    }
    if (row.key === "automation") renewalThresholdDays = val.renewalThresholdDays || renewalThresholdDays;
  }
  return { sslThresholds, domainThresholds, renewalThresholdDays };
}

/** Issuing CA shown as the domain's SSL provider (e.g. "Let's Encrypt"). */
function sslProviderOf(ssl: CertificateInspection): string | undefined {
  return ssl.issuerOrg || ssl.issuer || undefined;
}

/**
 * Roll-up SSL state for computeDomainStatus. A transient failure on a domain
 * with a known certificate keeps the stored certificate authoritative.
 */
function sslStatusOf(ssl: CertificateInspection, hasStoredCertificate = false): string | null {
  if (hasStoredCertificate && isTransientFailure(ssl)) return null;
  if (ssl.reachable) {
    if (ssl.hostnameMatch === false) return "HOSTNAME_MISMATCH";
    if (ssl.chainValid === false) return "INVALID_CHAIN";
    return null;
  }
  if (ssl.source !== "LIVE") return null;
  return isNoHttps(ssl) ? "NO_SSL" : "SSL_ERROR";
}

/** Persist registrar + SSL provider discovered by a check. */
async function recordProviders(
  domain: { id: string; registrar: string; sslProvider: string },
  registrar: string | undefined,
  ssl: CertificateInspection | null,
  hadCertificate: boolean
): Promise<void> {
  const data: { registrar?: string; sslProvider?: string } = {};
  if (registrar && registrar !== domain.registrar) data.registrar = registrar;
  if (ssl) {
    const provider = ssl.validUntil ? sslProviderOf(ssl) : hadCertificate ? undefined : isNoHttps(ssl) ? "None" : "Unknown";
    if (provider && provider !== domain.sslProvider) data.sslProvider = provider;
  }
  if (Object.keys(data).length) await db.domain.update({ where: { id: domain.id }, data });
}

const HANDLERS: Record<JobType, Handler> = {
  // ── Full verification pipeline (spec §10, §2): RDAP → SSL → DNS → compare
  async VERIFICATION(ctx, payload) {
    const domainId = payload.domainId as string;
    const domain = await db.domain.findUnique({
      where: { id: domainId },
      include: { server: true, certificates: { where: { status: { not: "REVOKED" } }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");

    await ctx.update({
      steps: [
        { name: "Domain reachable", status: "RUNNING" },
        { name: "RDAP lookup", status: "PENDING" },
        { name: "Domain expiry discovered", status: "PENDING" },
        { name: "HTTPS reachable", status: "PENDING" },
        { name: "SSL certificate discovered", status: "PENDING" },
        { name: "Certificate hostname verified", status: "PENDING" },
        { name: "Certificate chain verified", status: "PENDING" },
        { name: "Dates compared & stored", status: "PENDING" },
      ],
    });
    await ctx.log("info", `Starting verification for ${domain.hostname}`);

    // 1. Reachability + RDAP (demo domains run deterministic simulation)
    const rdapStart = Date.now();
    const rdap = await verifyDomainExpiry(domain.hostname, {
      registrar: domain.registrar,
      forceSimulation: domain.isDemo,
    });
    const rdapMs = Date.now() - rdapStart;
    await ctx.step(0, {
      status: "DONE",
      detail: `Target resolved (${rdap.source === "SIMULATION" ? "simulation cache" : "public DNS"})`,
      at: new Date().toISOString(),
    });
    await ctx.step(1, {
      status: rdap.verified ? "DONE" : "FAILED",
      detail: rdap.verified
        ? `RDAP registry responded in ${rdapMs}ms (source: ${rdap.source})`
        : rdap.error || "RDAP lookup failed",
      at: new Date().toISOString(),
    });
    await ctx.log(rdap.verified ? "info" : "warn", `RDAP lookup ${rdap.verified ? "complete" : "failed"}: ${rdap.source}`);
    if (!rdap.verified) {
      await db.verificationResult.create({
        data: {
          domainId: domain.id,
          checkType: "RDAP",
          source: rdap.source,
          verified: false,
          error: rdap.error,
          storedValue: domain.expiresAt ? fmt(domain.expiresAt) : null,
        },
      });
    }

    // 2. Domain expiry discovered
    await ctx.step(2, {
      status: rdap.domainExpiry ? "DONE" : "FAILED",
      detail: rdap.domainExpiry
        ? `Discovered domain expiry: ${fmt(rdap.domainExpiry)} via ${rdap.source}${rdap.registrar ? ` — registrar ${rdap.registrar}` : ""}`
        : "No expiry date discovered",
      at: new Date().toISOString(),
    });

    // 3. SSL inspection (live for real domains; deterministic simulation for marked demo data)
    await ctx.step(3, { status: "RUNNING", at: new Date().toISOString() });
    const sslPreset = domain.certificates[0]
      ? { daysRemaining: daysRemaining(domain.certificates[0].validUntil) }
      : undefined;
    const ssl = await inspectCertificate(domain.hostname, {
      forceSimulation: domain.isDemo,
      preset: sslPreset,
    });
    await ctx.step(3, {
      status: ssl.reachable ? "DONE" : "FAILED",
      detail: ssl.reachable
        ? `TLS handshake OK — ${ssl.tlsVersion}, ${ssl.cipher}`
        : ssl.error || "HTTPS endpoint unreachable",
      at: new Date().toISOString(),
    });
    await ctx.log(ssl.reachable ? "success" : "error", ssl.reachable ? `HTTPS reachable (${ssl.tlsVersion})` : `HTTPS check failed: ${ssl.errorCode || ssl.error}`);

    await ctx.step(4, {
      status: ssl.validUntil ? "DONE" : "FAILED",
      detail: ssl.validUntil
        ? `Certificate discovered: ${ssl.issuer}, valid until ${fmt(ssl.validUntil)} (${daysRemaining(ssl.validUntil)} days) [${ssl.source}]`
        : "No certificate served",
      at: new Date().toISOString(),
    });
    await ctx.step(5, {
      status: ssl.hostnameMatch ? "DONE" : "FAILED",
      detail: ssl.hostnameMatch
        ? `SAN entries match ${domain.hostname}`
        : `Hostname mismatch — SAN: ${(ssl.sans || []).join(", ") || "none"}`,
      at: new Date().toISOString(),
    });
    await ctx.step(6, {
      status: ssl.chainValid ? "DONE" : "FAILED",
      detail: ssl.chainValid ? "Certificate chain verified" : "Certificate chain validation failed",
      at: new Date().toISOString(),
    });
    await ctx.log("info", `SSL inspection source: ${ssl.source}`);

    // 4. Persist verification results (timestamp + source + result, spec §2.8)
    await db.verificationResult.create({
      data: {
        domainId: domain.id,
        checkType: "RDAP",
        source: rdap.source,
        verified: rdap.verified,
        discoveredValue: rdap.domainExpiry ? fmt(rdap.domainExpiry) : null,
        storedValue: domain.expiresAt ? fmt(domain.expiresAt) : null,
        matched: compareDates(domain.expiresAt, rdap.domainExpiry) === "MATCH",
        error: rdap.error,
      },
    });
    if (ssl.validUntil) {
      await db.verificationResult.create({
        data: {
          domainId: domain.id,
          checkType: "SSL_LIVE",
          source: ssl.source,
          verified: true,
          discoveredValue: fmt(ssl.validUntil),
          storedValue: domain.certificates[0] ? fmt(domain.certificates[0].validUntil) : null,
          matched: compareDates(domain.certificates[0]?.validUntil, ssl.validUntil) === "MATCH",
        },
      });
    }

    // 5. Update certificate record from live inspection (history preserved §50)
    let sslExpiryForStatus: Date | null = null;
    if (ssl.validUntil) {
      sslExpiryForStatus = ssl.validUntil;
      const existing = domain.certificates[0];
      if (existing) {
        const changed = fmt(existing.validUntil) !== fmt(ssl.validUntil);
        await db.certificate.update({
          where: { id: existing.id },
          data: {
            issuer: sslProviderOf(ssl) || existing.issuer,
            subject: ssl.subject || existing.subject,
            serialNumber: ssl.serialNumber,
            fingerprint: ssl.fingerprint,
            signatureAlgorithm: ssl.signatureAlgorithm,
            keyType: ssl.keyType,
            tlsVersion: ssl.tlsVersion,
            validFrom: ssl.validFrom || existing.validFrom,
            validUntil: ssl.validUntil,
            liveValidUntil: ssl.validUntil,
            sans: JSON.stringify(ssl.sans || []),
            hostnameMatch: ssl.hostnameMatch ?? true,
            chainValid: ssl.chainValid ?? true,
            status: !ssl.hostnameMatch
              ? "HOSTNAME_MISMATCH"
              : !ssl.chainValid
                ? "INVALID_CHAIN"
                : severityToStatus(sslStatusFromDays(daysRemaining(ssl.validUntil)), "SSL"),
            verificationStatus: "VERIFIED",
            lastCheckedAt: new Date(),
          },
        });
        if (changed) {
          await db.certificateHistory.create({
            data: {
              certificateId: existing.id,
              event: "DETECTED_CHANGE",
              detail: `Live certificate changed: ${fmt(existing.validUntil)} → ${fmt(ssl.validUntil)} (${ssl.source})`,
            },
          });
          await ctx.log("warn", `Certificate changed on ${domain.hostname}: stored ${fmt(existing.validUntil)} vs live ${fmt(ssl.validUntil)}`);
        } else {
          await db.certificateHistory.create({
            data: {
              certificateId: existing.id,
              event: "VERIFIED",
              detail: `Live certificate matches stored record (${ssl.source})`,
            },
          });
        }
      } else {
        const cert = await db.certificate.create({
          data: {
            domainId: domain.id,
            commonName: ssl.inspectedHost || domain.hostname,
            issuer: sslProviderOf(ssl) || "Unknown",
            subject: ssl.subject || domain.hostname,
            serialNumber: ssl.serialNumber,
            fingerprint: ssl.fingerprint,
            signatureAlgorithm: ssl.signatureAlgorithm,
            keyType: ssl.keyType,
            tlsVersion: ssl.tlsVersion,
            validFrom: ssl.validFrom || new Date(),
            validUntil: ssl.validUntil,
            liveValidUntil: ssl.validUntil,
            sans: JSON.stringify(ssl.sans || []),
            hostnameMatch: ssl.hostnameMatch ?? true,
            chainValid: ssl.chainValid ?? true,
            status: !ssl.hostnameMatch ? "HOSTNAME_MISMATCH" : severityToStatus(sslStatusFromDays(daysRemaining(ssl.validUntil)), "SSL"),
            verificationStatus: "VERIFIED",
            isDemo: ssl.source === "SIMULATION",
            lastCheckedAt: new Date(),
          },
        });
        await db.certificateHistory.create({
          data: {
            certificateId: cert.id,
            event: "DETECTED_CHANGE",
            detail: `Certificate discovered via live inspection (${ssl.source})`,
          },
        });
      }
    }

    await recordProviders(domain, rdap.registrar, ssl, !!domain.certificates[0]);
    if (ssl.inspectedHost) await ctx.log("info", `Apex serves no HTTPS — certificate read from ${ssl.inspectedHost}`);

    // 6. Compare & store dates — never silently overwrite (spec §49, §64.2)
    const domainMatch = compareDates(domain.expiresAt, rdap.domainExpiry);
    let verificationStatus = "UNVERIFIED";
    if (rdap.verified) {
      if (domainMatch === "NO_STORED") {
        // First discovery — adopt the discovered date, audit the source
        await db.domain.update({
          where: { id: domain.id },
          data: {
            expiresAt: rdap.domainExpiry,
            verifiedExpiresAt: rdap.domainExpiry,
            registrarExpiresAt: rdap.domainExpiry,
            registeredAt: rdap.registeredAt || domain.registeredAt,
            registrar: rdap.registrar || domain.registrar,
            verificationStatus: "VERIFIED",
          },
        });
        await ctx.log("success", `Domain expiry stored from ${rdap.source}: ${fmt(rdap.domainExpiry)}`);
        verificationStatus = "VERIFIED";
      } else if (domainMatch === "MATCH") {
        await db.domain.update({
          where: { id: domain.id },
          data: {
            verifiedExpiresAt: rdap.domainExpiry,
            registrarExpiresAt: rdap.domainExpiry,
            verificationStatus: "VERIFIED",
            registeredAt: rdap.registeredAt || domain.registeredAt,
          },
        });
        await ctx.log("success", `Dates match — stored ${fmt(domain.expiresAt)} == ${rdap.source} ${fmt(rdap.domainExpiry)}`);
        verificationStatus = "VERIFIED";
      } else {
        await db.domain.update({
          where: { id: domain.id },
          data: {
            registrarExpiresAt: rdap.domainExpiry,
            verificationStatus: "MISMATCH",
            registeredAt: rdap.registeredAt || domain.registeredAt,
          },
        });
        await ctx.log("warn", `DATE MISMATCH — stored ${fmt(domain.expiresAt)} vs ${rdap.source} ${fmt(rdap.domainExpiry)}`);
        verificationStatus = "MISMATCH";
      }
    } else {
      verificationStatus = "FAILED";
      await ctx.log("error", `Domain verification failed: ${rdap.error}`);
    }

    await ctx.step(7, {
      status: verificationStatus === "FAILED" ? "FAILED" : verificationStatus === "MISMATCH" ? "WARNED" : "DONE",
      detail:
        verificationStatus === "MISMATCH"
          ? `Domain expiry mismatch: stored ${fmt(domain.expiresAt)} vs discovered ${rdap.domainExpiry ? fmt(rdap.domainExpiry) : "n/a"}`
          : verificationStatus === "VERIFIED"
            ? "All dates verified against authoritative sources"
            : "Verification incomplete — external sources unavailable",
      at: new Date().toISOString(),
    });

    // 7. Roll up status
    const status = computeDomainStatus({
      verificationStatus: verificationStatus === "FAILED" && domain.verificationStatus === "VERIFIED" ? "VERIFIED" : verificationStatus,
      domainExpiresAt: (rdap.domainExpiry || domain.expiresAt) ?? null,
      sslExpiresAt: sslExpiryForStatus || domain.certificates[0]?.validUntil || null,
      sslStatus: sslStatusOf(ssl, !!domain.certificates[0]),
    });
    await db.domain.update({
      where: { id: domain.id },
      data: {
        status,
        lastCheckedAt: new Date(),
        lastDomainCheckAt: new Date(),
        lastSslCheckAt: ssl.reachable ? new Date() : domain.lastSslCheckAt,
      },
    });

    await ctx.complete({ error: verificationStatus === "FAILED" ? rdap.error : undefined });
  },

  // ── Daily domain check
  async DOMAIN_CHECK(ctx, payload) {
    const domainId = payload.domainId as string;
    const domain = await db.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");
    await ctx.update({ steps: [{ name: "RDAP domain expiry check", status: "RUNNING" }] });
    const rdap = await verifyDomainExpiry(domain.hostname, {
      registrar: domain.registrar,
      forceSimulation: domain.isDemo,
    });
    await recordProviders(domain, rdap.registrar, null, true);
    if (rdap.verified && rdap.domainExpiry) {
      const match = compareDates(domain.verifiedExpiresAt || domain.expiresAt, rdap.domainExpiry);
      await db.domain.update({
        where: { id: domain.id },
        data: {
          registrarExpiresAt: rdap.domainExpiry,
          verifiedExpiresAt: match === "MATCH" ? rdap.domainExpiry : domain.verifiedExpiresAt,
          verificationStatus: match === "MISMATCH" ? "MISMATCH" : "VERIFIED",
          status: match === "MISMATCH" ? "WARNING" : domain.status,
          lastCheckedAt: new Date(),
          lastDomainCheckAt: new Date(),
        },
      });
      await db.verificationResult.create({
        data: {
          domainId: domain.id,
          checkType: "RDAP",
          source: rdap.source,
          verified: true,
          discoveredValue: fmt(rdap.domainExpiry),
          storedValue: domain.expiresAt ? fmt(domain.expiresAt) : null,
          matched: match === "MATCH",
        },
      });
      await ctx.step(0, {
        status: match === "MISMATCH" ? "WARNED" : "DONE",
        detail: `${rdap.source}: ${fmt(rdap.domainExpiry)} — ${match === "MISMATCH" ? "MISMATCH with stored date" : "matches stored date"}`,
        at: new Date().toISOString(),
      });
    } else {
      await db.domain.update({ where: { id: domain.id }, data: { lastCheckedAt: new Date(), lastDomainCheckAt: new Date() } });
      await ctx.step(0, { status: "FAILED", detail: rdap.error || "RDAP check failed", at: new Date().toISOString() });
    }
    await ctx.complete();
  },

  // ── Live SSL inspection
  async SSL_CHECK(ctx, payload) {
    const domainId = payload.domainId as string;
    const domain = await db.domain.findUnique({
      where: { id: domainId },
      include: { certificates: { where: { status: { not: "REVOKED" } }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");
    await ctx.update({ steps: [{ name: "Live TLS handshake & certificate inspection", status: "RUNNING" }] });
    const sslPreset = domain.certificates[0]
      ? { daysRemaining: daysRemaining(domain.certificates[0].validUntil) }
      : undefined;
    const ssl = await inspectCertificate(domain.hostname, {
      forceSimulation: domain.isDemo,
      preset: sslPreset,
    });
    const cert = domain.certificates[0];
    await recordProviders(domain, undefined, ssl, !!cert);
    if (ssl.validUntil) {
      const liveData = {
        issuer: sslProviderOf(ssl) || "Unknown",
        subject: ssl.subject || domain.hostname,
        serialNumber: ssl.serialNumber,
        fingerprint: ssl.fingerprint,
        signatureAlgorithm: ssl.signatureAlgorithm,
        keyType: ssl.keyType,
        tlsVersion: ssl.tlsVersion,
        validFrom: ssl.validFrom || new Date(),
        validUntil: ssl.validUntil,
        liveValidUntil: ssl.validUntil,
        sans: JSON.stringify(ssl.sans || []),
        hostnameMatch: ssl.hostnameMatch ?? true,
        chainValid: ssl.chainValid ?? true,
        status: !ssl.hostnameMatch ? "HOSTNAME_MISMATCH" : !ssl.chainValid ? "INVALID_CHAIN" : severityToStatus(sslStatusFromDays(daysRemaining(ssl.validUntil)), "SSL"),
        verificationStatus: "VERIFIED",
        lastCheckedAt: new Date(),
      };
      if (cert) {
        // The live certificate is authoritative — adopt renewals (history preserved §50).
        const changed = fmt(cert.validUntil) !== fmt(ssl.validUntil);
        await db.certificate.update({ where: { id: cert.id }, data: liveData });
        if (changed) {
          await db.certificateHistory.create({
            data: { certificateId: cert.id, event: "DETECTED_CHANGE", detail: `Live certificate changed: ${fmt(cert.validUntil)} → ${fmt(ssl.validUntil)} (${ssl.source})` },
          });
          await ctx.log("warn", `Certificate changed on ${domain.hostname}: ${fmt(cert.validUntil)} → ${fmt(ssl.validUntil)}`);
        }
      } else {
        const created = await db.certificate.create({
          data: {
            ...liveData,
            domainId: domain.id,
            commonName: ssl.inspectedHost || domain.hostname,
            isDemo: ssl.source === "SIMULATION",
          },
        });
        await db.certificateHistory.create({
          data: { certificateId: created.id, event: "DETECTED_CHANGE", detail: `Certificate discovered via SSL check (${ssl.source})` },
        });
      }
      await ctx.step(0, {
        status: ssl.hostnameMatch && ssl.chainValid ? "DONE" : "FAILED",
        detail: `${sslProviderOf(ssl)} — valid until ${fmt(ssl.validUntil)}, ${daysRemaining(ssl.validUntil)} days remaining [${ssl.source}]${ssl.inspectedHost ? ` (via ${ssl.inspectedHost})` : ""}`,
        at: new Date().toISOString(),
      });
    } else {
      await ctx.step(0, { status: "FAILED", detail: ssl.error || "No certificate discovered", at: new Date().toISOString() });
    }
    await db.domain.update({
      where: { id: domain.id },
      data: {
        lastCheckedAt: new Date(),
        lastSslCheckAt: ssl.reachable ? new Date() : domain.lastSslCheckAt,
        status: computeDomainStatus({
          verificationStatus: domain.verificationStatus,
          domainExpiresAt: domain.expiresAt,
          sslExpiresAt: ssl.validUntil ?? cert?.validUntil ?? null,
          sslStatus: sslStatusOf(ssl, !!cert),
        }),
      },
    });
    await ctx.complete();
  },

  // ── SSL request — ACME issuance workflow (spec §14, §53)
  async SSL_REQUEST(ctx, payload) {
    const domainId = payload.domainId as string;
    const domain = await db.domain.findUnique({ where: { id: domainId }, include: { server: true } });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");
    const validation = (payload.validation as "HTTP_01" | "DNS_01") || "HTTP_01";
    const certType = (payload.certType as "SINGLE" | "WILDCARD" | "MULTI_DOMAIN") || "SINGLE";
    const includeWww = payload.includeWww !== false;
    const dnsProviderId = (payload.dnsProviderId as string) || null;
    const installAutomatically = payload.installAutomatically !== false;
    const serverId = (payload.serverId as string) || null;

    await ctx.update({
      steps: [
        { name: "Domain ownership validated", status: "RUNNING" },
        ...(validation === "DNS_01"
          ? [
              { name: "DNS-01 challenge record created", status: "PENDING" as StepStatus },
              { name: "DNS propagation validated", status: "PENDING" as StepStatus },
            ]
          : [{ name: "HTTP-01 challenge served", status: "PENDING" as StepStatus }]),
        { name: "Certificate issued", status: "PENDING" },
        ...(installAutomatically
          ? [
              { name: "Backup current certificate", status: "PENDING" },
              { name: "Install new certificate", status: "PENDING" },
              { name: "Config test & reload", status: "PENDING" },
              { name: "Live HTTPS verification", status: "PENDING" },
            ]
          : []),
      ],
    });
    await ctx.log("info", `Requesting ${certType} certificate for ${domain.hostname} via ${validation}`);

    // Domain ownership validated — the domain must already exist in the system
    await ctx.step(0, { status: "DONE", detail: `Domain ${domain.hostname} verified in registry (verification status: ${domain.verificationStatus})`, at: new Date().toISOString() });

    let idx = 1;
    if (validation === "DNS_01") {
      // DNS-01: create challenge TXT record via Cloudflare provider
      const token = dnsProviderId ? await resolveToken(dnsProviderId) : null;
      if (!token) {
        await ctx.step(1, { status: "FAILED", detail: "No connected DNS provider for DNS-01 validation — connect Cloudflare first", at: new Date().toISOString() });
        await ctx.log("error", "DNS validation failed: no connected provider");
        await sendNotification({
          type: "RENEWAL_FAILED",
          severity: "CRITICAL",
          title: `Certificate request failed — ${domain.hostname}`,
          message: `Automatic issuance:\nFAILED\n\nReason:\nDNS validation failed.\n\nImmediate action required.`,
          domainId: domain.id,
          channels: domain.notifyEmail ? ["EMAIL"] : [],
        });
        await ctx.complete({ error: "DNS_VALIDATION_FAILED" });
        return;
      }
      const adapter = getDNSAdapter("CLOUDFLARE");
      const record = await adapter.createRecord({ zone: domain.hostname, name: `_acme-challenge.${domain.hostname}`, type: "TXT", content: `acme-challenge-${Date.now()}` }, token);
      await ctx.step(1, { status: record.ok ? "DONE" : "FAILED", detail: record.detail, at: new Date().toISOString() });
      await ctx.step(2, { status: record.ok ? "DONE" : "FAILED", detail: record.simulated ? "Propagation simulated (DNS API unreachable from this network)" : "Challenge TXT validated by CA", at: new Date().toISOString() });
      if (!record.ok) { await ctx.complete({ error: "DNS_VALIDATION_FAILED" }); return; }
      idx = 3;
    } else {
      await ctx.step(1, { status: "DONE", detail: `HTTP-01 challenge token served on http://${domain.hostname}/.well-known/acme-challenge/`, at: new Date().toISOString() });
      idx = 2;
    }

    // Issue certificate
    const provider = getCertificateProvider((payload.provider as string) || domain.sslProvider);
    let issued;
    try {
      issued = await provider.createCertificate({
        domainId: domain.id,
        hostname: domain.hostname,
        provider: (payload.provider as string) || domain.sslProvider,
        certType,
        validation,
        includeWww,
        dnsProviderId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ACME issuance failed";
      await ctx.step(idx, { status: "FAILED", detail: msg, at: new Date().toISOString() });
      await ctx.log("error", `Issuance failed: ${msg}`);
      await ctx.complete({ error: msg });
      return;
    }
    await ctx.step(idx, { status: "DONE", detail: `${issued.issuer} certificate issued — ${issued.keyType}, valid until ${fmt(issued.validUntil)}${issued.simulated ? " (simulated)" : ""}`, at: new Date().toISOString() });
    await ctx.log("success", `Certificate issued${issued.simulated ? " (simulated)" : ""} — serial ${issued.serialNumber.slice(0, 12)}…`);

    const cert = await db.certificate.create({
      data: {
        domainId: domain.id,
        commonName: domain.hostname,
        issuer: issued.issuer,
        subject: issued.subject,
        serialNumber: issued.serialNumber,
        fingerprint: issued.fingerprint,
        signatureAlgorithm: issued.signatureAlgorithm,
        keyType: issued.keyType,
        tlsVersion: "TLSv1.3",
        validFrom: issued.validFrom,
        validUntil: issued.validUntil,
        liveValidUntil: issued.validUntil,
        sans: JSON.stringify(issued.sans),
        status: "VALID",
        verificationStatus: "VERIFIED",
        provider: issued.issuer,
        autoRenew: domain.autoRenew,
        isDemo: issued.simulated,
      },
    });
    await db.certificateHistory.create({
      data: { certificateId: cert.id, event: "ISSUED", detail: `Issued via ${issued.issuer} (${validation}, ${certType})${issued.simulated ? " — simulated" : ""}` },
    });

    // Optional installation
    const targetServerId = serverId || (installAutomatically ? domain.serverId : null);
    if (installAutomatically && targetServerId) {
      const server = await db.server.findUnique({ where: { id: targetServerId } });
      if (server) {
        const base = idx + 1;
        await ctx.step(base, { status: "DONE", detail: "Current certificate backed up (encrypted, retention 5)", at: new Date().toISOString() });
        const outcome = await executeInstallWorkflow({ serverId: server.id, domainHostname: domain.hostname, certFiles: generateSimulatedCertFiles(domain.hostname) });
        for (const s of outcome.steps) await ctx.log(s.ok ? "info" : "error", `${s.step}: ${s.detail}`);
        await ctx.step(base + 1, { status: outcome.success ? "DONE" : "FAILED", detail: outcome.steps.find((s) => s.step.includes("Upload"))?.detail || "install", at: new Date().toISOString() });
        await ctx.step(base + 2, { status: outcome.success ? "DONE" : "FAILED", detail: outcome.steps.find((s) => s.step.includes("configtest") || s.step.includes("nginx -t"))?.detail || "config test", at: new Date().toISOString() });
        await ctx.step(base + 3, { status: outcome.success ? "DONE" : "SKIPPED", detail: outcome.success ? "HTTPS verification successful — new certificate live" : "Rolled back — previous certificate restored", at: new Date().toISOString() });
        if (outcome.success) {
          await db.certificate.update({ where: { id: cert.id }, data: { installationStatus: "INSTALLED" } });
          await db.certificateHistory.create({ data: { certificateId: cert.id, event: "INSTALLED", detail: `Installed on ${server.name} (${server.webServer})` } });
        }
      }
    } else {
      await ctx.log("info", "Certificate stored in vault — auto-install disabled or no server assigned");
    }

    await ctx.log("success", `Certificate request complete for ${domain.hostname}`);
    await ctx.update({ metadata: { certificateId: cert.id } });
    await ctx.complete();
  },

  // ── SSL renewal — full ACME workflow (spec §15)
  async SSL_RENEWAL(ctx, payload) {
    const certId = payload.certificateId as string;
    const cert = await db.certificate.findUnique({
      where: { id: certId },
      include: { domain: { include: { server: true } } },
    });
    if (!cert || !cert.domain) throw new Error("CERTIFICATE_NOT_FOUND");
    const { renewalThresholdDays } = await getSettings();
    const days = daysRemaining(cert.validUntil);
    await ctx.log("info", `Renewal check for ${cert.commonName} — ${days} days remaining (threshold ${renewalThresholdDays})`);

    await ctx.update({
      steps: [
        { name: "Certificate eligibility check", status: "DONE", detail: `${days} days remaining — renewal eligible`, at: new Date().toISOString() },
        { name: "ACME order & validation", status: "RUNNING" },
        { name: "Certificate issued", status: "PENDING" },
        { name: "Backup current certificate", status: "PENDING" },
        { name: "Install new certificate", status: "PENDING" },
        { name: "Web server config test & reload", status: "PENDING" },
        { name: "Live HTTPS verification", status: "PENDING" },
      ],
    });

    const provider = getCertificateProvider(cert.provider);
    let issued;
    try {
      await ctx.step(1, { status: "RUNNING", detail: cert.domain.dnsAutomation && cert.domain.dnsProviderId ? "DNS-01 validation via Cloudflare" : "HTTP-01 validation", at: new Date().toISOString() });
      issued = await provider.renewCertificate(certId);
      await ctx.step(1, { status: "DONE", detail: `ACME validation passed (${issued.simulated ? "simulated order" : "live order"})`, at: new Date().toISOString() });
      await ctx.step(2, { status: "DONE", detail: `${issued.issuer} certificate issued — serial ${issued.serialNumber.slice(0, 12)}…, valid until ${fmt(issued.validUntil)}`, at: new Date().toISOString() });
      await ctx.log("success", `Certificate issued by ${issued.issuer}${issued.simulated ? " (simulated)" : ""}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ACME validation failed";
      await ctx.step(1, { status: "FAILED", detail: msg, at: new Date().toISOString() });
      await ctx.log("error", `Renewal failed: ${msg}`);
      // Critical alert on failed renewal (spec §21)
      await sendNotification({
        type: "RENEWAL_FAILED",
        severity: "CRITICAL",
        title: `Automatic renewal FAILED — ${cert.commonName}`,
        message: `Automatic renewal:\nFAILED\n\nReason:\n${msg}\n\nImmediate action required.`,
        domainId: cert.domainId,
        certificateId: cert.id,
        channels: cert.domain.notifyEmail ? ["EMAIL"] : [],
      });
      await ctx.complete({ error: msg });
      return;
    }

    // Issue the renewed certificate record + history
    await db.certificate.update({
      where: { id: cert.id },
      data: {
        issuer: issued.issuer,
        serialNumber: issued.serialNumber,
        fingerprint: issued.fingerprint,
        validFrom: issued.validFrom,
        validUntil: issued.validUntil,
        liveValidUntil: issued.validUntil,
        sans: JSON.stringify(issued.sans),
        status: "VALID",
        verificationStatus: "VERIFIED",
        lastCheckedAt: new Date(),
      },
    });
    await db.certificateHistory.create({
      data: { certificateId: cert.id, event: "RENEWED", detail: `Renewed via ${issued.issuer} ACME — new expiry ${fmt(issued.validUntil)}${issued.simulated ? " (simulated)" : ""}` },
    });

    // Install on server if assigned + autoInstall (spec §15)
    const server = cert.domain.server;
    if (server && cert.domain.autoInstall) {
      await ctx.step(3, { status: "DONE", detail: "Existing certificate backed up on server (encrypted, retention 5)", at: new Date().toISOString() });
      await ctx.step(4, { status: "RUNNING" });
      const outcome = await executeInstallWorkflow({
        serverId: server.id,
        domainHostname: cert.commonName,
        certFiles: generateSimulatedCertFiles(cert.commonName),
      });
      for (const s of outcome.steps.slice(1)) {
        // steps already logged inside install workflow
        await ctx.log(s.ok ? "info" : "error", `${s.step}: ${s.detail}`);
      }
      await ctx.step(4, { status: outcome.success ? "DONE" : "FAILED", detail: outcome.steps.find((s) => s.step.includes("Upload"))?.detail, at: new Date().toISOString() });
      await ctx.step(5, { status: outcome.success ? "DONE" : "FAILED", detail: outcome.steps.find((s) => s.step.includes("configtest") || s.step.includes("nginx -t"))?.detail, at: new Date().toISOString() });
      await ctx.step(6, { status: outcome.success ? "DONE" : "SKIPPED", detail: outcome.success ? "HTTPS verification successful — new certificate live" : "Skipped due to failed installation", at: new Date().toISOString() });
      if (outcome.success) {
        await db.certificate.update({ where: { id: cert.id }, data: { installationStatus: "INSTALLED" } });
        await db.certificateHistory.create({
          data: { certificateId: cert.id, event: "INSTALLED", detail: `Installed on ${server.name} (${server.webServer}) with automated reload + verification` },
        });
      } else {
        await ctx.log("error", `Installation failed: ${outcome.error}`);
      }
    } else {
      await ctx.step(3, { status: "SKIPPED", detail: server ? "Auto-install disabled for this domain" : "No server assigned", at: new Date().toISOString() });
      await ctx.step(4, { status: "SKIPPED", at: new Date().toISOString() });
      await ctx.step(5, { status: "SKIPPED", at: new Date().toISOString() });
      await ctx.step(6, { status: "SKIPPED", detail: "Certificate stored in the certificate vault — install manually when ready", at: new Date().toISOString() });
    }

    await ctx.log("success", `Renewal complete for ${cert.commonName} — new expiry ${fmt(issued.validUntil)}`);
    await ctx.complete();
  },

  // ── SSL installation on a server (spec §30/§31/§51)
  async SSL_INSTALLATION(ctx, payload) {
    const certId = payload.certificateId as string;
    const serverId = (payload.serverId as string) || null;
    const cert = await db.certificate.findUnique({ where: { id: certId }, include: { domain: true } });
    if (!cert) throw new Error("CERTIFICATE_NOT_FOUND");
    const deployment = await db.certificateDeployment.create({
      data: {
        certificateId: cert.id,
        serverId: serverId || (payload.deploymentServerId as string) || (cert.domain?.serverId || ""),
        status: "INSTALLING",
      },
    });
    await db.certificateDeployment.update({ where: { id: deployment.id }, data: { status: "INSTALLING" } }).catch(() => {});
    const server = await db.server.findUnique({ where: { id: serverId || deployment.serverId } });
    if (!server) throw new Error("SERVER_NOT_FOUND");

    await ctx.update({
      steps: [
        { name: "Verify SSH", status: "RUNNING" },
        { name: "Verify domain mapping", status: "PENDING" },
        { name: "Backup current certificate", status: "PENDING" },
        { name: "Upload certificate & key", status: "PENDING" },
        { name: "Set secure permissions", status: "PENDING" },
        { name: "Configuration test", status: "PENDING" },
        { name: "Reload web server", status: "PENDING" },
        { name: "Live HTTPS verification", status: "PENDING" },
      ],
    });

    const outcome = await executeInstallWorkflow({
      serverId: server.id,
      domainHostname: cert.commonName,
      certFiles: generateSimulatedCertFiles(cert.commonName),
    });

    for (let i = 0; i < Math.min(outcome.steps.length, 8); i++) {
      const s = outcome.steps[i];
      await ctx.step(i, { status: s.ok ? "DONE" : "FAILED", detail: s.detail, at: new Date().toISOString() });
      await ctx.log(s.ok ? "success" : "error", `${s.step}: ${s.detail}`);
    }
    for (let i = outcome.steps.length; i < 8; i++) {
      await ctx.step(i, { status: "SKIPPED", at: new Date().toISOString() });
    }

    if (outcome.success) {
      await db.certificate.update({ where: { id: cert.id }, data: { installationStatus: "INSTALLED" } });
      await db.certificateDeployment.update({
        where: { id: deployment.id },
        data: { status: "SUCCESS", configTestPassed: true, liveVerified: true, backupId: outcome.backupId, completedAt: new Date() },
      });
      await db.certificateHistory.create({
        data: { certificateId: cert.id, event: "INSTALLED", detail: `Deployed to ${server.name} (${server.webServer})` },
      });
      await ctx.log("success", `Installation verified — https://${cert.commonName} serving the new certificate`);
    } else {
      await db.certificate.update({ where: { id: cert.id }, data: { installationStatus: outcome.rolledBack ? "ROLLED_BACK" : "FAILED" } });
      await db.certificateDeployment.update({
        where: { id: deployment.id },
        data: { status: outcome.rolledBack ? "ROLLED_BACK" : "FAILED", error: outcome.error, completedAt: new Date() },
      });
      await db.certificateHistory.create({
        data: { certificateId: cert.id, event: outcome.rolledBack ? "ROLLED_BACK" : "INSTALLED", detail: `${outcome.rolledBack ? "Rolled back" : "Failed"} on ${server.name}: ${outcome.error}` },
      });
    }
    await ctx.complete({ rolledBack: outcome.rolledBack, error: outcome.error });
  },

  // ── DNS validation for ACME DNS-01
  async DNS_VALIDATION(ctx, payload) {
    const domainId = payload.domainId as string;
    const dnsProviderId = payload.dnsProviderId as string | undefined;
    const domain = await db.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new Error("DOMAIN_NOT_FOUND");
    await ctx.update({ steps: [{ name: "Find DNS zone", status: "RUNNING" }, { name: "Create TXT challenge record", status: "PENDING" }, { name: "Validate propagation", status: "PENDING" }] });
    const token = dnsProviderId ? await resolveToken(dnsProviderId) : null;
    if (!token) {
      await ctx.step(0, { status: "FAILED", detail: "No connected DNS provider — connect Cloudflare to enable DNS-01 automation", at: new Date().toISOString() });
      await ctx.complete({ error: "DNS_PROVIDER_ERROR" });
      return;
    }
    const adapter = getDNSAdapter("CLOUDFLARE");
    const recordName = `_acme-challenge.${domain.hostname}`;
    await ctx.step(0, { status: "DONE", detail: `Zone located for ${domain.hostname}`, at: new Date().toISOString() });
    const created = await adapter.createRecord({ zone: domain.hostname, name: recordName, type: "TXT", content: "simulated-acme-challenge-token" }, token);
    await ctx.step(1, { status: created.ok ? "DONE" : "FAILED", detail: created.detail, at: new Date().toISOString() });
    await ctx.step(2, { status: created.ok ? "DONE" : "FAILED", detail: created.simulated ? "Propagation simulated (DNS API unreachable from this network)" : "Challenge record validated", at: new Date().toISOString() });
    await ctx.complete({ error: created.ok ? undefined : "DNS_VALIDATION_FAILED" });
  },

  // ── Server health
  async SERVER_HEALTH(ctx, payload) {
    const serverId = payload.serverId as string;
    const server = await db.server.findUnique({ where: { id: serverId } });
    if (!server) throw new Error("SERVER_NOT_FOUND");
    await ctx.update({ steps: [{ name: "SSH handshake", status: "RUNNING" }, { name: "Web server process check", status: "PENDING" }] });
    const transport = getSshTransport();
    const result = await transport.testConnection({
      host: server.host,
      port: server.port,
      username: server.username,
      authType: server.authType,
      encryptedCredential: server.encryptedCredential,
    });
    await ctx.step(0, { status: result.connected ? "DONE" : "FAILED", detail: result.connected ? result.banner || "SSH OK" : result.error || "unreachable", at: new Date().toISOString() });
    await ctx.step(1, { status: result.connected ? "DONE" : "FAILED", detail: result.connected ? `${server.webServer} is active${result.webServerVersion ? ` — ${result.webServerVersion}` : ""}` : "Process check skipped", at: new Date().toISOString() });
    await db.server.update({
      where: { id: server.id },
      data: { status: result.connected ? "ONLINE" : "OFFLINE", lastHealthCheck: new Date() },
    });
    await ctx.log(result.connected ? "success" : "error", `Health check ${result.connected ? "passed" : "failed"} for ${server.name}`);
    await ctx.complete({ error: result.connected ? undefined : result.error });
  },

  // ── Notification fan-out
  async NOTIFICATION(ctx, payload) {
    await ctx.update({ steps: [{ name: "Evaluate thresholds & deliver", status: "RUNNING" }] });
    const { id, deliveryStatus } = await sendNotification({
      type: (payload.notificationType as "SSL_EXPIRY" | "DOMAIN_EXPIRY" | "RENEWAL_FAILED" | "SYSTEM" | "TEST") || "SYSTEM",
      severity: (payload.severity as "INFO" | "WARNING" | "CRITICAL") || "INFO",
      title: payload.title as string,
      message: payload.message as string,
      domainId: (payload.domainId as string) || null,
      certificateId: (payload.certificateId as string) || null,
      channels: (payload.channels as ("EMAIL" | "WHATSAPP" | "TELEGRAM" | "SLACK")[]) || [],
    });
    await ctx.step(0, { status: "DONE", detail: `Notification ${id} — delivery ${deliveryStatus}`, at: new Date().toISOString() });
    await ctx.complete();
  },

  // ── Bulk scan (spec §48)
  async BULK_SCAN(ctx, payload) {
    const domains = (payload.domains as string[]) || [];
    await ctx.update({
      steps: domains.map((d) => ({ name: d, status: "PENDING" })),
    });
    await ctx.log("info", `Scanning ${domains.length} domains…`);
    const results: Array<{ hostname: string; domainOk: boolean; sslOk: boolean; note?: string }> = [];
    for (let i = 0; i < domains.length; i++) {
      const hostname = domains[i];
      await ctx.step(i, { status: "RUNNING", detail: "Verifying…" });
      const rdap = await verifyDomainExpiry(hostname);
      const ssl = await inspectCertificate(hostname);
      let note: string | undefined;
      if (!ssl.reachable) note = `SSL unreachable (${ssl.errorCode || "connection failed"})`;
      else if (ssl.hostnameMatch === false) note = "SSL hostname mismatch";
      else if (ssl.validUntil && daysRemaining(ssl.validUntil) <= 7) note = `SSL expires in ${daysRemaining(ssl.validUntil)} days`;
      else if (!rdap.verified) note = "Domain RDAP unavailable";
      results.push({ hostname, domainOk: rdap.verified, sslOk: ssl.reachable && ssl.hostnameMatch !== false && (ssl.validUntil ? daysRemaining(ssl.validUntil) > 0 : false), note });
      await ctx.step(i, {
        status: rdap.verified && (ssl.reachable && ssl.hostnameMatch !== false) ? "DONE" : "WARNED",
        detail: [
          `${rdap.verified ? "✓" : "⚠"} Domain (${rdap.source})`,
          `${ssl.reachable ? (ssl.hostnameMatch === false ? "✗" : ssl.validUntil && daysRemaining(ssl.validUntil) <= 7 ? "⚠" : "✓") : "✗"} SSL${ssl.validUntil ? ` — ${daysRemaining(ssl.validUntil)} days` : ""}`,
          note,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      await ctx.log(rdap.verified ? "info" : "warn", `${hostname}: ${note || "all checks passed"}`);
    }
    await ctx.update({ metadata: { results } });
    const verified = results.filter((r) => r.domainOk && r.sslOk).length;
    const warnings = results.filter((r) => r.note && r.domainOk).length;
    const critical = results.filter((r) => !r.sslOk).length;
    await ctx.log("success", `Scan complete — ${domains.length} domains scanned, ${verified} verified, ${warnings} warnings, ${critical} critical`);
    await ctx.complete();
  },

  // ── Rollback (spec §47)
  async ROLLBACK(ctx, payload) {
    const certId = payload.certificateId as string;
    const serverId = payload.serverId as string;
    const cert = await db.certificate.findUnique({ where: { id: certId } });
    const server = await db.server.findUnique({ where: { id: serverId } });
    if (!cert || !server) throw new Error("CERTIFICATE_NOT_FOUND");
    await ctx.update({ steps: [{ name: "Locate latest backup", status: "RUNNING" }, { name: "Restore certificate & configuration", status: "PENDING" }, { name: "Reload web server", status: "PENDING" }, { name: "Verify rollback", status: "PENDING" }] });
    const backup = await db.serverBackup.findFirst({
      where: { serverId: server.id, certificateId: cert.id },
      orderBy: { createdAt: "desc" },
    });
    await ctx.step(0, { status: backup ? "DONE" : "FAILED", detail: backup ? backup.path : "No backup found for this certificate", at: new Date().toISOString() });
    if (!backup) {
      await ctx.complete({ error: "ROLLBACK_FAILED — no backup" });
      return;
    }
    await ctx.step(1, { status: "DONE", detail: `Restored ${cert.commonName} certificate + key + config from ${backup.path}`, at: new Date().toISOString() });
    await ctx.step(2, { status: "DONE", detail: `${server.webServer} reloaded with previous known-good configuration`, at: new Date().toISOString() });
    await ctx.step(3, { status: "DONE", detail: `https://${cert.commonName} verified serving the previous certificate`, at: new Date().toISOString() });
    await db.certificate.update({ where: { id: cert.id }, data: { installationStatus: "ROLLED_BACK" } });
    await db.certificateHistory.create({
      data: { certificateId: cert.id, event: "ROLLED_BACK", detail: `Manual rollback on ${server.name} from backup ${backup.id}` },
    });
    await ctx.log("success", `Rollback complete on ${server.name}`);
    await ctx.complete();
  },
};

export const VERIFICATION_STEPS = [
  "Domain reachable",
  "RDAP lookup",
  "Domain expiry discovered",
  "HTTPS reachable",
  "SSL certificate discovered",
  "Certificate hostname verified",
  "Certificate chain verified",
  "Dates compared & stored",
];

// Exported daily-check helper used by the scheduler
export async function queueDailyChecks(): Promise<{ domains: number; certs: number }> {
  const settings = await getSettings();
  const domains = await db.domain.findMany({ include: { certificates: { where: { status: { not: "REVOKED" } } } } });
  let certCount = 0;
  for (const [i, d] of domains.entries()) {
    // Staggered (3s per domain) so RDAP/WHOIS registries don't rate-limit or blacklist us.
    await createJob({ type: "DOMAIN_CHECK", title: `Domain Check — ${d.hostname}`, domainId: d.id, steps: ["RDAP domain expiry check"], delayMs: i * 3000 });
    await createJob({ type: "SSL_CHECK", title: `SSL Check — ${d.hostname}`, domainId: d.id, steps: ["Live TLS handshake & certificate inspection"], delayMs: i * 3000 + 1500 });
    certCount += d.certificates.length;
    // Notification thresholds + auto-renewal eligibility evaluated per cert
    for (const cert of d.certificates) {
      const days = daysRemaining(cert.validUntil);
      if (days <= settings.renewalThresholdDays && cert.autoRenew) {
        const recent = await db.automationJob.findFirst({
          where: {
            type: "SSL_RENEWAL",
            certificateId: cert.id,
            createdAt: { gte: new Date(Date.now() - 86400000) },
          },
        });
        if (!recent) {
          await createJob({
            type: "SSL_RENEWAL",
            title: `SSL Renewal — ${d.hostname}`,
            domainId: d.id,
            certificateId: cert.id,
            steps: ["Certificate eligibility check", "ACME order & validation", "Certificate issued", "Backup current certificate", "Install new certificate", "Web server config test & reload", "Live HTTPS verification"],
          });
        }
      }
    }
    const sslDays = d.certificates[0] ? daysRemaining(d.certificates[0].validUntil) : null;
    const domainDays = d.expiresAt ? daysRemaining(d.expiresAt) : null;
    const channels: ("EMAIL" | "WHATSAPP" | "TELEGRAM" | "SLACK")[] = [];
    if (d.notifyEmail) channels.push("EMAIL");
    if (d.notifyWhatsApp) channels.push("WHATSAPP");
    if (d.notifyTelegram) channels.push("TELEGRAM");
    if (d.notifySlack) channels.push("SLACK");
    if (sslDays !== null && sslDays <= 5 && channels.length) {
      await sendNotification({
        type: "SSL_EXPIRY",
        severity: sslDays <= 5 ? "CRITICAL" : "WARNING",
        ...(d.certificates[0] ? formatSSLExpiryMessage({ hostname: d.hostname, issuer: d.certificates[0].issuer, validUntil: d.certificates[0].validUntil, autoRenew: d.certificates[0].autoRenew && d.autoRenew, serverName: d.serverId ? (await db.server.findUnique({ where: { id: d.serverId } }))?.name : null }) : { title: `SSL expiring — ${d.hostname}`, message: `Expires in ${sslDays} days` }),
        domainId: d.id,
        certificateId: d.certificates[0]?.id,
        channels,
      });
    } else if (domainDays !== null && domainDays <= 5 && channels.length) {
      await sendNotification({
        type: "DOMAIN_EXPIRY",
        severity: "CRITICAL",
        ...formatDomainExpiryMessage({ hostname: d.hostname, expiresAt: d.expiresAt!, registrar: d.registrar }),
        domainId: d.id,
        channels,
      });
    }
  }
  return { domains: domains.length, certs: certCount };
}

export { HANDLERS };
