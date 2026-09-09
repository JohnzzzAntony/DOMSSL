import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getClientIp, ok, fail, structuredError, readJson } from "@/lib/api-helpers";
import { z } from "zod";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = await readJson<{ email?: string; password?: string }>(req);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, "VALIDATION_ERROR", "Enter a valid email address and password");
    }
    const { email, password } = parsed.data;
    const user = await db.user.findUnique({ where: { email } });

    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      await audit({
        actor: email,
        action: "LOGIN_FAILED",
        ip: getClientIp(req),
        result: "FAILED",
        detail: "Invalid credentials",
      });
      return fail(401, "INVALID_CREDENTIALS", "Incorrect email or password");
    }

    await createSession(user.id, getClientIp(req), req.headers.get("user-agent") || undefined);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({
      actor: user.email,
      action: "LOGIN",
      detail: `Signed in (${user.role})`,
      ip: getClientIp(req),
    });

    return ok({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (e) {
    return structuredError(e);
  }
}
