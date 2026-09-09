import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError } from "@/lib/api-helpers";
import { createJob } from "@/lib/jobs/engine";

export const dynamic = "force-dynamic";

/** POST /api/certificates/:id/renew — queue ACME renewal workflow (spec §15). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("certificates.renew");
    const { id } = await params;
    const cert = await db.certificate.findUnique({ where: { id }, include: { domain: true } });
    if (!cert) return fail(404, "CERTIFICATE_NOT_FOUND", "Certificate not found");

    const recent = await db.automationJob.findFirst({
      where: {
        type: "SSL_RENEWAL",
        certificateId: cert.id,
        status: { in: ["QUEUED", "RUNNING"] },
      },
    });
    if (recent) {
      return fail(409, "RENEWAL_ALREADY_RUNNING", "A renewal job is already queued or running for this certificate (idempotency guard)");
    }

    const jobId = await createJob({
      type: "SSL_RENEWAL",
      title: `SSL Renewal — ${cert.commonName}`,
      domainId: cert.domainId,
      certificateId: cert.id,
      steps: [
        "Certificate eligibility check",
        "ACME order & validation",
        "Certificate issued",
        "Backup current certificate",
        "Install new certificate",
        "Web server config test & reload",
        "Live HTTPS verification",
      ],
    });

    await audit({
      actor: user.email,
      action: "SSL_RENEWED",
      resourceType: "CERTIFICATE",
      resourceId: cert.id,
      detail: `Renewal queued for ${cert.commonName}`,
    });

    return ok({ jobId }, 202);
  } catch (e) {
    return structuredError(e);
  }
}
