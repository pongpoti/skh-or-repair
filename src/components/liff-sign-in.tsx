"use client";

import { useEffect, useRef } from "react";

/**
 * LINE sign-in inside the LIFF app, without leaving it and without a button: liff.init() (LINE has already signed the
 * user in to the LIFF app), then liff.getIDToken() goes to POST /api/auth/line/liff, which answers where to go next
 * (the board, or the mobile-number step). Leaving for LINE Login's web page (access.line.me) instead makes the LIFF
 * browser show "This is an external page..." over the app.
 *
 * It starts as soon as the page loads and shows only that it is signing in. Anything that goes wrong falls back to the
 * web redirect, GET /api/auth/line/start, which still works, popup and all.
 */
export function LiffSignIn({ liffId, next }: { liffId: string; next: string }) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const webLogin = next === "/" ? "/api/auth/line/start" : `/api/auth/line/start?next=${encodeURIComponent(next)}`;
    void (async () => {
      try {
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId });
        const idToken = liff.isLoggedIn() ? liff.getIDToken() : null;
        if (!idToken) throw new Error("no LIFF ID token (is openid among the LIFF app's scopes?)");
        const res = await fetch("/api/auth/line/liff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken, next }),
        });
        const body = (await res.json().catch(() => null)) as { redirect?: unknown } | null;
        if (!res.ok || typeof body?.redirect !== "string" || !body.redirect.startsWith("/") || body.redirect.startsWith("//")) {
          throw new Error(`LIFF sign-in answered ${res.status}`);
        }
        window.location.replace(body.redirect);
      } catch (e) {
        console.warn("[liff] falling back to LINE Login:", (e as Error).message);
        window.location.assign(webLogin);
      }
    })();
  }, [liffId, next]);

  return (
    <div role="status" className="flex flex-col items-center gap-3 py-1 text-sm text-muted" data-testid="liff-signing-in">
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-line-strong border-t-brand motion-reduce:animate-none"
      />
      กำลังเข้าสู่ระบบ…
    </div>
  );
}
