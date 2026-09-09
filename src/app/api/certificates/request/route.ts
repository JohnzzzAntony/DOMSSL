import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { certRequestSchema } from "@/lib/validators";
import { createJob } from "@/lib/jobs/engine";

export const dynamic = "force-dynamic";

/** POST /api/certificates/request — request SSL certificate (spec §14). */
export async function POST(req: Request) {
  try {
    const user = await requirePermission("certificates.issue");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = certRequestSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;
    const domain = await db.domain.findUnique({ where: { id: data.domainId } });
    if (!domain) return fail(404, "DOMAIN_NOT_FOUND", "Domain not found");

    const jobId = await createJob({
      type: "SSL_REQUEST",
      title: `SSL Request — ${domain.hostname}`,
      domainId: domain.id,
      serverId: data.serverId || null,
      steps: [
        "Domain ownership validated",
        data.validation === "DNS_01" ? "DNS-01 challenge record created" : "HTTP-01 challenge served",
        data.validation === "DNS_01" ? "DNS propagation validated" : undefined,
        "Certificate issued",
        ...(data.installAutomatically
          ? ["Backup current certificate", "Install new certificate", "Config test & reload", "Live HTTPS verification"]
          : []),
      ].filter(Boolean) as string[],
      metadata: {
        provider: data.provider,
        certType: data.certType,
        validation: data.validation,
        includeWww: data.includeWww,
        dnsProviderId: data.dnsProviderId || null,
        installAutomatically: data.installAutomatically,
        serverId: data.serverId || null,
      },
    });

    await audit({
      actor: user.email,
      action: "SSL_REQUESTED",
      resourceType: "DOMAIN",
      resourceId: domain.id,
      detail: `Requested ${data.provider} certificate for ${domain.hostname} (${data.certType}, ${data.validation})`,
    });

    return ok({ jobId }, 201);
  } catch (e) {
    return structuredError(e);
  }
}
