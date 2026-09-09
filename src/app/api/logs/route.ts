import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAuth();
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "ALL";
    const status = url.searchParams.get("status") || "ALL";
    const limit = Math.min(200, parseInt(url.searchParams.get("limit") || "100", 10));

    const jobs = await db.automationJob.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { domain: { select: { hostname: true } } },
    });

    const filtered = jobs.filter((j) => {
      if (action !== "ALL" && j.type !== action) return false;
      if (status !== "ALL" && j.status !== status) return false;
      return true;
    });

    return ok({
      jobs: filtered.map((j) => ({
        id: j.id,
        type: j.type,
        title: j.title,
        status: j.status,
        domain: j.domain?.hostname || null,
        domainId: j.domainId,
        progress: j.progress,
        durationMs: j.durationMs,
        error: j.error,
        startedAt: j.startedAt?.toISOString() || null,
        completedAt: j.completedAt?.toISOString() || null,
        createdAt: j.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}
