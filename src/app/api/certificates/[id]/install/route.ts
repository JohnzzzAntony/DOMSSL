import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { createJob } from "@/lib/jobs/engine";

export const dynamic = "force-dynamic";

/** POST /api/certificates/:id/install — deploy to server with backup/test/reload/rollback (spec §30/31/51). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("certificates.install");
    const { id } = await params;
    const body = await readJson<{ serverId?: string }>(req).catch(() => ({}));
    const cert = await db.certificate.findUnique({ where: { id }, include: { domain: true } });
    if (!cert) return fail(404, "CERTIFICATE_NOT_FOUND", "Certificate not found");

    const serverId = body.serverId || cert.domain?.serverId;
    if (!serverId) return fail(400, "NO_SERVER_ASSIGNED", "Assign a server to this domain first or pass serverId");

    const server = await db.server.findUnique({ where: { id: serverId } });
    if (!server) return fail(404, "SERVER_NOT_FOUND", "Server not found");

    const jobId = await createJob({
      type: "SSL_INSTALLATION",
      title: `SSL Installation — ${cert.commonName} → ${server.name}`,
      domainId: cert.domainId,
      certificateId: cert.id,
      serverId: server.id,
      steps: [
        "Verify SSH",
        "Verify domain mapping",
        "Backup current certificate",
        "Upload certificate & key",
        "Set secure permissions",
        "Configuration test",
        "Reload web server",
        "Live HTTPS verification",
      ],
      metadata: { serverId: server.id },
    });

    await audit({
      actor: user.email,
      action: "SSL_INSTALLED",
      resourceType: "CERTIFICATE",
      resourceId: cert.id,
      detail: `Installation queued on ${server.name} (${server.webServer}) for ${cert.commonName}`,
    });

    return ok({ jobId }, 202);
  } catch (e) {
    return structuredError(e);
  }
}
