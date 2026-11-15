"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { refreshDeadline } from "@/lib/refresh-deadline";

/** A tab hidden this long has a stale board when it comes back (a phone in a pocket, LINE in the background). */
const STALE_AFTER_MS = 5 * 60_000;
/** The board's own turnover is never refreshed sooner than this, so a server clock held still in a test cannot loop. */
const MIN_DELAY_MS = 5_000;
/** Refresh a moment after the turnover, so the server is surely past it. */
const MARGIN_MS = 1_000;
/** Timers sleep with the phone, so the deadline is checked again at least this often against the wall clock. */
const CHECK_EVERY_MS = 60_000;

/**
 * Reloads the page's server data by itself (router.refresh(): the page and its state stay as they are) once the
 * server's next change is due, and when the tab comes back after more than 5 minutes hidden. The board and the
 * upload page use it.
 *
 * The server hands over how long until that change by its own clock (lib/clock.ts), not the moment itself, so a phone
 * whose clock is off still refreshes on time, and an id of its render: the wait counts from when this browser first saw
 * that render (lib/refresh-deadline.ts), so a page brought back by Back or Forward, which comes from the router's cache
 * with its old props, refreshes at once if its moment has passed instead of waiting the whole delay again.
 */
export function useTimedRefresh(renderId: string, delayMs: number) {
  const router = useRouter();

  useEffect(() => {
    const deadline = refreshDeadline(renderId, Math.max(delayMs + MARGIN_MS, MIN_DELAY_MS));
    let timer: number | undefined;
    let sent = false;
    const refresh = () => {
      sent = true;
      window.clearTimeout(timer);
      startTransition(() => router.refresh());
    };
    const tick = () => {
      if (sent) return;
      const left = deadline - Date.now();
      if (left <= 0) {
        refresh();
        return;
      }
      timer = window.setTimeout(tick, Math.min(left, CHECK_EVERY_MS));
    };
    tick();

    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > STALE_AFTER_MS) {
        refresh();
        return;
      }
      // A timer may have slept with the phone past the deadline: look again now.
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // A refresh renders the page again with a new id and the next delay, which starts a new timer.
  }, [renderId, delayMs, router]);
}

/**
 * The board's own refresh: at 16:00 in Bangkok, when the board turns over to the next workday, and at midnight
 * (lib/board-day.ts nextBoardRefresh), and when the tab comes back after more than 5 minutes hidden. Renders nothing.
 */
export function BoardRefresh({ renderId, delayMs }: { renderId: string; delayMs: number }) {
  useTimedRefresh(renderId, delayMs);
  return null;
}
