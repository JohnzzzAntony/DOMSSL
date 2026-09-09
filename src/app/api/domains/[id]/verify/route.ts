import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { createJob, runJob } from "@/lib/jobs/engine";

export const dynamic = "force-dynamic";

/** POST /api/domains/:id/verify — queue a full verification pipeline run (spec §10). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("domains.write");
    const { id } = await params;
    const domain = await db.domain.findUnique({ where: { id } });
    if (!domain) return fail(404, "DOMAIN_NOT_FOUND", "Domain not found");

    const body = await readJson<{ waitForResult?: boolean }>(req).catch(() => ({}));

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

    await audit({
      actor: user.email,
      action: "DOMAIN_VERIFIED",
      resourceType: "DOMAIN",
      resourceId: domain.id,
      detail: `Verification triggered for ${domain.hostname}`,
    });

    // If the client asked to wait (small verification screens), run inline.
    if (body.waitForResult) {
      await runJob(jobId);
    }

    return ok({ jobId });
  } catch (e) {
    return structuredError(e);
  }
}
