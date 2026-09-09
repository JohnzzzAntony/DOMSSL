import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAuth();
    const url = new URL(req.url);
    const limit = Math.min(500, parseInt(url.searchParams.get("limit") || "150", 10));
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return ok({
      logs: logs.map((l) => ({
        id: l.id,
        actor: l.actor,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        detail: l.detail,
        ip: l.ip,
        result: l.result,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}
