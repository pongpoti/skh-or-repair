import "server-only";
import { doctorAccess, phoneAccess, type Access } from "../authz";
import { sessionSecret } from "../env";
import { verifySession, type SessionUser } from "../tokens";

export type { SessionUser };

/**
 * A session cookie checked: the user, or null with why. `unavailable` means the token is valid but the database could
 * not say whether its number or email claim still holds a name (an outage): nobody is let in, but the caller shows the
 * outage page and keeps the cookie instead of signing the user out (Pong, 17 Nov 2026).
 */
export type SessionCheck = { user: SessionUser; unavailable: false } | { user: null; unavailable: boolean };

export async function checkSession(token: string | undefined): Promise<SessionCheck> {
  const none = { user: null, unavailable: false } as const;
  if (!token) return none;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return none;
  }
  const user = await verifySession(token, secret);
  if (!user) return none;
  let access: Access = "no";
  if (user.userId) access = await doctorAccess(user.userId, user.sub);
  else if (user.phone) access = await phoneAccess(user.phone);
  if (access === "yes") return { user, unavailable: false };
  return { user: null, unavailable: access === "unknown" };
}

/**
 * Authoritative session check: valid signed JWT AND the phone number is still authorized
 * (a claimed name on the users list or ALLOWED_PHONES; see lib/authz.ts), or, for a
 * doctor signed in by email, this LINE account still holds the doctor's (active) name.
 */
export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  return (await checkSession(token)).user;
}
