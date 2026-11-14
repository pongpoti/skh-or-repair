"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const LINE_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 3C6.5 3 2 6.6 2 11.1c0 4 3.6 7.4 8.5 8l.6 2.2c.1.4.6.4.8.1l2.4-2.1c3.8-.7 6.7-3.7 6.7-7.2C21 6.6 16.5 3 12 3z"
    />
  </svg>
);

/**
 * LINE sign-in inside the LIFF app, without leaving it: liff.init() (LINE has already signed the user in to the LIFF
 * app), then liff.getIDToken() goes to POST /api/auth/line/liff, which answers where to go next (the board, or the
 * mobile-number step). Leaving for LINE Login's web page (access.line.me) instead makes the LIFF browser show
 * "This is an external page..." over the app.
 *
 * `auto` starts at once (opened from the rich menu); otherwise it waits for the button (after signing out). Anything
 * that goes wrong falls back to the web redirect, GET /api/auth/line/start, which still works, popup and all.
 */
export function LiffSignIn({ liffId, next, auto }: { liffId: string; next: string; auto: boolean }) {
  const [busy, setBusy] = useState(auto);
  const started = useRef(false);
  const webLogin = next === "/" ? "/api/auth/line/start" : `/api/auth/line/start?next=${encodeURIComponent(next)}`;

  const signIn = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setBusy(true);
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
  }, [liffId, next, webLogin]);

  useEffect(() => {
    if (auto) void signIn();
  }, [auto, signIn]);

  return (
    <button
      type="button"
      onClick={() => void signIn()}
      disabled={busy}
      data-testid="line-login"
      className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#05B14C] px-4 py-3 text-[1.0625rem] font-bold text-white shadow-[0_1px_2px_rgb(0_0_0/0.1),inset_0_1px_0_rgb(255_255_255/0.2)] transition duration-150 ease-out hover:bg-[#049A42] active:translate-y-px disabled:cursor-default disabled:opacity-80"
    >
      {LINE_ICON}
      {busy ? "กำลังเข้าสู่ระบบด้วย LINE…" : "เข้าสู่ระบบด้วย LINE"}
    </button>
  );
}
