import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { dnsProviderCreateSchema } from "@/lib/validators";
import { encryptJSON, maskSecret } from "@/lib/crypto";
import { getDNSAdapter } from "@/lib/engines/providers/cloudflare";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("dns.read");
    const providers = await db.dNSProvider.findMany({ orderBy: { createdAt: "asc" } });
    return ok({
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        providerType: p.providerType,
        tokenMasked: p.tokenLast4 ? `••••••••${p.tokenLast4}` : null,
        hasToken: !!p.encryptedToken,
        zoneAccess: p.zoneAccess,
        zones: JSON.parse(p.zones || "[]"),
        status: p.status,
        lastTestedAt: p.lastTestedAt?.toISOString() || null,
        lastError: p.lastError,
      })),
    });
  } catch (e) {
    return structuredError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission("dns.manage");
    const body = await readJson<Record<string, unknown>>(req);
    const parsed = dnsProviderCreateSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input");
    }
    const data = parsed.data;

    // Test the token via the provider adapter before saving
    const adapter = getDNSAdapter(data.providerType);
    const test = await adapter.testConnection(data.apiToken);

    const provider = await db.dNSProvider.create({
      data: {
        name: "Cloudflare",
        providerType: data.providerType,
        encryptedToken: encryptJSON({ apiToken: data.apiToken }),
        tokenLast4: maskSecret(data.apiToken).slice(-4),
        zoneAccess: data.zoneAccess,
        zones: JSON.stringify(test.zones.map((z) => z.name)),
        status: test.ok ? "CONNECTED" : "ERROR",
        lastTestedAt: new Date(),
        lastError: test.error || null,
      },
    });

    await audit({
      actor: user.email,
      action: "DNS_PROVIDER_ADDED",
      resourceType: "DNS_PROVIDER",
      resourceId: provider.id,
      result: test.ok ? "SUCCESS" : "FAILED",
      detail: `Cloudflare connected (token stored encrypted, ${maskSecret(data.apiToken)}) — ${test.detail}`,
    });

    return ok(
      {
        provider: {
          id: provider.id,
          name: provider.name,
          status: provider.status,
          zones: test.zones.map((z) => z.name),
          simulated: test.simulated,
          detail: test.detail,
        },
      },
      201
    );
  } catch (e) {
    return structuredError(e);
  }
}
