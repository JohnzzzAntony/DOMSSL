import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, structuredError, readJson } from "@/lib/api-helpers";
import { bulkScanSchema } from "@/lib/validators";
import { createJob, runJob, VERIFICATION_STEPS } from "@/lib/jobs/engine";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** POST /api/domains/bulk-scan — first-run bulk scanner (spec §48). */
export async function POST(req: Request) {
  try {
    const user = await requirePermission("domains.read");
    const body = await readJson<{ domains?: string[]; addToMonitoring?: boolean }>(req);
    const parsed = bulkScanSchema.safeParse({ domains: body.domains || [], addToMonitoring: body.addToMonitoring });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return Response.json(
        { success: false, code: "VALIDATION_ERROR", message: first?.message || "Invalid input" },
        { status: 400 }
      );
    }
    const domains = Array.from(new Set(parsed.data.domains));

    if (parsed.data.addToMonitoring) {
      await requirePermission("domains.write");
      const existing = await db.domain.findMany({ where: { hostname: { in: domains } }, select: { hostname: true } });
      const known = new Set(existing.map((d) => d.hostname));
      const toAdd = domains.filter((d) => !known.has(d));
      for (const [i, hostname] of toAdd.entries()) {
        const domain = await db.domain.create({ data: { hostname, status: "PENDING" } });
        // Stagger verifications so RDAP/WHOIS registries don't rate-limit us.
        await createJob({
          type: "VERIFICATION",
          title: `Verify — ${hostname}`,
          domainId: domain.id,
          steps: VERIFICATION_STEPS,
          delayMs: 50 + i * 1500,
        });
      }
      await audit({
        actor: user.email,
        action: "DOMAIN_CREATED",
        detail: `Bulk import: ${toAdd.length} added, ${known.size} already monitored${toAdd.length ? ` — ${toAdd.join(", ")}` : ""}`,
      });
      return ok({ added: toAdd, skipped: [...known] });
    }

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
