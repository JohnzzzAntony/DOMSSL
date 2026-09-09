import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { serverUpdateSchema } from "@/lib/validators";
import { encryptJSON } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("servers.read");
    const { id } = await params;
    const server = await db.server.findUnique({
      where: { id },
      include: {
        domains: { select: { id: true, hostname: true, status: true } },
        deployments: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { certificate: { select: { id: true, commonName: true } } },
        },
        backups: { orderBy: { createdAt: "desc" }, take: 10 },
        jobs: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    if (!server) return fail(404, "SERVER_NOT_FOUND", "Server not found");
    // NOTE: encryptedCredential is never returned to the frontend (spec §33)
    return ok({
      server: {
        id: server.id,
        name: server.name,
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType,
        operatingSystem: server.operatingSystem,
        webServer: server.webServer,
        status: server.status,
        sshVerified: server.sshVerified,
        lastHealthCheck: server.lastHealthCheck?.toISOString() || null,
        isDemo: server.isDemo,
        domains: server.domains,
        deployments: server.deployments,
        backups: server.backups,
        jobs: server.jobs,
        createdAt: server.createdAt.toISOString(),
      },
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("servers.manage");
    const { id } = await params;
    const server = await db.server.findUnique({ where: { id } });
    if (!server) return fail(404, "SERVER_NOT_FOUND", "Server not found");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = serverUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;
    const updated = await db.server.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.host ? { host: data.host } : {}),
        ...(data.port !== undefined ? { port: data.port } : {}),
        ...(data.username ? { username: data.username } : {}),
        ...(data.operatingSystem ? { operatingSystem: data.operatingSystem } : {}),
        ...(data.webServer ? { webServer: data.webServer } : {}),
        ...(data.authType || data.privateKey || data.password
          ? {
              encryptedCredential: encryptJSON({
                privateKey: data.privateKey || "",
                password: data.password || "",
                passphrase: data.passphrase || "",
              }),
              authType: data.authType || server.authType,
            }
          : {}),
      },
    });
    await audit({
      actor: user.email,
      action: "SERVER_UPDATED",
      resourceType: "SERVER",
      resourceId: id,
      detail: `Updated ${server.name}`,
    });
    return ok({ server: { id: updated.id, name: updated.name } });
  } catch (e) {
    return structuredError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("servers.manage");
    const { id } = await params;
    const server = await db.server.findUnique({ where: { id } });
    if (!server) return fail(404, "SERVER_NOT_FOUND", "Server not found");
    await db.server.delete({ where: { id } });
    await audit({
      actor: user.email,
      action: "SERVER_DELETED",
      resourceType: "SERVER",
      resourceId: id,
      detail: `Deleted ${server.name}`,
    });
    return ok({ deleted: true });
  } catch (e) {
    return structuredError(e);
  }
}
