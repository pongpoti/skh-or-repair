import "server-only";
import { isAuthorizedDoctor, isAuthorizedPhone } from "../authz";
import { sessionSecret } from "../env";
import { verifySession, type SessionUser } from "../tokens";

export type { SessionUser };

/**
 * Authoritative session check: valid signed JWT AND the phone number is still authorized
 * (a claimed name on the users list, an approved access request, or ALLOWED_PHONES; see lib/authz.ts), or, for a
 * doctor signed in by email, this LINE account still holds the doctor's (active) name.
 */
export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  let secret: string;
  try {
    secret = sessionSecret();
  } catch {
    return null;
  }
  const user = await verifySession(token, secret);
  if (!user) return null;
  if (user.userId) return (await isAuthorizedDoctor(user.userId, user.sub)) ? user : null;
  return user.phone && (await isAuthorizedPhone(user.phone)) ? user : null;
}
