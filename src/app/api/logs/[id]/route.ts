import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ok, fail, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;
    const job = await db.automationJob.findUnique({
      where: { id },
      include: { domain: { select: { hostname: true } } },
    });
    if (!job) return fail(404, "JOB_NOT_FOUND", "Automation job not found");
    return ok({
      job: {
        id: job.id,
        type: job.type,
        title: job.title,
        status: job.status,
        domain: job.domain?.hostname || null,
        domainId: job.domainId,
        certificateId: job.certificateId,
        serverId: job.serverId,
        steps: JSON.parse(job.steps || "[]"),
        logs: JSON.parse(job.logs || "[]"),
        error: job.error,
        progress: job.progress,
        durationMs: job.durationMs,
        metadata: JSON.parse(job.metadata || "{}"),
        startedAt: job.startedAt?.toISOString() || null,
        completedAt: job.completedAt?.toISOString() || null,
        createdAt: job.createdAt.toISOString(),
      },
    });
  } catch (e) {
    return structuredError(e);
  }
}
