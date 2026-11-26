import { ROOMS } from "@/lib/rooms";

/**
 * The hospitals the app opens (Pong, 26 Nov 2026: "Now there are 2 places to operate: รพ สมุทรสาคร and รพ ท่าฉลอม ...
 * When user sign in, display two place cards to allow user to first select place"). The app's first page (`/`) is the
 * choice; รพ.สมุทรสาคร's board moved to `/skh`, and รพ.ท่าฉลอม shows only its OR suite's plan for now ("Just simply show
 * layout. Do nothing for now").
 */
export type PlaceId = "skh" | "tha-chalom";

export type Place = {
  id: PlaceId;
  /** As Pong wrote it, with the usual full stop of รพ. */
  name: string;
  /** The line under the name on its card. */
  detail: string;
  href: string;
};

/** The page that asks which hospital: where a sign-in lands, and the app's address. */
export const PLACES_PATH = "/";
/** รพ.สมุทรสาคร's board (it was `/` until 26 Nov 2026). */
export const BOARD_PATH = "/skh";
/** รพ.ท่าฉลอม: its board, the weekly table on its OR suite's plan (components/tha-chalom-board.tsx). */
export const THA_CHALOM_PATH = "/tha-chalom";

/** The OR rooms on รพ.ท่าฉลอม's plan. */
export const THA_CHALOM_ROOMS = 4;

export const PLACES: readonly Place[] = [
  { id: "skh", name: "รพ.สมุทรสาคร", detail: `ห้องผ่าตัด ${ROOMS.filter((room) => room.kind === "or").length} ห้อง`, href: BOARD_PATH },
  { id: "tha-chalom", name: "รพ.ท่าฉลอม", detail: `ห้องผ่าตัด ${THA_CHALOM_ROOMS} ห้อง`, href: THA_CHALOM_PATH },
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
 * Where an address of the board from before 26 Nov 2026 goes now: `/?date=…` or `/?room=…` (a link kept in a chat, a
 * bookmark) is the same board at `/skh`, with its query. Null for the plain `/`, which asks for the hospital.
 */
export function movedBoardHref(search: Record<string, string | string[] | undefined>): string | null {
  if (!BOARD_KEYS.some((key) => search[key] !== undefined)) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, one);
  }
  return `${BOARD_PATH}?${query.toString()}`;
}
