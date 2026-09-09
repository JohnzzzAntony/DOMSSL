import { destroySession, getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getClientIp, ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    await destroySession();
    if (user) {
      await audit({ actor: user.email, action: "LOGOUT", ip: getClientIp(req) });
    }
    return ok({ loggedOut: true });
  } catch (e) {
    return structuredError(e);
  }
}
