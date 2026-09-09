import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ok, fail, structuredError } from "@/lib/api-helpers";
import { daysRemaining } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("certificates.read");
    const { id } = await params;
    const cert = await db.certificate.findUnique({
      where: { id },
      include: {
        domain: { select: { id: true, hostname: true, environment: true } },
        history: { orderBy: { createdAt: "desc" } },
        deployments: {
          orderBy: { createdAt: "desc" },
          include: { server: { select: { id: true, name: true, webServer: true, status: true } } },
        },
      },
    });
    if (!cert) return fail(404, "CERTIFICATE_NOT_FOUND", "Certificate not found");
    return ok({
      certificate: {
        ...cert,
        validFrom: cert.validFrom.toISOString(),
        validUntil: cert.validUntil.toISOString(),
        liveValidUntil: cert.liveValidUntil?.toISOString() || null,
        daysRemaining: daysRemaining(cert.validUntil),
        sans: JSON.parse(cert.sans || "[]"),
        createdAt: cert.createdAt.toISOString(),
        updatedAt: cert.updatedAt.toISOString(),
        lastCheckedAt: cert.lastCheckedAt?.toISOString() || null,
      },
    });
  } catch (e) {
    return structuredError(e);
  }
}
