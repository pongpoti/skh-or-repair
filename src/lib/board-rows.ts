import { NO_OPERATION_LABEL, bookedRoom, type AddedCase } from "./added-cases.ts";
import { DEPARTMENTS, type DeptCode } from "./allocation.ts";
import { normalizeHn } from "./hn.ts";
import { isDressingCase, placeAll, roomsHeldBy, type RoomChoice } from "./placement.ts";
import type { RepairPeriods } from "./repair.ts";
import { roomUse } from "./rooms.ts";
import type { CaseStatus, Operation, Shift } from "./schedule.ts";
import { subtypeLabel } from "./user-labels.ts";

/**
 * The board's case rows during the repair: the HOSxP workbook's cases (the latest upload of the cycle,
 * lib/workbook-store.ts) and the doctors' bookings (lib/cases.ts), matched one to one by HN. Pure and isomorphic; the
 * server page builds the rows and hands the client only what the viewer may see (an HN only to the doctor who booked
 * the case, MX and admins).
 */

/** Where a row comes from: the workbook alone, a booking alone, or a workbook case that matches a booking. */
export type RowSource = "hosxp" | "booking" | "matched";

/**
 * A mismatch to show: a workbook case nobody booked ("unbooked"; during the repair every case is expected to be
 * booked), or a booking the uploaded workbook does not hold ("not-in-hosxp").
 */
export type RowFlag = "unbooked" | "not-in-hosxp" | null;

export type BoardRow = Operation & {
  source: RowSource;
  flag: RowFlag;
  /** The patient's HN, present only when the viewer may see it (the key is left out otherwise). */
  hn?: string;
  /** The doctor who booked the room (booking and matched rows). */
  bookedBy?: string;
  /**
   * A booking the doctor put in the dressing room: their answer to "scrub ทำให้แทนไหม ?", true when the scrub nurse
   * does the dressing (ฝาก scrub ทำ), false when the doctor does (แพทย์ทำเอง). Left out on other rows.
   */
  scrubDoes?: boolean;
};

/** Who looks at the board, for the HN rule. */
export type BoardViewer = {
  /** MX and admins see every HN. */
  allHn: boolean;
  /** users.id of the viewer, or null: a doctor sees the HN of their own bookings. */
  userId: string | null;
};

/**
 * What the rows need of a workbook case (lib/workbook-store.ts StoredCase has it). There is no room: the case is placed
 * when the board is read (lib/placement.ts placeAll), under the repair's dates in force then, so a change an admin
 * saves after the upload moves the cases too. The upload's own room (StoredCase.roomId) is only a record.
 */
export type WorkbookCase = {
  caseId: string;
  hn: string;
  operation: string;
  surgeon: string;
  dept: DeptCode | null;
  /** The surgeon's team for the SCOPE rule, null for a case saved without one. */
  team: string | null;
  /** The urgency label (Stat and Emergency go to the emergency room). */
  urgency: string | null;
  shift: Shift | null;
  status: CaseStatus;
  /** Order in the file. */
  position: number;
};

export type BoardRowsInput = {
  /** The board's date, YYYY-MM-DD. */
  date: string;
  periods: RepairPeriods;
  /** The cases of the cycle's latest upload, or null when MX has not uploaded for the cycle. */
  workbook: readonly WorkbookCase[] | null;
  /** The doctors' bookings, oldest first (as lib/cases.ts lists them); only those on `date` count. */
  bookings: readonly AddedCase[];
  viewer: BoardViewer;
};

export type BoardRows = {
  /** In each room: workbook cases (matched or not) in file order, then bookings alone in the order they were made. */
  rows: BoardRow[];
  /** Whether a workbook was uploaded for the cycle. */
  uploaded: boolean;
  /** Workbook cases paired with a booking (shown or not). */
  matched: number;
  /** Rows with a flag. */
  mismatchCount: number;
  /** Flagged rows per room. */
  mismatchByRoom: Record<string, number>;
  /** Rows per room. */
  countByRoom: Record<string, number>;
};

/** Where a booking goes on its day (lib/added-cases.ts bookedRoom), per booking. */
type BookingRooms = ReadonlyMap<AddedCase, { roomId: string; dressing: boolean }>;

/**
 * Pairs workbook cases with the day's bookings, one to one by normalised HN, in a stable order: workbook cases in file
 * order (`cases` sorted by position) each take a free booking with their HN, the oldest one. When the patient has
 * several bookings that day, the one whose room fits the case's name goes first (the dressing-room booking to the case
 * HOSxP names a dressing), so the doctor's choice of room lands on the case it was made for.
 */
function pairCases<T extends WorkbookCase>(cases: readonly T[], today: readonly AddedCase[], rooms: BookingRooms): Map<T, AddedCase> {
  // The bookings waiting for a match, per HN, oldest first.
  const waiting = new Map<string, AddedCase[]>();
  for (const booking of today) {
    const key = normalizeHn(booking.hn);
    if (!key) continue;
    const queue = waiting.get(key);
    if (queue) queue.push(booking);
    else waiting.set(key, [booking]);
  }
  const pairs = new Map<T, AddedCase>();
  for (const item of cases) {
    const key = normalizeHn(item.hn);
    const queue = key ? waiting.get(key) : undefined;
    if (!queue || queue.length === 0) continue;
    const dressing = isDressingCase(item.operation);
    const fit = queue.findIndex((booking) => (rooms.get(booking)?.dressing ?? false) === dressing);
    const [booking] = queue.splice(fit >= 0 ? fit : 0, 1);
    pairs.set(item, booking);
  }
  return pairs;
}

/** The room choice a paired booking gives its workbook case's placement; none for a case nobody booked. */
function choiceOf(booking: AddedCase | undefined, rooms: BookingRooms): RoomChoice | undefined {
  if (!booking) return undefined;
  return rooms.get(booking)?.dressing ? "dressing" : "dept";
}

/**
 * Each workbook case with the room choice of the booking it pairs with on `date` (as buildBoardRows pairs them), in the
 * order given; for the upload's own summary (lib/upload-flow.ts), so it counts the rooms the board shows.
 */
export function withBookedChoices<T extends WorkbookCase>(
  cases: readonly T[],
  bookings: readonly AddedCase[],
  date: string,
  periods: RepairPeriods,
): (T & { choice?: RoomChoice })[] {
  const today = bookings.filter((item) => item.date === date);
  const rooms = new Map(today.map((booking) => [booking, bookedRoom(booking, periods)]));
  const pairs = pairCases([...cases].sort((a, b) => a.position - b.position), today, rooms);
  return cases.map((item) => {
    const choice = choiceOf(pairs.get(item), rooms);
    return choice ? { ...item, choice } : { ...item };
  });
}

/** The scrub answer of a booking shown in the dressing room it was booked into. */
function scrubAnswer(booking: AddedCase, own: { roomId: string; dressing: boolean }, roomId: string): { scrubDoes?: boolean } {
  return own.dressing && roomId === own.roomId && typeof booking.scrubDoes === "boolean" ? { scrubDoes: booking.scrubDoes } : {};
}

function departmentName(dept: DeptCode | null): string | null {
  return dept && Object.hasOwn(DEPARTMENTS, dept) ? DEPARTMENTS[dept].name : null;
}

/**
 * Merges the workbook and the bookings into the board's rows.
 *
 * Workbook cases are placed first, in file order, by the report's rules under `periods` (lib/placement.ts): the
 * same rooms the upload gave them, unless an admin has moved the repair's dates since, and then the rooms in use
 * under the new dates. Bookings are placed again too (lib/added-cases.ts bookedRoom): the doctor picks their
 * department's room or the dressing room, and the app works out which room that is. Matching is one to one by
 * normalised HN on the board's date, in a stable order: workbook cases in file order each take the earliest booking with
 * their HN that is still free, one whose room fits the case's name first (pairCases). A matched pair is shown once, with the workbook's operation name and status, in the room
 * placement gave the workbook case: MX's list is the day's schedule, and it spreads a department's cases over its
 * rooms, which a booking alone cannot. The doctor's choice of room takes the place of the workbook's name, though
 * (Pong, 15 Nov 2026: "let surgeon decide"): a case booked in the dressing room is placed there, and a case booked in
 * the department's room is placed as if its name were no dressing, so HOSxP's name never moves it to the dressing room
 * and an emergency still goes to the emergency room. A workbook case left over shows in its
 * placed room, flagged "unbooked". A
 * booking left over shows in its room, flagged "not-in-hosxp" only when a workbook was uploaded (without one there is
 * nothing to compare with). A row whose room is not open that day (closed, a recovery or instrument room, or a
 * workbook case not placed) is left off the board.
 */
export function buildBoardRows({ date, periods, workbook, bookings, viewer }: BoardRowsInput): BoardRows {
  const uploaded = workbook !== null;
  const today = bookings.filter((item) => item.date === date);
  const bookingRooms = new Map(today.map((booking) => [booking, bookedRoom(booking, periods)]));
  const cases = [...(workbook ?? [])].sort((a, b) => a.position - b.position);

  const pairs = pairCases(cases, today, bookingRooms);
  const taken = new Set(pairs.values());
  // A matched case is placed by the doctor's choice of room instead of its name, and by the workbook's other rules
  // (emergencies, NEURO and CVT, SCOPE, the load of a department's rooms) as any other case.
  const placements = placeAll(
    cases.map((item) => ({ ...item, choice: choiceOf(pairs.get(item), bookingRooms) })),
    date,
    periods,
  );
  const dressingRooms = roomsHeldBy("INFECT", date, periods);
  const placedIn = new Map<WorkbookCase, string | null>();
  cases.forEach((item, index) => {
    const placement = placements[index];
    placedIn.set(item, placement.ok ? placement.roomId : null);
  });

  const open = (roomId: string | null): roomId is string => roomId !== null && roomUse(roomId, date, periods) === "open";
  // The doctor who made a booking sees its HN; MX and admins see every HN.
  const seesHn = (booking: AddedCase) => viewer.allHn || (viewer.userId !== null && booking.surgeonId === viewer.userId);
  const rows: Omit<BoardRow, "order">[] = [];

  for (const item of cases) {
    const booking = pairs.get(item);
    if (booking) {
      const placed = placedIn.get(item) ?? null;
      const own = bookingRooms.get(booking) ?? { roomId: booking.roomId, dressing: false };
      // Where MX's list places it by the doctor's choice; the booking's own room when the case cannot be placed (its
      // department is not known), but a department's booking never in the dressing room.
      const fits = (roomId: string | null): roomId is string => open(roomId) && (own.dressing || !dressingRooms.includes(roomId));
      const roomId = fits(placed) ? placed : fits(own.roomId) ? own.roomId : null;
      if (!roomId) continue;
      const hn = booking.hn ?? normalizeHn(item.hn);
      rows.push({
        id: `mt-${booking.id}`,
        roomId,
        procedure: item.operation || booking.operation || NO_OPERATION_LABEL,
        surgeon: item.surgeon,
        specialty: departmentName(item.dept) ?? subtypeLabel("DR", booking.subtype),
        status: item.status,
        shift: item.shift ?? booking.shift,
        source: "matched",
        flag: null,
        ...(seesHn(booking) && hn ? { hn } : {}),
        bookedBy: booking.surgeon,
        ...scrubAnswer(booking, own, roomId),
      });
      continue;
    }
    const placed = placedIn.get(item) ?? null;
    if (!open(placed)) continue;
    rows.push({
      id: `hx-${item.caseId}`,
      roomId: placed,
      procedure: item.operation,
      surgeon: item.surgeon,
      specialty: departmentName(item.dept),
      status: item.status,
      shift: item.shift,
      source: "hosxp",
      flag: "unbooked",
      ...(viewer.allHn ? { hn: normalizeHn(item.hn) } : {}),
    });
  }

  for (const booking of today) {
    const own = bookingRooms.get(booking) ?? { roomId: booking.roomId, dressing: false };
    const roomId = own.roomId;
    if (taken.has(booking) || !open(roomId)) continue;
    rows.push({
      id: `bk-${booking.id}`,
      roomId,
      procedure: booking.operation || NO_OPERATION_LABEL,
      surgeon: booking.surgeon,
      specialty: subtypeLabel("DR", booking.subtype),
      status: "scheduled",
      shift: booking.shift,
      source: "booking",
      flag: uploaded ? "not-in-hosxp" : null,
      ...(seesHn(booking) && booking.hn ? { hn: booking.hn } : {}),
      bookedBy: booking.surgeon,
      ...scrubAnswer(booking, own, roomId),
    });
  }

  const order = new Map<string, number>();
  const countByRoom: Record<string, number> = {};
  const mismatchByRoom: Record<string, number> = {};
  let mismatchCount = 0;
  const numbered = rows.map((row): BoardRow => {
    const slot = (order.get(row.roomId) ?? 0) + 1;
    order.set(row.roomId, slot);
    countByRoom[row.roomId] = slot;
    if (row.flag) {
      mismatchCount += 1;
      mismatchByRoom[row.roomId] = (mismatchByRoom[row.roomId] ?? 0) + 1;
    }
    return { ...row, order: slot };
  });

  return { rows: numbered, uploaded, matched: pairs.size, mismatchCount, mismatchByRoom, countByRoom };
}

/**
 * The day to name in the board's "no HOSxP list yet" alert, or null. The board's rows come only from MX's uploads, in
 * the repair and outside it (the weekly export no longer feeds the board), so a day without one is news to everyone:
 * otherwise an empty room could not be told from a missing list. Not when the cases could not be read (that notice
 * stands instead) or there is no board (a closed day).
 */
export function missingUploadDay(board: { date: string; uploaded: boolean } | null, casesUnavailable: boolean): string | null {
  return board && !board.uploaded && !casesUnavailable ? board.date : null;
}
