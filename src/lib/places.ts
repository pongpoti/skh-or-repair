/**
 * The hospitals the app opens (Pong, 26 Nov 2026: "Now there are 2 places to operate: รพ สมุทรสาคร and รพ ท่าฉลอม"):
 * รพ.สมุทรสาคร's board at `/skh`, รพ.ท่าฉลอม's at `/tha-chalom`, a switch between them in both bars. The app opens on
 * รพ.สมุทรสาคร's (Pong, 27 Nov 2026: "No more card selection. Default select is สมุทรสาคร"): `/` goes there.
 */
export type PlaceId = "skh" | "tha-chalom";

export type Place = {
  id: PlaceId;
  /** As Pong wrote it, with the usual full stop of รพ. */
  name: string;
  href: string;
};

/** รพ.สมุทรสาคร's board (it was `/` until 26 Nov 2026), where the app opens: `/` and every sign-in go on to it. */
export const BOARD_PATH = "/skh";
/** รพ.ท่าฉลอม: its board, the weekly table on its OR suite's plan (components/tha-chalom-board.tsx). */
export const THA_CHALOM_PATH = "/tha-chalom";

export const PLACES: readonly Place[] = [
  { id: "skh", name: "รพ.สมุทรสาคร", href: BOARD_PATH },
  { id: "tha-chalom", name: "รพ.ท่าฉลอม", href: THA_CHALOM_PATH },
];

/**
 * A hospital's board from the other's bar (Pong, 26 Nov 2026: "Try create seamless navigation between 2 places"): the
 * same day when one was picked in the calendar or by a swipe (`?date=`, which the other board takes if it offers that
 * day), else the plain address, whose own day is the same at both (lib/board-day.ts, 16:00 turnover).
 */
export function placeHref(href: string, pickedDate: string | null): string {
  return pickedDate ? `${href}?date=${pickedDate}` : href;
}

/** The board's own address keys (a room, a day, the admins' test modes). */
const BOARD_KEYS = ["room", "date", "demo", "sim", "half", "notices"] as const;

/**
 * Where `/` goes: รพ.สมุทรสาคร's board. An address of the board from before 26 Nov 2026, `/?date=…` or `/?room=…` (a
 * link kept in a chat, a bookmark), keeps its query there; anything else (`/?utm_source=line`) is the plain board.
 */
export function homeHref(search: Record<string, string | string[] | undefined>): string {
  if (!BOARD_KEYS.some((key) => search[key] !== undefined)) return BOARD_PATH;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  return `${BOARD_PATH}?${query.toString()}`;
}
