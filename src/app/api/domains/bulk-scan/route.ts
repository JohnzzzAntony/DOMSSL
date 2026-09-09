import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, structuredError, readJson } from "@/lib/api-helpers";
import { bulkScanSchema } from "@/lib/validators";
import { createJob, runJob } from "@/lib/jobs/engine";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/domains/bulk-scan — first-run bulk scanner (spec §48). */
export async function POST(req: Request) {
  try {
    const user = await requirePermission("domains.read");
    const body = await readJson<{ domains?: string[] }>(req);
    const parsed = bulkScanSchema.safeParse({ domains: body.domains || [] });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return Response.json(
        { success: false, code: "VALIDATION_ERROR", message: first?.message || "Invalid input" },
        { status: 400 }
      );
    }
    const domains = parsed.data.domains;

    const jobId = await createJob({
      type: "BULK_SCAN",
      title: `Bulk Scan — ${domains.length} domains`,
      steps: domains,
      metadata: { domains },
    });

    await audit({
      actor: user.email,
      action: "BULK_SCAN",
      detail: `Scanning ${domains.length} domains: ${domains.join(", ")}`,
    });

    // Bulk scans run inline so the scanner UI receives complete results
    await runJob(jobId);
    const job = await db.automationJob.findUnique({ where: { id: jobId } });

    return ok({
      jobId,
      job: job
        ? {
            ...job,
            steps: JSON.parse(job.steps || "[]"),
            logs: JSON.parse(job.logs || "[]"),
            metadata: JSON.parse(job.metadata || "{}"),
          }
        : null,
    });
  } catch (e) {
    return structuredError(e);
  }
}
