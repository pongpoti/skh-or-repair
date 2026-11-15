import { NO_OPERATION_LABEL, type AddedCase } from "./added-cases.ts";
import { DEPARTMENTS, type DeptCode } from "./allocation.ts";
import { normalizeHn } from "./hn.ts";
import { placeAll } from "./placement.ts";
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

function departmentName(dept: DeptCode | null): string | null {
  return dept && Object.hasOwn(DEPARTMENTS, dept) ? DEPARTMENTS[dept].name : null;
}

/**
 * Merges the workbook and the bookings into the board's rows.
 *
 * Workbook cases are placed first, in file order, by the report's rules under `periods` (lib/placement.ts): the
 * same rooms the upload gave them, unless an admin has moved the repair's dates since, and then the rooms in use
 * under the new dates. Matching is one to one by normalised HN on the board's date, in a stable order: workbook cases
 * in file order each take the earliest booking with their HN that is still free. A matched pair is shown once, in the
 * booking's room (the surgeon reserved it), with the workbook's operation name and status. A workbook case left over
 * shows in the room placement gave it, flagged "unbooked". A booking left over shows in its room, flagged
 * "not-in-hosxp" only when a workbook was uploaded (without one there is nothing to compare with). A row whose room is
 * not open that day (closed, a recovery or instrument room, or a workbook case not placed) is left off the board.
 */
export function buildBoardRows({ date, periods, workbook, bookings, viewer }: BoardRowsInput): BoardRows {
  const uploaded = workbook !== null;
  const today = bookings.filter((item) => item.date === date);
  const cases = [...(workbook ?? [])].sort((a, b) => a.position - b.position);
  const placements = placeAll(cases, date, periods);
  const placedIn = new Map<WorkbookCase, string | null>();
  cases.forEach((item, index) => {
    const placement = placements[index];
    placedIn.set(item, placement.ok ? placement.roomId : null);
  });

  // The bookings waiting for a match, per HN, oldest first.
  const waiting = new Map<string, AddedCase[]>();
  for (const booking of today) {
    const key = normalizeHn(booking.hn);
    if (!key) continue;
    const queue = waiting.get(key);
    if (queue) queue.push(booking);
    else waiting.set(key, [booking]);
  }
  const pairs = new Map<WorkbookCase, AddedCase>();
  const taken = new Set<AddedCase>();
  for (const item of cases) {
    const key = normalizeHn(item.hn);
    const booking = key ? waiting.get(key)?.shift() : undefined;
    if (!booking) continue;
    pairs.set(item, booking);
    taken.add(booking);
  }

  const open = (roomId: string | null): roomId is string => roomId !== null && roomUse(roomId, date, periods) === "open";
  // The doctor who made a booking sees its HN; MX and admins see every HN.
  const seesHn = (booking: AddedCase) => viewer.allHn || (viewer.userId !== null && booking.surgeonId === viewer.userId);
  const rows: Omit<BoardRow, "order">[] = [];

  for (const item of cases) {
    const booking = pairs.get(item);
    if (booking) {
      const placed = placedIn.get(item) ?? null;
      const roomId = open(booking.roomId) ? booking.roomId : open(placed) ? placed : null;
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
    if (taken.has(booking) || !open(booking.roomId)) continue;
    rows.push({
      id: `bk-${booking.id}`,
      roomId: booking.roomId,
      procedure: booking.operation || NO_OPERATION_LABEL,
      surgeon: booking.surgeon,
      specialty: subtypeLabel("DR", booking.subtype),
      status: "scheduled",
      shift: booking.shift,
      source: "booking",
      flag: uploaded ? "not-in-hosxp" : null,
      ...(seesHn(booking) && booking.hn ? { hn: booking.hn } : {}),
      bookedBy: booking.surgeon,
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
