import { NextResponse, type NextRequest } from "next/server";
import { setCookie } from "@/lib/cookies";
import { ConfigError, lineConfig, sessionSecret } from "@/lib/env";
import { GATE_PATH, clientAllowed, gateMode } from "@/lib/gate";
import { redirectToError } from "@/lib/http";
import { buildAuthorizeUrl, createPkce } from "@/lib/line";
import { randomToken, safeNextPath } from "@/lib/security";
import { sealTx } from "@/lib/tokens";

/** Starts LINE Login (OAuth 2.1 code flow + PKCE S256 + nonce). Only inside the LIFF app (the proxy checks too). */
export async function GET(req: NextRequest) {
  if (!clientAllowed(req.headers.get("user-agent"), gateMode())) {
    return NextResponse.redirect(new URL(GATE_PATH, req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const cfg = lineConfig();
    const secret = sessionSecret();
    const state = randomToken(32);
    const nonce = randomToken(32);
    const { verifier, challenge } = createPkce();
    const next = safeNextPath(req.nextUrl.searchParams.get("next"));
    const tx = await sealTx({ state, nonce, verifier, next }, secret);
    const res = NextResponse.redirect(buildAuthorizeUrl(cfg, { state, nonce, challenge }), 302);
    res.headers.set("Cache-Control", "no-store");
    setCookie(res, "tx", tx);
    return res;
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error("[auth] LINE login not configured:", e.names.join(", "));
      return redirectToError(req, "config");
    }
    console.error("[auth] LINE start failed:", (e as Error).message);
    return redirectToError(req, "failed");
  }
}
