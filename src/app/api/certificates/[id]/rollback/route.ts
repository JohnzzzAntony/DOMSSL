import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { createJob } from "@/lib/jobs/engine";

export const dynamic = "force-dynamic";

/** POST /api/certificates/:id/rollback — restore previous known-good certificate (spec §47). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("certificates.install");
    const { id } = await params;
    const body = await readJson<{ serverId?: string }>(req).catch(() => ({}));
    const cert = await db.certificate.findUnique({ where: { id } });
    if (!cert) return fail(404, "CERTIFICATE_NOT_FOUND", "Certificate not found");

    const lastDeployment = await db.certificateDeployment.findFirst({
      where: { certificateId: cert.id },
      orderBy: { createdAt: "desc" },
    });
    const serverId = body.serverId || lastDeployment?.serverId;
    if (!serverId) return fail(400, "NO_DEPLOYMENT", "This certificate has never been deployed — nothing to roll back");

    const jobId = await createJob({
      type: "ROLLBACK",
      title: `Rollback — ${cert.commonName}`,
      certificateId: cert.id,
      serverId,
      steps: ["Locate latest backup", "Restore certificate & configuration", "Reload web server", "Verify rollback"],
    });

    await audit({
      actor: user.email,
      action: "SSL_ROLLBACK",
      resourceType: "CERTIFICATE",
      resourceId: cert.id,
      result: "FAILED",
      detail: `Rollback triggered for ${cert.commonName}`,
    });

    return ok({ jobId }, 202);
  } catch (e) {
    return structuredError(e);
  }
}
