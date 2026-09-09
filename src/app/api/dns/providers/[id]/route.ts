import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("dns.manage");
    const { id } = await params;
    const provider = await db.dNSProvider.findUnique({ where: { id } });
    if (!provider) return fail(404, "DNS_PROVIDER_NOT_FOUND", "DNS provider not found");
    await db.dNSProvider.delete({ where: { id } });
    await audit({
      actor: user.email,
      action: "DNS_PROVIDER_REMOVED",
      resourceType: "DNS_PROVIDER",
      resourceId: id,
      detail: `Removed ${provider.name} provider`,
    });
    return ok({ deleted: true });
  } catch (e) {
    return structuredError(e);
  }
}
