import { ok, structuredError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Public access — return dummy user
    return ok({ user: { id: "1", email: "public@certguard.local", name: "Public User", role: "OWNER" } });
  } catch (e) {
    return structuredError(e);
  }
}