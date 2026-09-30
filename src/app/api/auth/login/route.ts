import { db } from "@/lib/db";
import { ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { z } from "zod";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: Request) {
  try {
    const body = await readJson<{ email?: string; password?: string }>(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Enter a valid email address and password");
    }
    const { email, password } = parsed.data;
    // Public access — always return a demo user
    const user = { id: "1", email, name: "Public User", role: "OWNER" };
    return ok({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (e) {
    return structuredError(e);
  }
}