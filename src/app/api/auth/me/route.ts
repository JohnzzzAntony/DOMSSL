import { getSessionUser } from "@/lib/auth";
import { ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    return ok({ user });
  } catch (e) {
    return structuredError(e);
  }
}
