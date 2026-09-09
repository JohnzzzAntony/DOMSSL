import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ok, structuredError } from "@/lib/api-helpers";
import { daysRemaining } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requirePermission("certificates.read");
    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "ALL";
    const search = (url.searchParams.get("search") || "").toLowerCase();

    const certs = await db.certificate.findMany({
      where: { status: { not: "REVOKED" } },
      include: {
        domain: { select: { id: true, hostname: true, environment: true, server: { select: { id: true, name: true } } } },
        deployments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { validUntil: "asc" },
    });

    const filtered = certs.filter((c) => {
      const days = daysRemaining(c.validUntil);
      if (search && !(c.commonName.toLowerCase().includes(search) || c.issuer.toLowerCase().includes(search))) return false;
      switch (filter) {
        case "VALID":
          return c.status === "VALID" && days > 30;
        case "EXPIRING":
          return ["EXPIRING", "WARNING", "CRITICAL"].includes(c.status) || (days <= 30 && days > 0);
        case "EXPIRED":
          return c.status === "EXPIRED" || days <= 0;
        case "ERRORS":
          return ["HOSTNAME_MISMATCH", "INVALID_CHAIN", "DEPLOY_FAILED"].includes(c.status);
        default:
          return true;
      }
    });

    return ok({
      certificates: filtered.map((c) => ({
        id: c.id,
        commonName: c.commonName,
        domain: c.domain,
        issuer: c.issuer,
        subject: c.subject,
        serialNumber: c.serialNumber,
        fingerprint: c.fingerprint,
        signatureAlgorithm: c.signatureAlgorithm,
        keyType: c.keyType,
        tlsVersion: c.tlsVersion,
        validFrom: c.validFrom.toISOString(),
        validUntil: c.validUntil.toISOString(),
        sans: JSON.parse(c.sans || "[]"),
        status: c.status,
        daysRemaining: daysRemaining(c.validUntil),
        hostnameMatch: c.hostnameMatch,
        chainValid: c.chainValid,
        provider: c.provider,
        installationStatus: c.installationStatus,
        autoRenew: c.autoRenew,
        verificationStatus: c.verificationStatus,
        isDemo: c.isDemo,
        lastCheckedAt: c.lastCheckedAt?.toISOString() || null,
        lastDeployment: c.deployments[0]?.createdAt?.toISOString() || null,
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}
