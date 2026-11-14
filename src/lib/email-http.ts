import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { cookieName } from "./cookies";
import { assertEmailOtpReady, ConfigError, sessionSecret } from "./env";
import { json, MSG } from "./http";
import { verifyAccess, verifyPending, type PendingLogin } from "./tokens";

/**
 * Shared by /api/auth/email/*: the configuration check, then the LINE account that asks. A doctor comes from the LINE
 * sign-in (pending cookie), or from the name page after an SMS code (access cookie: a verified number that holds no
 * name, which then goes back to "/" once signed in). Returns that LINE account, or the error response to send.
 */
export async function emailLoginFor(req: NextRequest): Promise<PendingLogin | NextResponse> {
  try {
    assertEmailOtpReady();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("[email-otp] not configured:", e.names.join(", "));
      return json({ error: MSG.notReady }, 503);
    }
    throw e;
  }
  const secret = sessionSecret();
  const pending = await verifyPending(req.cookies.get(cookieName("pending"))?.value, secret);
  if (pending) return pending;
  const grant = await verifyAccess(req.cookies.get(cookieName("access"))?.value, secret);
  if (grant) return { sub: grant.sub, name: grant.name, picture: grant.picture, next: "/" };
  return json({ error: MSG.sessionExpired, restart: true }, 401);
}

/** A users.id as sent by the page ("12"), or null. */
export function userIdFrom(v: unknown): string | null {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
  return typeof s === "string" && /^[1-9]\d{0,9}$/.test(s) ? s : null;
}
