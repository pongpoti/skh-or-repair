/**
 * When a page's own refresh is due, by the browser's clock (components/board-refresh.tsx).
 *
 * The server says how long until its page next changes (16:00, midnight, the upload window), by its own clock (the
 * tests set it), together with an id of that render. The wait is counted from the moment this browser first saw that
 * render, not from when the component mounted: Back and Forward bring a page back from the router's cache with the
 * props it was rendered with, so a board rendered at 15:05 and brought back at 16:05 must refresh at once, not wait
 * the 55 minutes again. Isomorphic and pure apart from the remembered times.
 */

/** Renders remembered; a page sees one per refresh or navigation, so this covers far more than the router keeps. */
const REMEMBERED = 50;

const firstSeen = new Map<string, number>();

/** The browser time at which the render `renderId`, due `delayMs` after it was made, should be refreshed. */
export function refreshDeadline(renderId: string, delayMs: number, now: number = Date.now()): number {
  let seen = firstSeen.get(renderId);
  if (seen === undefined) {
    seen = now;
    firstSeen.set(renderId, seen);
    // The oldest goes first (a Map keeps insertion order).
    if (firstSeen.size > REMEMBERED) firstSeen.delete(firstSeen.keys().next().value as string);
  }
  return seen + delayMs;
}
