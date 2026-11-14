import type { NextRequest } from "next/server";
import { lineSignIn } from "@/lib/auth/line-signin";
import { clearCookie, setCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { ConfigError, lineConfig, sessionSecret } from "@/lib/env";
import { clientAllowed, gateMode } from "@/lib/gate";
import { guardPost, json, MSG } from "@/lib/http";
import { LineAuthError, verifyIdToken } from "@/lib/line";
import { clientIp, safeNextPath, userAgent } from "@/lib/security";

/**
 * Sign-in inside the LIFF app without leaving it: the page calls liff.init() (LINE has already signed the user in to
 * the LIFF app) and posts liff.getIDToken() here. LINE's verify endpoint checks the token is LINE's, for this channel
 * (LINE_CHANNEL_ID, the LINE Login channel the LIFF app belongs to) and unexpired; then the same rules as the web
 * callback decide between a session and the mobile-number step.
 *
 * Why not LINE Login's web redirect: inside the LIFF browser, leaving for access.line.me makes LINE show "This is an
 * external page..." over the app, and LINE does not guarantee web authorization requests there.
 *
 * Any failure answers { fallback: true }: the page then falls back to the web redirect (/api/auth/line/start).
 */
export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;
  if (!clientAllowed(req.headers.get("user-agent"), gateMode())) {
    return json({ error: "open-in-line" }, 403);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: MSG.badRequest, fallback: true }, 400);
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const idToken = b.idToken;
  if (typeof idToken !== "string" || idToken.length < 10 || idToken.length > 8192) {
    return json({ error: MSG.badRequest, fallback: true }, 400);
  }
  const next = safeNextPath(typeof b.next === "string" ? b.next : undefined);

  try {
    const cfg = lineConfig();
    const secret = sessionSecret();
    const profile = await verifyIdToken(cfg, idToken, null);
    const pool = await db();
    const result = await lineSignIn(pool, profile, next, secret, { ip: clientIp(req.headers), userAgent: userAgent(req.headers) });
    const res = json({ ok: true, redirect: result.kind === "session" ? next : "/login/verify" });
    clearCookie(res, "tx");
    if (result.kind === "session") {
      clearCookie(res, "pending");
      clearCookie(res, "access");
      setCookie(res, "session", result.token);
    } else {
      setCookie(res, "pending", result.token);
    }
    return res;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("[auth] LIFF sign-in not configured:", e.names.join(", "));
      return json({ error: MSG.notReady, fallback: true }, 503);
    }
    if (e instanceof LineAuthError) {
      // e.g. "unexpected aud": the LIFF app is in a different LINE Login channel from LINE_CHANNEL_ID
      console.error("[auth] LIFF ID token rejected:", e.message);
      return json({ error: MSG.failed, fallback: true }, 401);
    }
    console.error("[auth] LIFF sign-in failed:", (e as Error).message);
    return json({ error: MSG.failed, fallback: true }, 500);
  }
}
