import { NO_OPERATION_LABEL, UNDER_WAY, bookedAtText, bookedRoom, bookingDept, timeOf, type AddedCase } from "./added-cases.ts";
import { rangeText } from "./booking-time.ts";
import { DEPARTMENTS, type DeptCode } from "./allocation.ts";
import { normalizeHn } from "./hn.ts";
import type { PlaceId } from "./places.ts";
import { isDressingCase, placeAll, roomsHeldBy, type Placement, type RoomChoice } from "./placement.ts";
import type { RepairPeriods } from "./repair.ts";
import { roomUse } from "./rooms.ts";
import type { CaseStatus, Operation, Shift } from "./schedule.ts";
import { placeThaChalom, thaChalomOpenIds } from "./tha-chalom-schedule.ts";
import { subtypeLabel } from "./user-labels.ts";

/**
 * The board's case rows, at both hospitals: the HOSxP workbook's cases (the latest upload of the cycle,
 * lib/workbook-store.ts, the hospital's own) and the doctors' bookings (lib/cases.ts), matched one to one by HN. Pure and isomorphic; the
 * server page builds the rows and hands the client only what the viewer may see (an HN, the patient's name and the
 * diagnosis only to the doctor who booked the case, MX and admins).
 */

/** Where a row comes from: the workbook alone, a booking alone, or a workbook case that matches a booking. */
export type RowSource = "hosxp" | "booking" | "matched";

/**
 * A mismatch: a workbook case nobody booked ("unbooked"; during the repair every case is expected to be booked), or a
 * booking the uploaded workbook does not hold ("not-in-hosxp"). The board shows only the first: a booking HOSxP does not
 * list is no real patient (Pong, 15 Nov 2026), so its row is left off the board and listed only in MX's upload summary
 * (BoardRows.unmatched).
 */
export type RowFlag = "unbooked" | "not-in-hosxp" | null;

export type BoardRow = Operation & {
  source: RowSource;
  flag: RowFlag;
  /** The patient's HN, present only when the viewer may see it (the key is left out otherwise). */
  hn?: string;
  /**
   * The patient's name (Pong, 16 Nov 2026: "Add patient name line above HN"), under the HN's rule: present only when the
   * viewer may see the HN and there is a name. The HOSxP workbook's when it has one, else the one the doctor gave on the
   * booking (Pong, 28 Nov 2026: "add form input diagnosis and patient name, both are not required").
   */
  patientName?: string;
  /**
   * The diagnosis the doctor gave on the booking (Pong, 28 Nov 2026), under the HN's rule as the name. The workbook's
   * diagnosis is never read (lib/workbook.ts), so a case nobody booked has none.
   */
  diagnosis?: string;
  /** The doctor who booked the room (booking and matched rows). */
  bookedBy?: string;
  /**
   * The booking's id (cases.id), only on the viewer's own bookings (booking and matched rows the viewer booked): the row
   * then offers its doctor the booking's actions (components/booking-actions.tsx: edit, move, book again, cancel).
   */
  bookingId?: string;
  /** When the booking was made, as the row says it: "15 พ.ย. 69, 23:43" (Bangkok time; booking and matched rows). */
  bookedAt?: string;
  /**
   * The booking's time on its day, "09:00–10:00" (Pong, 27 Nov 2026: picked on the booking form's day view), for every
   * viewer; left out for a booking made before the form asked and for a case nobody booked.
   */
  time?: string;
  /**
   * The booking's note to the OR team (หมายเหตุ; Pong, 17 Nov 2026: "each case row has หมายเหตุ => click to open dialog
   * to see details"), for every viewer: the team prepares from it. Present only when the booking has one; the HOSxP
   * workbook has no notes, so a case nobody booked has none.
   */
  note?: string;
  /**
   * A row in the dressing room: who does the dressing, the scrub nurse ("scrub", ฝาก scrub ทำ) or the doctor
   * ("surgeon", แพทย์ทำเอง), from the booking's answer to "scrub ทำให้แทนไหม ?". A case without that answer (nobody
   * booked it in the dressing room) is the doctor's, as the question asks whether the scrub does it instead, except a
   * HOSxP case nobody booked that the dressing rule names a dressing, which is the scrub nurse's (Pong, 27 Nov 2026). In the
   * dressing room whether a case was booked does not matter (Pong, 15 Nov 2026), so the row shows who does it instead
   * of where it came from. Left out in every other room.
   */
  doneBy?: DoneBy;
  /** รพ.ท่าฉลอม's rows say so (buildThaChalomRows), for their rooms' names; รพ.สมุทรสาคร's leave it out. */
  place?: PlaceId;
  /**
   * "calendar": the row's booking came from a doctor's calendar through the calendar API (lib/calendar-api.ts), shown
   * as a จากปฏิทิน badge for every viewer. Left out for a booking made on the board and a case nobody booked.
   */
  via?: "calendar";
  /**
   * A case of a department with two rooms or more that day is listed in each of them (Pong, 27 Nov 2026: "For day that
   * dept has 2 rooms : display both booking and hosxp cases on both rooms"): the copy in a room other than the one the
   * case was put in (lib/placement.ts placeAll: one surgeon, one room) says that room, and the case's place in that
   * room's list, here. Totals and a room's own marks count a case once, by the rows without it.
   */
  shownFrom?: { roomId: string; order: number };
};

/**
 * HOSxP cases left off the board because no room takes them that day (Pong, 27 Nov 2026: "Leave off board and display
 * on noti bar for both places"), per department: their department has no room that day (null: no department is known),
 * nor did a booking put them in one. For the strip's notice (lib/board-notices.ts): counts only, no patient.
 */
export type OffBoardCount = { dept: DeptCode | null; count: number };

/**
 * The surgeon as a row names them: without the title (Pong, 16 Nov 2026: "No นพ พญ prefix"), so every doctor's name
 * fits on one line on a phone. The workbook's cases keep the title as saved ("นพ. ชื่อ นามสกุล"); bookings never had one.
 */
const TITLE = /^(?:น\.\s?พ\.|นพ\.|พ\.\s?ญ\.|พญ\.|ทพญ\.|ทพ\.)\s*/;
export const withoutTitle = (surgeon: string) => surgeon.replace(TITLE, "").trim() || surgeon;

/** Who does a dressing: the scrub nurse or the doctor. */
export type DoneBy = "scrub" | "surgeon";

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
  /** The surgeon's team from the physician list, null for a case saved without one; no placement rule uses it. */
  team: string | null;
  /** The urgency label (Stat and Emergency go to the emergency room). */
  urgency: string | null;
  shift: Shift | null;
  status: CaseStatus;
  /** Order in the file. */
  position: number;
  /** The patient's name (ชื่อ), null or absent when the file had none. */
  patientName?: string | null;
};

export type BoardRowsInput = {
  /** The board's date, YYYY-MM-DD. */
  date: string;
  periods: RepairPeriods;
  /** The cases of the cycle's latest upload, or null when MX has not uploaded for the cycle. */
  workbook: readonly WorkbookCase[] | null;
  /** The doctors' bookings in queue order (as lib/cases.ts lists them); only those on `date` count. */
  bookings: readonly AddedCase[];
  viewer: BoardViewer;
};

export type BoardRows = {
  /**
   * In each room (Pong, 15 Nov 2026): the booked cases first, the earliest booking first (matched rows, and before an
   * upload the bookings alone), then the HOSxP cases nobody booked in file order. After an upload a booking HOSxP does
   * not list is not among them (see `unmatched`).
   */
  rows: BoardRow[];
  /** After an upload, the bookings the workbook does not hold, flagged "not-in-hosxp": for MX's upload summary only. */
  unmatched: BoardRow[];
  /** Whether a workbook was uploaded for the cycle. */
  uploaded: boolean;
  /** Workbook cases paired with a booking (shown or not). */
  matched: number;
  /** Cases on the board with a flag: the HOSxP cases nobody booked, outside the dressing room (each case once). */
  mismatchCount: number;
  /** Flagged rows per room, a department's rooms each counting the department's (BoardRow.shownFrom). */
  mismatchByRoom: Record<string, number>;
  /** Rows per room, a department's rooms each counting the department's. */
  countByRoom: Record<string, number>;
  /** The HOSxP cases no room takes that day, the department with the most first. */
  offBoard: OffBoardCount[];
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
 * What a paired booking tells its workbook case's placement (lib/placement.ts placeAll): the doctor's choice of room,
 * and the room the booking is in, which the case keeps in a department with several rooms that day.
 */
function bookedOf(booking: AddedCase | undefined, rooms: BookingRooms): { choice?: RoomChoice; bookedRoom?: string } {
  const choice = choiceOf(booking, rooms);
  if (!booking || !choice) return {};
  const room = rooms.get(booking);
  return choice === "dept" && room ? { choice, bookedRoom: room.roomId } : { choice };
}

/**
 * Where `date`'s board at รพ.สมุทรสาคร shows each workbook case (in the order given), as a placement: the room, or why it
 * has none. The upload's own summary counts by it (lib/upload-flow.ts), so MX's numbers are the board's.
 */
export function boardPlacements(cases: readonly WorkbookCase[], bookings: readonly AddedCase[], date: string, periods: RepairPeriods): Placement[] {
  const today = bookings.filter((item) => item.date === date);
  return placementsShown(cases, today, skhLayout(today, date, periods));
}

/** boardPlacements for รพ.ท่าฉลอม's board, with its doctors' `bookings`. */
export function thaChalomBoardPlacements(cases: readonly WorkbookCase[], bookings: readonly AddedCase[], date: string): Placement[] {
  const today = bookings.filter((item) => item.date === date);
  return placementsShown(cases, today, thaChalomLayout(today, date));
}

function placementsShown(cases: readonly WorkbookCase[], today: readonly AddedCase[], layout: Layout): Placement[] {
  const shown = showCases([...cases].sort((a, b) => a.position - b.position), today, layout);
  return cases.map((item): Placement => {
    const at = shown.get(item);
    if (at?.roomId) return { ok: true, roomId: at.roomId };
    return at && !at.placement.ok ? at.placement : { ok: false, reason: "no-room" };
  });
}

/** Where the board shows a workbook case: its paired booking, its placement, and its room (null: left off). */
type Shown = { booking: AddedCase | undefined; placement: Placement; roomId: string | null };

/**
 * Where the board shows each workbook case (`cases` in file order). Each is paired with a booking by HN (pairCases) and
 * placed by the layout's rules with that booking's choice of room, and shows in the room placement gives it when that
 * room operates that day (a department's booking never in the dressing room). A matched case placement gives no such
 * room shows in its booking's own room when that one operates (its department is not known, or has no room that day and
 * the booking was saved in one: a room borrowed from 22 to 27 Nov 2026). Otherwise it is left off (roomId null).
 */
function showCases<T extends WorkbookCase>(cases: readonly T[], today: readonly AddedCase[], layout: Layout): Map<T, Shown> {
  const { bookingRooms, placeCases, dressingRooms, open } = layout;
  const pairs = pairCases(cases, today, bookingRooms);
  const placements = placeCases(cases.map((item) => ({ ...item, ...bookedOf(pairs.get(item), bookingRooms) })));
  return new Map(
    cases.map((item, index): [T, Shown] => {
      const booking = pairs.get(item);
      const placement = placements[index];
      const placed = placement.ok ? placement.roomId : null;
      if (!booking) return [item, { booking, placement, roomId: open(placed) ? placed : null }];
      const own = bookingRooms.get(booking) ?? { roomId: booking.roomId, dressing: false };
      const fits = (roomId: string | null): roomId is string => open(roomId) && (own.dressing || !dressingRooms.includes(roomId));
      return [item, { booking, placement, roomId: fits(placed) ? placed : fits(own.roomId) ? own.roomId : null }];
    }),
  );
}

/**
 * Who does a row's dressing, in a dressing room only: the scrub nurse when the doctor booked the case in the dressing
 * room and said so, else the doctor. A HOSxP case nobody booked whose name the dressing rule reads as a dressing
 * (`dressingName`; lib/placement.ts isDressingCase) is the scrub nurse's too (Pong, 27 Nov 2026: "For hosxp cases that
 * are classified as dressing, app will automatically assign พยาบาลทำ"). Worked out on every load, so the lists already
 * uploaded follow it with no change to what is stored.
 */
function doneByIn(roomId: string, dressingRooms: readonly string[], booking?: AddedCase, dressingName = false): { doneBy?: DoneBy } {
  if (!dressingRooms.includes(roomId)) return {};
  if (!booking) return { doneBy: dressingName ? "scrub" : "surgeon" };
  return { doneBy: booking.dressing && booking.scrubDoes === true ? "scrub" : "surgeon" };
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
 * placed room, flagged "unbooked" (but not in the dressing room, where booking does not matter). A booking left over shows in its room until a workbook is uploaded; after that it is
 * no real patient (Pong, 15 Nov 2026: "remove that row because no real patient set"), so it goes to `unmatched`,
 * flagged "not-in-hosxp", for MX's upload summary alone. A row whose room is not open that day (closed, a recovery or
 * instrument room, or a workbook case not placed) is left off the board; the workbook cases no room takes, their
 * department having none that day (or none known), are counted for the strip's notice (offBoard; Pong, 27 Nov 2026:
 * "Leave off board and display on noti bar for both places").
 *
 * In each room the booked cases come first, by their time (Pong, 27 Nov 2026: booked on the form's day view), then those
 * without one in booking order, then the cases nobody booked in the workbook's order (Pong, 15 Nov 2026: "first priority
 * is booking case: sort by prior set; second priority is HOSxP sequence from workbook"). A department with two rooms or
 * more that day has all of its cases listed in each of them, in that order (Pong, 27 Nov 2026: "For day that dept has 2
 * rooms : display both booking and hosxp cases on both rooms"; Layout.listedIn, BoardRow.shownFrom), though each case is
 * still put in one of them (one surgeon, one room) and counted once. `bookings` come in queue order
 * (lib/cases.ts: the queue time, when a booking was made or last moved to its day, room or patient), so their order is
 * the booking order.
 */
export function buildBoardRows({ date, periods, workbook, bookings, viewer }: BoardRowsInput): BoardRows {
  const today = bookings.filter((item) => item.date === date);
  return mergeRows({ workbook, today, viewer }, skhLayout(today, date, periods));
}

/** รพ.สมุทรสาคร's way, for `today`'s bookings on `date`. */
function skhLayout(today: readonly AddedCase[], date: string, periods: RepairPeriods): Layout {
  return {
    bookingRooms: new Map(today.map((booking) => [booking, bookedRoom(booking, periods)])),
    // A matched case is placed by the doctor's choice of room instead of its name, and by the workbook's other rules
    // (emergencies, NEURO and CVT) as any other case; in a department with several rooms it keeps its booking's room,
    // and each surgeon's cases stay in one room (placeAll).
    placeCases: (cases) => placeAll(cases, date, periods),
    dressingRooms: roomsHeldBy("INFECT", date, periods),
    open: (roomId): roomId is string => roomId !== null && roomUse(roomId, date, periods) === "open",
    listedIn: (roomId, dept) => listedRooms(roomId, dept, date, periods),
  };
}

/**
 * The rooms of รพ.สมุทรสาคร's board on `date` that list a case of department `dept` put in `roomId` (Layout.listedIn):
 * all of the department's rooms that day when it holds two or more, morning or afternoon, and `roomId` is one of them
 * (Pong, 27 Nov 2026: "For day that dept has 2 rooms : display both booking and hosxp cases on both rooms"); else
 * `roomId` alone, as for the dressing, emergency and SCOPE rooms and a guest's room. SCOPE-coded cases are a general
 * surgeon's (lib/placement.ts candidateRooms).
 */
export function listedRooms(roomId: string, dept: DeptCode | null, date: string, periods: RepairPeriods): string[] {
  const code = dept === "SCOPE" ? "GENSX" : dept;
  if (!code) return [roomId];
  const dressing = roomsHeldBy("INFECT", date, periods);
  const rooms = roomsHeldBy(code, date, periods).filter((room) => !dressing.includes(room));
  return rooms.length > 1 && rooms.includes(roomId) ? rooms : [roomId];
}

/**
 * รพ.ท่าฉลอม's rows on `date`, by buildBoardRows' rules (Pong, 27 Nov 2026: "Excel file include both place on one sheet":
 * MX's upload holds its cases too): its HOSxP cases matched with its doctors' bookings by HN, in the room its table gives
 * each case's department that day (lib/tha-chalom-schedule.ts placeThaChalom), a booking in the room it was booked in.
 * No dressing room, and no repair to move rooms. Before an upload with its cases (`workbook` null), its bookings alone.
 * Every row says it is รพ.ท่าฉลอม's (BoardRow.place), for its room's name.
 */
export function buildThaChalomRows({ date, workbook, bookings, viewer }: Omit<BoardRowsInput, "periods">): BoardRows {
  const today = bookings.filter((item) => item.date === date);
  return mergeRows({ workbook, today, viewer }, thaChalomLayout(today, date));
}

/** รพ.ท่าฉลอม's way, for `today`'s bookings there on `date`. */
function thaChalomLayout(today: readonly AddedCase[], date: string): Layout {
  const open = thaChalomOpenIds(date);
  return {
    bookingRooms: new Map(today.map((booking) => [booking, { roomId: booking.roomId, dressing: false }])),
    placeCases: (cases) => placeThaChalom(cases, date),
    dressingRooms: [],
    open: (roomId): roomId is string => roomId !== null && open.has(roomId),
    // Its table gives a department one room a day (thaChalomBookingRoom).
    listedIn: (roomId) => [roomId],
    place: "tha-chalom",
  };
}

/** What the two hospitals' boards do their own way. */
type Layout = {
  /** Where each of the day's bookings is. */
  bookingRooms: BookingRooms;
  /** Where each workbook case goes, in the order given, each with its paired booking's choice of room. */
  placeCases: (cases: (WorkbookCase & { choice?: RoomChoice; bookedRoom?: string })[]) => Placement[];
  /** The day's dressing rooms, where a case nobody booked is no mismatch. */
  dressingRooms: readonly string[];
  /** Whether a room operates that day. */
  open: (roomId: string | null) => roomId is string;
  /**
   * The rooms a row in `roomId` of department `dept` is listed in: all of the department's rooms that day when it has
   * two or more and `roomId` is one of them (Pong, 27 Nov 2026: "For day that dept has 2 rooms : display both booking
   * and hosxp cases on both rooms"), else `roomId` alone (the dressing, emergency and SCOPE rooms, a guest's room).
   */
  listedIn: (roomId: string, dept: DeptCode | null) => readonly string[];
  /** The hospital its rows say, when not รพ.สมุทรสาคร. */
  place?: PlaceId;
};

/** buildBoardRows' merge, for either hospital's `layout`. */
function mergeRows(
  { workbook, today, viewer }: { workbook: readonly WorkbookCase[] | null; today: readonly AddedCase[]; viewer: BoardViewer },
  layout: Layout,
): BoardRows {
  const { bookingRooms, dressingRooms, open, place, listedIn } = layout;
  const uploaded = workbook !== null;
  const cases = [...(workbook ?? [])].sort((a, b) => a.position - b.position);

  const shown = showCases(cases, today, layout);
  const taken = new Set([...shown.values()].flatMap((at) => (at.booking ? [at.booking] : [])));
  // A case left off because no room takes it (its department has none that day, or none is known; not obstetrics and
  // gynaecology in the repair, which operates in its own building) is counted for the strip's notice.
  const offBoard = new Map<DeptCode | null, number>();
  const leaveOff = (item: WorkbookCase, placement: Placement) => {
    if (!placement.ok && placement.reason !== "obgyn-building") offBoard.set(item.dept, (offBoard.get(item.dept) ?? 0) + 1);
  };
  const hospital = place ? { place } : {};

  // The doctor who made a booking sees its HN, the patient's name and the diagnosis; MX and admins see every one.
  const ownBooking = (booking: AddedCase) => viewer.userId !== null && booking.surgeonId === viewer.userId;
  const seesHn = (booking: AddedCase) => viewer.allHn || ownBooking(booking);
  const patientOf = (booking: AddedCase, fromHosxp?: string | null): { patientName?: string; diagnosis?: string } => {
    if (!seesHn(booking)) return {};
    const name = fromHosxp || booking.patientName;
    return { ...(name ? { patientName: name } : {}), ...(booking.diagnosis ? { diagnosis: booking.diagnosis } : {}) };
  };
  const ownId = (booking: AddedCase): { bookingId?: string } => (ownBooking(booking) ? { bookingId: booking.id } : {});
  // The booked rows by their time, then by the booking's place in `today` (the booking order); then the unbooked ones
  // in file order.
  const booked: { start: number; at: number; row: Omit<BoardRow, "order"> }[] = [];
  const unbooked: Omit<BoardRow, "order">[] = [];
  const unmatchedRows: Omit<BoardRow, "order">[] = [];
  const bookingIndex = new Map(today.map((booking, index) => [booking, index]));
  // Each row's department, for the rooms it is listed in (Layout.listedIn).
  const deptOf = new Map<Omit<BoardRow, "order">, DeptCode | null>();

  for (const item of cases) {
    const { booking, placement, roomId } = shown.get(item) as Shown;
    if (!roomId) {
      leaveOff(item, placement);
      continue;
    }
    if (booking) {
      const hn = booking.hn ?? normalizeHn(item.hn);
      const row: Omit<BoardRow, "order"> = {
        id: `mt-${booking.id}`,
        roomId,
        procedure: item.operation || booking.operation || NO_OPERATION_LABEL,
        surgeon: withoutTitle(item.surgeon),
        specialty: departmentName(item.dept) ?? subtypeLabel("DR", booking.subtype),
        status: item.status,
        shift: item.shift ?? booking.shift,
        source: "matched",
        flag: null,
        ...(seesHn(booking) && hn ? { hn } : {}),
        // HOSxP's name when it has one: the hospital's own spelling.
        ...patientOf(booking, item.patientName),
        bookedBy: booking.surgeon,
        ...ownId(booking),
        ...when(booking),
        ...timeText(booking),
        ...noteOf(booking),
        ...viaOf(booking),
        ...doneByIn(roomId, dressingRooms, booking),
        ...hospital,
      };
      deptOf.set(row, item.dept ?? bookingDept(booking.subtype));
      booked.push({ start: startOf(booking), at: bookingIndex.get(booking) ?? 0, row });
      continue;
    }
    // In the dressing room a case nobody booked is no mismatch: booking it does not matter there (Pong, 15 Nov 2026).
    const dressingRoom = dressingRooms.includes(roomId);
    const row: Omit<BoardRow, "order"> = {
      id: `hx-${item.caseId}`,
      roomId,
      procedure: item.operation,
      surgeon: withoutTitle(item.surgeon),
      specialty: departmentName(item.dept),
      status: item.status,
      shift: item.shift,
      source: "hosxp",
      flag: dressingRoom ? null : "unbooked",
      ...(viewer.allHn ? { hn: normalizeHn(item.hn) } : {}),
      ...(viewer.allHn && item.patientName ? { patientName: item.patientName } : {}),
      ...doneByIn(roomId, dressingRooms, undefined, isDressingCase(item.operation)),
      ...hospital,
    };
    deptOf.set(row, item.dept);
    unbooked.push(row);
  }

  today.forEach((booking, index) => {
    const own = bookingRooms.get(booking) ?? { roomId: booking.roomId, dressing: false };
    const roomId = own.roomId;
    if (taken.has(booking) || !open(roomId)) return;
    const row: Omit<BoardRow, "order"> = {
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
      ...patientOf(booking),
      bookedBy: booking.surgeon,
      ...ownId(booking),
      ...when(booking),
      ...timeText(booking),
      ...noteOf(booking),
      ...viaOf(booking),
      ...doneByIn(roomId, dressingRooms, booking),
      ...hospital,
    };
    deptOf.set(row, bookingDept(booking.subtype));
    if (uploaded) unmatchedRows.push(row);
    else booked.push({ start: startOf(booking), at: index, row });
  });

  // By time, then the booking order (a pair keeps it, whatever the file order of its HOSxP case).
  const rows = [...booked.sort((a, b) => a.start - b.start || a.at - b.at).map((entry) => entry.row), ...unbooked];

  // Numbered in each room it is listed in: a department's rooms that day each list all of its cases, in the same order
  // (booked by time and booking order, then HOSxP's in file order), the copies saying the room the case was put in.
  const order = new Map<string, number>();
  const countByRoom: Record<string, number> = {};
  const mismatchByRoom: Record<string, number> = {};
  let mismatchCount = 0;
  const numbered = rows.flatMap((row): BoardRow[] => {
    if (row.flag) mismatchCount += 1;
    const listed = listedIn(row.roomId, deptOf.get(row) ?? null).map((roomId) => {
      const slot = (order.get(roomId) ?? 0) + 1;
      order.set(roomId, slot);
      countByRoom[roomId] = slot;
      if (row.flag) mismatchByRoom[roomId] = (mismatchByRoom[roomId] ?? 0) + 1;
      return { roomId, slot };
    });
    const home = { roomId: row.roomId, order: listed.find((entry) => entry.roomId === row.roomId)?.slot ?? 0 };
    return listed.map(({ roomId, slot }): BoardRow =>
      roomId === row.roomId ? { ...row, order: slot } : { ...row, roomId, order: slot, shownFrom: home },
    );
  });

  const unmatched = unmatchedRows.map((row, index): BoardRow => ({ ...row, order: index + 1 }));
  // The department with the most cases first; on a tie, the one first in the file (a Map keeps that order).
  const off = [...offBoard.entries()].map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count);
  return { rows: numbered, unmatched, uploaded, matched: taken.size, mismatchCount, mismatchByRoom, countByRoom, offBoard: off };
}

/** When a booking was made, as its row says it. */
function when(booking: AddedCase): { bookedAt?: string } {
  const text = booking.bookedAt ? bookedAtText(booking.bookedAt) : "";
  return text ? { bookedAt: text } : {};
}
const noteOf = (booking: AddedCase): { note?: string } => (booking.note ? { note: booking.note } : {});
/** A booking the calendar API pushed says so on its row (BoardRow.via). */
const viaOf = (booking: AddedCase): { via?: "calendar" } => (booking.via === "calendar" ? { via: "calendar" } : {});
function timeText(booking: AddedCase): { time?: string } {
  const time = timeOf(booking);
  return time ? { time: rangeText(time) } : {};
}
/** A booking's start, for the rows' order; a booking without a time after every timed one. */
const startOf = (booking: AddedCase) => booking.start ?? Infinity;

/**
 * The day to name in the board's "no HOSxP list yet" alert, or null. The board's rows come only from MX's uploads, in
 * the repair and outside it (the weekly export no longer feeds the board), so a day without one is news to everyone:
 * otherwise an empty room could not be told from a missing list. Not when the cases could not be read (whether there is
 * a list is not known then) or there is no board (a closed day).
 */
export function missingUploadDay(board: { date: string; uploaded: boolean } | null, casesUnavailable: boolean): string | null {
  return board && !board.uploaded && !casesUnavailable ? board.date : null;
}

/**
 * Whether the doctor's booking `bookingId` is on a row HOSxP says is under way or over (UNDER_WAY), on its day's board as
 * `input` builds it at `place`: the server's check before an edit or a cancel (app/(board)/actions.ts), the same rule the
 * row's actions show.
 */
export function bookingUnderWay(input: Omit<BoardRowsInput, "viewer">, bookingId: string, surgeonId: string, place: PlaceId = "skh"): boolean {
  const viewer = { allHn: false, userId: surgeonId };
  const built = place === "tha-chalom" ? buildThaChalomRows({ ...input, viewer }) : buildBoardRows({ ...input, viewer });
  const row = [...built.rows, ...built.unmatched].find((item) => item.bookingId === bookingId);
  return row !== undefined && UNDER_WAY.has(row.status);
}
