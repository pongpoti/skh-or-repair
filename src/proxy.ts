import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";
import { isCalendarApiPath } from "@/lib/calendar-api-path";
import { checkSession } from "@/lib/auth/user";
import { db } from "@/lib/db";
import { cookieName, cookieOptions } from "@/lib/cookies";
import { appUrl } from "@/lib/env";
import { DESK_ONLY_PATH, GATE_PATH, clientAllowed, gateMode, needsDeskRole } from "@/lib/gate";
import { isMx } from "@/lib/roles";
import { isSameOrigin, safeNextPath } from "@/lib/security";
import { TELEGRAM_WEBHOOK_PATH } from "@/lib/telegram";
import { UNAVAILABLE_PATH, unavailablePath } from "@/lib/unavailable";

/**
 * Runs before every request except static build assets and a few public files (see matcher):
 * 1. canonical-host redirect (production only)
 * 2. CSRF origin check for non-GET requests
 * 3. per-request CSP nonce
 * 4. device gate (lib/gate.ts): on Vercel, a phone outside the LIFF app in LINE (or a client that is no browser) gets
 *    the "open in LINE" page for every page and 403 for every API call, before the sign-in gate. Computers and tablets
 *    pass. The Telegram webhook, the calendar API (lib/calendar-api-path.ts) and /preview* are exempt.
 * 5. auth gate: everything except /login*, /api/auth/*, the Telegram webhook, the calendar API, /unavailable and /preview*
 *    needs a valid
 *    session (pages ALSO verify the session themselves; this is the first line, not the only one). The /preview pages
 *    answer 404 unless NODE_ENV is development. When the database cannot check a valid session (an outage), a page goes
 *    to the outage page /unavailable (lib/unavailable.ts) and an API call gets 503; the cookie is kept, so the user is
 *    still signed in once the database is back.
 * 6. computer gate: on a computer or tablet (lib/gate.ts needsDeskRole) only MX and admins get the board (Pong, 17 Nov
 *    2026). Anyone else gets the /desktop-only page (signed out there, so the next person at a shared computer can
 *    sign in) and 403 for every API call. A phone in the LIFF app is not checked.
 * 7. admin gate: /admin* answers the mistyped-address 404 to a session whose sub is not in AUTH_ADMIN_LINE_IDS, before
 *    anything renders (the page's own check runs behind its loading screen, whose response is already a 200).
 * The Telegram webhook and the calendar API are server-to-server (no Origin, no session): the webhook's route checks
 * Telegram's secret header, the calendar API's its bearer key (lib/calendar-api.ts). Both are exempt by exact path only.
 */

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === TELEGRAM_WEBHOOK_PATH ||
    isCalendarApiPath(pathname) ||
    pathname === GATE_PATH ||
    pathname === DESK_ONLY_PATH ||
    pathname === UNAVAILABLE_PATH ||
    pathname === "/preview" ||
    pathname.startsWith("/preview/")
  );
}

function buildCsp(nonce: string, isDev: boolean, https: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://profile.line-scdn.net https://*.line-scdn.net",
    "font-src 'self'",
    // LINE's APIs for the LIFF SDK (liff.init() in components/liff-sign-in.tsx)
    `connect-src 'self' https://api.line.me https://access.line.me https://liffsdk.line-scdn.net${isDev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    "form-action 'self' https://access.line.me",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function withCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  let app: URL | null = null;
  try {
    app = appUrl();
  } catch {
    app = null; // misconfigured: nothing below can authenticate anyone
  }

  // 1. Canonical host (e.g. a deployment URL -> APP_URL).
  //    Target is always APP_URL's origin + the same path, so this is not an open redirect.
  if (app && process.env.VERCEL_ENV === "production" && req.headers.get("host") !== app.host) {
    // Path/query are assigned on a URL fixed to APP_URL's origin; leading "//" is collapsed so
    // the Location can never become protocol-relative (Next may relativize same-host redirects).
    const target = new URL(app.origin);
    target.pathname = pathname.replace(/^\/{2,}/, "/");
    target.search = search;
    return NextResponse.redirect(target, 308);
  }

  // 2. CSRF: any state-changing method must come from our own origin (except the server-to-server calls: Telegram's
  //    webhook and the calendar API, whose routes check their own secret).
  const method = req.method.toUpperCase();
  const serverToServer = pathname === TELEGRAM_WEBHOOK_PATH || isCalendarApiPath(pathname);
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !serverToServer) {
    if (!app || !isSameOrigin(req.headers, app.origin)) {
      return NextResponse.json({ error: app ? "ทำรายการไม่สำเร็จ โหลดหน้าใหม่แล้วลองอีกครั้ง" : "ระบบยังไม่พร้อม ติดต่อผู้ดูแล" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  // 3. CSP nonce, forwarded to Next.js via the request header so it nonces its own scripts.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development", app?.protocol === "https:");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // The address asked for, for the outage page's "try again" (requestPath() in lib/auth/server.ts). Always set here, so
  // a value sent by the browser never gets through.
  requestHeaders.set("x-orskh-path", safeNextPath(`${pathname}${search}`));

  // 4. Device gate: the LIFF app in LINE on a phone, or a computer or tablet browser. Runs before the sign-in gate, so a
  //    phone browser outside LINE never reaches the LINE login. The answer depends on the User-Agent, so it must not be
  //    cached across browsers.
  const gateExempt = serverToServer || pathname === GATE_PATH || pathname === "/preview" || pathname.startsWith("/preview/");
  if (!gateExempt && !clientAllowed(req.headers.get("user-agent"), gateMode())) {
    const headers = { "Cache-Control": "no-store", Vary: "User-Agent" };
    if (pathname.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "open-in-line" }, { status: 403, headers }), csp);
    }
    const res = NextResponse.rewrite(new URL(GATE_PATH, req.nextUrl.origin), { request: { headers: requestHeaders } });
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return withCsp(res, csp);
  }

  // 5. Auth gate (covers documents, RSC/flight and prefetch requests alike).
  if (!isPublicPath(pathname)) {
    let sessionCookie: string | null = null;
    try {
      sessionCookie = cookieName("session");
    } catch {
      sessionCookie = null;
    }
    const { user, unavailable } = sessionCookie
      ? await checkSession(req.cookies.get(sessionCookie)?.value)
      : { user: null, unavailable: false };
    if (!user && unavailable) {
      if (pathname.startsWith("/api/")) {
        return withCsp(
          NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
          csp,
        );
      }
      const res = NextResponse.redirect(new URL(unavailablePath("server", safeNextPath(`${pathname}${search}`)), req.nextUrl.origin), 307);
      res.headers.set("Cache-Control", "no-store");
      return withCsp(res, csp);
    }
    if (!user) {
      if (pathname.startsWith("/api/")) {
        return withCsp(
          NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } }),
          csp,
        );
      }
      const login = new URL("/login", req.nextUrl.origin);
      const next = safeNextPath(`${pathname}${search}`);
      if (next !== "/") login.searchParams.set("next", next);
      const res = NextResponse.redirect(login, 307);
      res.headers.set("Cache-Control", "no-store");
      if (sessionCookie && req.cookies.has(sessionCookie)) {
        res.cookies.set(sessionCookie, "", { ...cookieOptions("session"), maxAge: 0 });
      }
      return withCsp(res, csp);
    }

    // 6. Computer gate: MX and admins only. The role is read from the database on every request from a computer (few
    //    people, and a removed MX loses it at once); a database that cannot answer is an outage, as above.
    if (needsDeskRole(req.headers.get("user-agent"), gateMode()) && !isAdmin(user.sub)) {
      let mx: boolean | null;
      try {
        mx = await isMx(await db(), user);
      } catch (e) {
        console.error("[gate] MX check failed:", (e as Error).message);
        mx = null;
      }
      if (mx === null) {
        if (pathname.startsWith("/api/")) {
          return withCsp(
            NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }),
            csp,
          );
        }
        const res = NextResponse.redirect(new URL(unavailablePath("server", safeNextPath(`${pathname}${search}`)), req.nextUrl.origin), 307);
        res.headers.set("Cache-Control", "no-store");
        return withCsp(res, csp);
      }
      if (!mx) {
        const headers = { "Cache-Control": "no-store", Vary: "User-Agent" };
        const res = pathname.startsWith("/api/")
          ? NextResponse.json({ error: "desktop-mx-only" }, { status: 403, headers })
          : NextResponse.rewrite(new URL(DESK_ONLY_PATH, req.nextUrl.origin), { request: { headers: requestHeaders } });
        for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
        if (sessionCookie) res.cookies.set(sessionCookie, "", { ...cookieOptions("session"), maxAge: 0 });
        return withCsp(res, csp);
      }
    }

    // 7. Admin gate: a path no route matches, so Next answers its own 404 page with status 404.
    if ((pathname === "/admin" || pathname.startsWith("/admin/")) && !isAdmin(user.sub)) {
      return withCsp(NextResponse.rewrite(new URL("/_admin-not-found", req.nextUrl), { request: { headers: requestHeaders } }), csp);
    }
  }

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
}

export const config = {
  matcher: [
    // Everything except build assets and public files that must load on the login page.
    // No "missing: next-router-prefetch" exclusion: prefetch/RSC requests are gated too.
    // (_next/webpack-hmr and __nextjs_* exist only in `next dev`.)
    "/((?!_next/static/|_next/image|_next/webpack-hmr|__nextjs_|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$|robots\\.txt$).*)",
  ],
};
