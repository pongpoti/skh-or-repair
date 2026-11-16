import "server-only";
import type { NextResponse } from "next/server";
import { secureCookies } from "./env";
import { isLineApp } from "./gate";
import { ACCESS_TTL_S, BROWSER_SESSION_TTL_S, PENDING_TTL_S, SESSION_TTL_S, TX_TTL_S } from "./tokens";

export type CookieKind = "session" | "pending" | "tx" | "access";

const BASE: Record<CookieKind, string> = { session: "session", pending: "pending", tx: "line-tx", access: "access" };
const TTL: Record<CookieKind, number> = {
  session: SESSION_TTL_S,
  pending: PENDING_TTL_S,
  tx: TX_TTL_S,
  access: ACCESS_TTL_S,
};

/** "__Host-session" on https; plain "session" on http://localhost so local tests work. */
export function cookieName(kind: CookieKind, secure = secureCookies()): string {
  return secure ? `__Host-${BASE[kind]}` : BASE[kind];
}

export function cookieOptions(kind: CookieKind, secure = secureCookies()) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: TTL[kind] };
}

export function setCookie(res: NextResponse, kind: CookieKind, value: string): void {
  const secure = secureCookies();
  res.cookies.set(cookieName(kind, secure), value, cookieOptions(kind, secure));
}

/**
 * How long a sign-in on this device lasts: 30 days in the LINE app, which is each person's own phone; 12 hours in any
 * other browser (a computer or tablet, often one the OR shares), so the next person at it is not let in as the last.
 */
export function sessionTtlFor(userAgent: string): number {
  return isLineApp(userAgent) ? SESSION_TTL_S : BROWSER_SESSION_TTL_S;
}

/**
 * Sets the session cookie for the device that signed in. In the LINE app it is kept for 30 days; in any other browser it
 * has no Max-Age, so it ends when the browser closes (and the token inside ends after 12 hours in any case).
 */
export function setSessionCookie(res: NextResponse, token: string, userAgent: string): void {
  const secure = secureCookies();
  const { maxAge, ...rest } = cookieOptions("session", secure);
  res.cookies.set(cookieName("session", secure), token, isLineApp(userAgent) ? { ...rest, maxAge } : rest);
}

export function clearCookie(res: NextResponse, kind: CookieKind): void {
  const secure = secureCookies();
  res.cookies.set(cookieName(kind, secure), "", { ...cookieOptions(kind, secure), maxAge: 0 });
}
