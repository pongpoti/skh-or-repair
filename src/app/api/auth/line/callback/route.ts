import { NextResponse, type NextRequest } from "next/server";
import { lineSignIn } from "@/lib/auth/line-signin";
import { clearCookie, cookieName, setCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { appUrl, ConfigError, lineConfig, sessionSecret } from "@/lib/env";
import { redirectToError, type ErrorCode } from "@/lib/http";
import { GATE_PATH, clientAllowed, gateMode } from "@/lib/gate";
import { exchangeCode, LineAuthError, verifyIdToken } from "@/lib/line";
import { clientIp, safeEqual, safeNextPath, userAgent } from "@/lib/security";
import { openTx } from "@/lib/tokens";

function fail(req: NextRequest, code: ErrorCode): NextResponse {
  const res = redirectToError(req, code);
  try {
    clearCookie(res, "tx");
  } catch {
    // APP_URL missing: no cookie could have been set
  }
  return res;
}

/** LINE redirects here with ?code&state (or ?error). Only inside the LIFF app (the proxy checks too). */
export async function GET(req: NextRequest) {
  if (!clientAllowed(req.headers.get("user-agent"), gateMode())) {
    return NextResponse.redirect(new URL(GATE_PATH, req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "no-store" } });
  }
  const q = req.nextUrl.searchParams;
  try {
    const cfg = lineConfig();
    const secret = sessionSecret();
    const origin = appUrl().origin;

    const tx = await openTx(req.cookies.get(cookieName("tx"))?.value, secret);
    const state = q.get("state") ?? "";
    const stateOk = tx !== null && state.length > 0 && safeEqual(state, tx.state);

    if (q.get("error")) {
      // access_denied = user cancelled on the LINE consent screen
      return fail(req, stateOk && q.get("error") === "access_denied" ? "cancelled" : "line");
    }
    if (!tx || !stateOk) return fail(req, "state");
    const code = q.get("code");
    if (!code || code.length > 512) return fail(req, "line");

    const idToken = await exchangeCode(cfg, code, tx.verifier);
    const profile = await verifyIdToken(cfg, idToken, tx.nonce);
    const next = safeNextPath(tx.next);

    let pool;
    try {
      pool = await db();
    } catch (e) {
      if (e instanceof ConfigError) throw e;
      console.error("[auth] database unavailable:", (e as Error).message);
      return fail(req, "config");
    }
    const result = await lineSignIn(pool, profile, next, secret, { ip: clientIp(req.headers), userAgent: userAgent(req.headers) });
    // Signed in, or: prove a mobile number first (then sign in, or request access if it is not authorized), or, for a
    // doctor, their name by an email code (/login/doctor, linked from /login/verify).
    const res = NextResponse.redirect(new URL(result.kind === "session" ? next : "/login/verify", origin), 303);
    res.headers.set("Cache-Control", "no-store");
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
      console.error("[auth] LINE callback not configured:", e.names.join(", "));
      return fail(req, "config");
    }
    if (e instanceof LineAuthError) {
      console.error("[auth] LINE verification failed:", e.message);
      return fail(req, "line");
    }
    console.error("[auth] LINE callback failed:", (e as Error).message);
    return fail(req, "failed");
  }
}
