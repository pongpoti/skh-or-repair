import "server-only";
import type { Pool } from "pg";
import { isAuthorizedDoctor, isAuthorizedPhone } from "@/lib/authz";
import { freshEmailClaim } from "@/lib/email-otp";
import type { LineProfile } from "@/lib/line";
import { findFreshBinding, logEvent, touchBinding } from "@/lib/otp";
import { signPending, signSession } from "@/lib/tokens";

/**
 * What a verified LINE account gets, the same whether LINE Login's web redirect (/api/auth/line/callback) or the LIFF
 * SDK (/api/auth/line/liff) proved it:
 *   session - a doctor whose email code this LINE account checked within 180 days and who still holds the (active)
 *             name, or a LINE account whose SMS code was checked within 180 days for a number that is still authorized
 *             (a claimed name, an approved access request, or ALLOWED_PHONES);
 *   pending - anyone else, who proves a mobile number (or, for a doctor, a name by email code) at /login/verify.
 */
export type LineSignIn = { kind: "session"; token: string } | { kind: "pending"; token: string };

export async function lineSignIn(
  pool: Pool,
  profile: LineProfile,
  next: string,
  secret: string,
  meta: { ip: string; userAgent: string },
): Promise<LineSignIn> {
  const doctorId = await freshEmailClaim(pool, profile.sub);
  if (doctorId && (await isAuthorizedDoctor(doctorId, profile.sub))) {
    await logEvent(pool, { event: "login_email_binding", sub: profile.sub, ip: meta.ip, userAgent: meta.userAgent });
    return {
      kind: "session",
      token: await signSession(
        { sub: profile.sub, phone: null, userId: doctorId, name: profile.name, picture: profile.picture },
        secret,
      ),
    };
  }
  const binding = await findFreshBinding(pool, profile.sub);
  if (binding && (await isAuthorizedPhone(binding.phone))) {
    await touchBinding(pool, profile.sub, profile.name);
    await logEvent(pool, {
      event: "login_binding",
      sub: profile.sub,
      phone: binding.phone,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      kind: "session",
      token: await signSession(
        { sub: profile.sub, phone: binding.phone, userId: null, name: profile.name, picture: profile.picture },
        secret,
      ),
    };
  }
  return { kind: "pending", token: await signPending({ sub: profile.sub, name: profile.name, picture: profile.picture, next }, secret) };
}
