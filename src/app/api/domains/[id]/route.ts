import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { domainUpdateSchema } from "@/lib/validators";

export const dynamic = "force-dynamic";

async function getDomainOr404(id: string) {
  const domain = await db.domain.findUnique({
    where: { id },
    include: {
      server: { select: { id: true, name: true, host: true, status: true, webServer: true, operatingSystem: true } },
      certificates: {
        orderBy: { createdAt: "desc" },
        include: { history: { orderBy: { createdAt: "desc" }, take: 10 } },
      },
      verificationResults: { orderBy: { createdAt: "desc" }, take: 20 },
      jobs: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  return domain;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("domains.read");
    const { id } = await params;
    const domain = await getDomainOr404(id);
    if (!domain) return fail(404, "DOMAIN_NOT_FOUND", "Domain not found");
    return ok({ domain });
  } catch (e) {
    return structuredError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("domains.write");
    const { id } = await params;
    const domain = await db.domain.findUnique({ where: { id } });
    if (!domain) return fail(404, "DOMAIN_NOT_FOUND", "Domain not found");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = domainUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;
    const updated = await db.domain.update({
      where: { id },
      data: {
        ...(data.environment ? { environment: data.environment } : {}),
        ...(data.registrar ? { registrar: data.registrar } : {}),
        ...(data.sslProvider ? { sslProvider: data.sslProvider } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt ? new Date(data.expiresAt) : null } : {}),
        ...(data.autoRenew !== undefined ? { autoRenew: data.autoRenew } : {}),
        ...(data.autoInstall !== undefined ? { autoInstall: data.autoInstall } : {}),
        ...(data.dnsAutomation !== undefined ? { dnsAutomation: data.dnsAutomation } : {}),
        ...(data.notifyEmail !== undefined ? { notifyEmail: data.notifyEmail } : {}),
        ...(data.notifyWhatsApp !== undefined ? { notifyWhatsApp: data.notifyWhatsApp } : {}),
        ...(data.notifyTelegram !== undefined ? { notifyTelegram: data.notifyTelegram } : {}),
        ...(data.notifySlack !== undefined ? { notifySlack: data.notifySlack } : {}),
        ...(data.alertThresholdDays !== undefined ? { alertThresholdDays: data.alertThresholdDays } : {}),
        ...(data.serverId !== undefined ? { serverId: data.serverId || null } : {}),
      },
    });
    await audit({
      actor: user.email,
      action: "DOMAIN_UPDATED",
      resourceType: "DOMAIN",
      resourceId: id,
      detail: `Updated ${domain.hostname}: ${Object.keys(data).join(", ")}`,
    });
    return ok({ domain: updated });
  } catch (e) {
    return structuredError(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("domains.delete");
    const { id } = await params;
    const domain = await db.domain.findUnique({ where: { id } });
    if (!domain) return fail(404, "DOMAIN_NOT_FOUND", "Domain not found");
    await db.domain.delete({ where: { id } });
    await audit({
      actor: user.email,
      action: "DOMAIN_DELETED",
      resourceType: "DOMAIN",
      resourceId: id,
      detail: `Deleted ${domain.hostname} — monitoring and automation removed`,
    });
    return ok({ deleted: true });
  } catch (e) {
    return structuredError(e);
  }
}
