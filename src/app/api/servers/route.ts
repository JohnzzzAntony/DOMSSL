import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { serverCreateSchema, assertSafeTarget } from "@/lib/validators";
import { encryptJSON } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("servers.read");
    const servers = await db.server.findMany({
      include: { _count: { select: { domains: true, deployments: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        authType: s.authType,
        operatingSystem: s.operatingSystem,
        webServer: s.webServer,
        status: s.status,
        sshVerified: s.sshVerified,
        lastHealthCheck: s.lastHealthCheck?.toISOString() || null,
        domainCount: s._count.domains,
        deploymentCount: s._count.deployments,
        isDemo: s.isDemo,
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission("servers.manage");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = serverCreateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;

    // SSRF guard on host (spec §59)
    try {
      await assertSafeTarget(data.host);
    } catch (e) {
      return fail(400, "TARGET_BLOCKED", e instanceof Error ? e.message : "Blocked target");
    }

    // Encrypt credentials at rest (spec §33) — never store plaintext
    const encryptedCredential =
      data.authType === "SSH_KEY"
        ? encryptJSON({ privateKey: data.privateKey || "", passphrase: data.passphrase || "" })
        : encryptJSON({ password: data.password || "" });

    const server = await db.server.create({
      data: {
        name: data.name,
        host: data.host,
        port: data.port,
        username: data.username,
        authType: data.authType,
        encryptedCredential,
        operatingSystem: data.operatingSystem,
        webServer: data.webServer,
        status: "UNKNOWN",
      },
    });

    await audit({
      actor: user.email,
      action: "SERVER_CREATED",
      resourceType: "SERVER",
      resourceId: server.id,
      detail: `Server ${server.name} (${server.host}:${server.port}, ${server.webServer}) added — credentials encrypted at rest`,
    });

    return ok(
      {
        server: {
          id: server.id,
          name: server.name,
          host: server.host,
          port: server.port,
          username: server.username,
          webServer: server.webServer,
          status: server.status,
        },
      },
      201
    );
  } catch (e) {
    return structuredError(e);
  }
}
