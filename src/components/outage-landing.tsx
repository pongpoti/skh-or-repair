"use client";

import { useEffect } from "react";
import { AuthShell, Notice } from "@/components/auth-shell";
import { OUTAGE_TEXT, type OutageReason } from "@/lib/unavailable";

/**
 * The outage landing page (Pong, 17 Nov 2026): the app's card with what went wrong in Thai and one "ลองอีกครั้ง" button
 * back to the page that failed. Used by /unavailable, the error boundaries and, while the device is offline, the
 * connection watch (which cannot load a new page, so it shows this over the current one). With no connection it goes
 * back by itself as soon as the device is online again.
 */
export function OutageLanding({ reason, retryHref }: { reason: OutageReason; retryHref: string }) {
  const text = OUTAGE_TEXT[reason];

  useEffect(() => {
    if (reason !== "network") return;
    const back = () => window.location.replace(retryHref);
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [reason, retryHref]);

  return (
    <AuthShell title={text.title} description={text.description}>
      <div className="space-y-4" data-testid="outage" data-reason={reason}>
        <div className="flex justify-center" aria-hidden="true">
          <OutageGlyph reason={reason} />
        </div>
        <Notice tone={reason === "network" ? "info" : "warning"} role="alert">
          {text.hint}
        </Notice>
        {/* A full page load, not a client navigation: the page that failed is fetched afresh. */}
        <a className="btn btn-primary min-h-12 w-full" href={retryHref} data-testid="outage-retry">
          ลองอีกครั้ง
        </a>
      </div>
    </AuthShell>
  );
}

/** A server with a slash (server) or a wifi fan with a slash (network), in the alert red of the no-table icon. */
function OutageGlyph({ reason }: { reason: OutageReason }) {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {reason === "server" ? (
        <>
          <rect x="3" y="3" width="18" height="7" rx="2" fill="#fff" />
          <rect x="3" y="14" width="18" height="7" rx="2" fill="#fff" />
          <path d="M7 6.5h.01M7 17.5h.01" />
        </>
      ) : (
        <>
          <path d="M5 12.5a10 10 0 0 1 14 0" />
          <path d="M8.5 16a5 5 0 0 1 7 0" />
          <path d="M2 9a15 15 0 0 1 20 0" />
          <path d="M12 19.5h.01" />
        </>
      )}
      <path d="M2.5 2.5 21.5 21.5" stroke="#fff" strokeWidth="4.5" />
      <path d="M2.5 2.5 21.5 21.5" />
    </svg>
  );
}
