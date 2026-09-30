import { ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    // Public access — no session to destroy
    return ok({ loggedOut: true });
  } catch (e) {
    return structuredError(e);
  }
}