import { NextResponse } from "next/server";
import { ApiError } from "@/lib/auth";
import { z } from "zod";

/**
 * Standardized API responses + structured errors (spec §41).
 */

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, ...(data as object) }, { status });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, code, message, ...extra }, { status });
}

export function structuredError(e: unknown) {
  if (e instanceof ApiError) {
    return fail(e.status, e.code, e.message);
  }
  if (e instanceof z.ZodError) {
    const first = e.issues[0];
    return fail(400, "VALIDATION_ERROR", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input");
  }
  const message = e instanceof Error ? e.message : "Internal server error";
  console.error("[api]", e);
  return fail(500, "INTERNAL_ERROR", message);
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}
