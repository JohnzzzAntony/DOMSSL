import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { createJob } from "@/lib/jobs/engine";
import { assertAllowedCommands, ServerOperation } from "@/lib/engines/providers/ssh-deployment";

export const dynamic = "force-dynamic";

/**
 * POST /api/servers/:id/operations — PREDEFINED operations only (spec §18).
 * Arbitrary shell execution is impossible: commands are allowlisted per
 * operation and never taken from user input (spec §32).
 */
const OPERATIONS: Record<string, { type: ServerOperation; steps: string[]; label: string }> = {
  TEST_SSH: { type: "TEST_SSH", steps: ["SSH handshake"], label: "Test SSH" },
  CHECK_NGINX: { type: "CHECK_NGINX", steps: ["nginx -t", "Process status"], label: "Check Nginx" },
  CHECK_APACHE: { type: "CHECK_APACHE", steps: ["apachectl configtest", "Process status"], label: "Check Apache" },
  RELOAD_WEB_SERVER: { type: "RELOAD_WEB_SERVER", steps: ["Config test", "Reload", "Verify"], label: "Reload Web Server" },
  VERIFY_SSL: { type: "VERIFY_SSL", steps: ["TLS handshake", "Certificate check"], label: "Verify SSL" },
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("servers.manage");
    const { id } = await params;
    const body = await readJson<{ operation?: string }>(req);
    const opKey = (body.operation || "").toUpperCase();
    const op = OPERATIONS[opKey];
    if (!op) {
      return fail(400, "INVALID_OPERATION", `Allowed operations: ${Object.keys(OPERATIONS).join(", ")}`);
    }
    const server = await db.server.findUnique({ where: { id } });
    if (!server) return fail(404, "SERVER_NOT_FOUND", "Server not found");

    // Enforce the command allowlist for this operation (defense in depth)
    assertAllowedCommands(op.type, [
      op.type === "CHECK_NGINX" ? "nginx -t" :
      op.type === "CHECK_APACHE" ? "apachectl configtest" :
      op.type === "RELOAD_WEB_SERVER" ? (server.webServer === "Apache" ? "systemctl reload apache2" : "systemctl reload nginx") :
      op.type === "VERIFY_SSL" ? "openssl s_client -connect" : "echo ok",
    ]);

    const jobId = await createJob({
      type: "SERVER_HEALTH",
      title: `${op.label} — ${server.name}`,
      serverId: server.id,
      steps: op.steps,
      metadata: { operation: opKey },
    });

    await audit({
      actor: user.email,
      action: "SERVER_OPERATION",
      resourceType: "SERVER",
      resourceId: server.id,
      detail: `${op.label} executed on ${server.name}`,
    });

    return ok({ jobId }, 202);
  } catch (e) {
    return structuredError(e);
  }
}
