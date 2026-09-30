import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, structuredError, readJson, fail } from "@/lib/api-helpers";
import { domainCreateSchema } from "@/lib/validators";
import { daysRemaining } from "@/lib/status";
import { createJob } from "@/lib/jobs/engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requirePermission("domains.read");
    const url = new URL(req.url);
    const search = url.searchParams.get("search")?.toLowerCase() || "";
    const status = url.searchParams.get("status") || "ALL";
    const environment = url.searchParams.get("environment") || "ALL";

    const domains = await db.domain.findMany({
      include: {
        server: { select: { id: true, name: true, status: true, webServer: true } },
        certificates: { where: { status: { not: "REVOKED" } }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    });

    const filtered = domains.filter((d) => {
      if (search && !d.hostname.toLowerCase().includes(search) && !(d.server?.name || "").toLowerCase().includes(search)) return false;
      if (status !== "ALL") {
        const sslDays = d.certificates[0] ? daysRemaining(d.certificates[0].validUntil) : null;
        if (status === "HEALTHY" && !["HEALTHY"].includes(d.status)) return false;
        if (status === "EXPIRING_SOON" && !["EXPIRING_SOON", "WARNING", "DOMAIN_EXPIRING"].includes(d.status)) return false;
        if (status === "CRITICAL" && !["CRITICAL", "EXPIRED"].includes(d.status)) return false;
        if (status === "SSL_ERROR" && d.status !== "SSL_ERROR") return false;
        if (status === "NO_SSL" && d.status !== "NO_SSL") return false;
        if (status === "UNVERIFIED" && d.verificationStatus === "VERIFIED") return false;
        if (status === "MISMATCH" && d.verificationStatus !== "MISMATCH") return false;
        if (status === "AUTOMATION_ON" && !(d.autoRenew || d.autoInstall)) return false;
        if (status === "AUTOMATION_OFF" && (d.autoRenew || d.autoInstall)) return false;
        void sslDays;
      }
      if (environment !== "ALL" && d.environment !== environment) return false;
      return true;
    });

    return ok({
      domains: filtered.map((d) => ({
        id: d.id,
        hostname: d.hostname,
        environment: d.environment,
        registrar: d.registrar,
        sslProvider: d.sslProvider,
        expiresAt: d.expiresAt?.toISOString() || null,
        verifiedExpiresAt: d.verifiedExpiresAt?.toISOString() || null,
        registrarExpiresAt: d.registrarExpiresAt?.toISOString() || null,
        registeredAt: d.registeredAt?.toISOString() || null,
        sslExpiresAt: d.certificates[0]?.validUntil?.toISOString() || null,
        certificateId: d.certificates[0]?.id || null,
        sslStatus: d.certificates[0]?.status || null,
        sslDays: d.certificates[0] ? daysRemaining(d.certificates[0].validUntil) : null,
        domainDays: d.expiresAt ? daysRemaining(d.expiresAt) : null,
        status: d.status,
        verificationStatus: d.verificationStatus,
        autoRenew: d.autoRenew,
        autoInstall: d.autoInstall,
        dnsAutomation: d.dnsAutomation,
        alertThresholdDays: d.alertThresholdDays,
        server: d.server,
        lastCheckedAt: d.lastCheckedAt?.toISOString() || null,
        isDemo: d.isDemo,
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission("domains.write");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = domainCreateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;

    const existing = await db.domain.findUnique({ where: { hostname: data.hostname } });
    if (existing) {
      return Response.json(
        { success: false, code: "DOMAIN_EXISTS", message: `${data.hostname} is already being managed` },
        { status: 409 }
      );
    }

    // SSRF guard before we ever contact the target (spec §59)
    const { assertSafeTarget } = await import("@/lib/validators");
    try {
      await assertSafeTarget(data.hostname);
    } catch (e) {
      return Response.json(
        { success: false, code: "TARGET_BLOCKED", message: e instanceof Error ? e.message : "Blocked target" },
        { status: 400 }
      );
    }

    const domain = await db.domain.create({
      data: {
        hostname: data.hostname,
        environment: data.environment,
        registrar: data.registrar,
        sslProvider: data.sslProvider,
        expiresAt: data.storedDomainExpiry ? new Date(data.storedDomainExpiry) : null,
        autoRenew: data.autoRenew,
        autoInstall: data.autoInstall,
        dnsAutomation: data.dnsAutomation,
        notifyEmail: data.notifyEmail,
        notifyWhatsApp: data.notifyWhatsApp,
        notifyTelegram: data.notifyTelegram,
        notifySlack: data.notifySlack,
        alertThresholdDays: data.alertThresholdDays,
        serverId: data.serverId || null,
        status: "PENDING",
      },
    });

    await audit({
      actor: user.email,
      action: "DOMAIN_CREATED",
      resourceType: "DOMAIN",
      resourceId: domain.id,
      detail: `Domain ${domain.hostname} added — verification queued`,
    });

    // Spec §9: create record → queue verification (RDAP → SSL → DNS)
    const jobId = await createJob({
      type: "VERIFICATION",
      title: `Verify — ${domain.hostname}`,
      domainId: domain.id,
      steps: [
        "Domain reachable",
        "RDAP lookup",
        "Domain expiry discovered",
        "HTTPS reachable",
        "SSL certificate discovered",
        "Certificate hostname verified",
        "Certificate chain verified",
        "Dates compared & stored",
      ],
    });

    return ok({ domain, jobId }, 201);
  } catch (e) {
    return structuredError(e);
  }
}
