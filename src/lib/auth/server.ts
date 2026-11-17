import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cookieName } from "../cookies";
import { sessionSecret } from "../env";
import { verifyAccess, verifyPending, type AccessGrant, type PendingLogin } from "../tokens";
import { unavailablePath } from "../unavailable";
import { checkSession, type SessionUser } from "./user";

function name(kind: "session" | "pending" | "access"): string | null {
  try {
    return cookieName(kind);
  } catch {
    return null; // APP_URL missing: nobody is signed in
  }
}

/** Current user (deduplicated per request). Reading cookies makes the route dynamic. */
const session = cache(async () => {
  const jar = await cookies();
  const n = name("session");
  return n ? checkSession(jar.get(n)?.value) : { user: null, unavailable: false };
});

export const getUser = cache(async (): Promise<SessionUser | null> => (await session()).user);

/**
 * The address this request is for (path and query), as the proxy passed it on (x-orskh-path), for the outage page's
 * "try again". "/" when it is missing.
 */
export async function requestPath(): Promise<string> {
  return (await headers()).get("x-orskh-path") ?? "/";
}

/**
 * Use at the top of EVERY protected page (and layout). Layouts alone are not enough:
 * they are not re-rendered on client navigation. A database that cannot check the session sends the user to the outage
 * page (lib/unavailable.ts), not to sign in again.
 */
export async function requireUser(): Promise<SessionUser> {
  const { user, unavailable } = await session();
  if (user) return user;
  if (unavailable) redirect(unavailablePath("server", await requestPath()));
  redirect("/login");
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const jar = await cookies();
  const n = name("pending");
  if (!n) return null;
  try {
    return await verifyPending(jar.get(n)?.value, sessionSecret());
  } catch {
    return null;
  }
}

/** Verified-but-not-authorized phone number of this browser (set by /api/auth/otp/verify), or null. */
export async function getAccessGrant(): Promise<AccessGrant | null> {
  const jar = await cookies();
  const n = name("access");
  if (!n) return null;
  try {
    return await verifyAccess(jar.get(n)?.value, sessionSecret());
  } catch {
    return null;
  }
}
