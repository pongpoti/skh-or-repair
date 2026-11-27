import { NO_OPERATION_LABEL, type AddedCase } from "./added-cases.ts";
import { allocationFor } from "./allocation.ts";
import { UPLOAD_CLOSES_MINUTES, UPLOAD_OPENS_MINUTES } from "./board-day.ts";
import { boardPlacements, buildBoardRows, buildThaChalomRows, thaChalomBoardPlacements, type WorkbookCase } from "./board-rows.ts";
import { bangkokParts } from "./days.ts";
import type { PlaceId } from "./places.ts";
import { UNPLACED_TEXT, type Placement, type UnplacedReason } from "./placement.ts";
import { repairOn, type RepairPeriods } from "./repair.ts";
import { getRoom, roomLabel, ROOMS } from "./rooms.ts";
import { THA_CHALOM_ROOM_LIST, thaChalomRoom, thaChalomRoomDept } from "./tha-chalom-schedule.ts";
import type { PlacedCase } from "./workbook-store.ts";
import {
  CUT_REASONS,
  DROP_REASONS,
  prepareUpload,
  type CutReason,
  type DropRule,
  type ParseOptions,
  type UploadSummary,
  type WorkbookRow,
} from "./workbook.ts";
import { readXlsx, type XlsxCell } from "./xlsx.ts";

/**
 * MX's upload, from the file's bytes to the cases the board stores, with nothing but arguments: read the .xlsx
 * (lib/xlsx.ts), parse, check every row is booked for the target day, filter and split by hospital (lib/workbook.ts),
 * place each case on the target day (lib/placement.ts under the repair periods; รพ.ท่าฉลอม's by its own table,
 * lib/tha-chalom-schedule.ts), count it all for the summary, and compare each hospital's cases with its doctors'
 * bookings (lib/board-rows.ts). No database, clock or network, so
 * the whole pipeline is tested on the sample file; app/upload/actions.ts adds the role, the window and the save.
 *
 * The summary holds counts only, so it can be stored with the upload (workbook_uploads.summary). The matching lists
 * carry HN and names: only the upload page shows them, to MX and admins. Nothing here is ever logged.
 */

// ---------------------------------------------------------------------------------------------------------------
// The upload window, for the page's refresh timer

/**
 * The next moment the upload page changes by itself: 15:00 (the window opens), 16:00 (it closes) or midnight (the
 * target day moves on), Bangkok time.
 */
export function nextWindowChange(at: Date): Date {
  const { date, minutes } = bangkokParts(at);
  const [y, m, d] = date.split("-").map(Number);
  // Bangkok midnight of `date` in UTC is 17:00 the day before.
  const midnight = Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
  const mark = [UPLOAD_OPENS_MINUTES, UPLOAD_CLOSES_MINUTES, 24 * 60].find((item) => item > minutes) ?? 24 * 60;
  return new Date(midnight + mark * 60_000);
}

/** Where a moment stands to MX's window: before 15:00, inside it, or from 16:00. */
export type WindowState = "before" | "open" | "after";

export function windowStateAt(at: Date): WindowState {
  const { minutes } = bangkokParts(at);
  return minutes < UPLOAD_OPENS_MINUTES ? "before" : minutes < UPLOAD_CLOSES_MINUTES ? "open" : "after";
}

// ---------------------------------------------------------------------------------------------------------------
// Placement and the summary

/** Placed cases in one room. `dept` is the room's department code that day (both halves of a split room). */
export type RoomCount = { roomId: string; room: string; dept: string | null; count: number };

export type UnplacedCount = { reason: UnplacedReason; label: string; count: number };

/** Where รพ.ท่าฉลอม's cases went (Pong, 27 Nov 2026: "Excel file include both place on one sheet"). */
export type ThaChalomSummary = {
  /** Its kept cases. */
  toPlace: number;
  placed: number;
  /** Its rooms that took at least one case, in the table's order. */
  rooms: RoomCount[];
  /** Its cases left off the board, by reason (no department, no room that day). */
  unplaced: UnplacedCount[];
};

/**
 * What the upload page shows and workbook_uploads.summary stores: lib/workbook.ts's counts (rows read, repeated IDs,
 * kept, dropped by rule, cut by reason, left to place), then where the cases went. Counts only: no HN, case ID or name.
 * The counts of the rules are both hospitals'; toPlace and the rest of the placement รพ.สมุทรสาคร's, and `thaChalom`
 * รพ.ท่าฉลอม's.
 */
export type FlowSummary = UploadSummary & {
  placed: number;
  /** Rooms that took at least one case, in room order. */
  rooms: RoomCount[];
  /** Cases left off the board, by reason (OB-GYN in the obstetric building during the repair, no department, no room). */
  unplaced: UnplacedCount[];
  /** The repair half the target day falls in, or null when the weekly schedule applies. */
  repairHalf: 1 | 2 | null;
  /** รพ.ท่าฉลอม's cases, or null for an upload saved before 27 Nov 2026, which cut them (UploadSummary.cut). */
  thaChalom: ThaChalomSummary | null;
};

/**
 * A kept text as stored. Fields are capped so a broken or hostile file cannot fill the table with one cell; a real
 * operation name or surgeon is far shorter.
 */
const capped = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

function placedCase(row: WorkbookRow, roomId: string | null, position: number, place: PlaceId = "skh"): PlacedCase {
  return {
    caseId: capped(row.caseId, 64),
    hn: capped(row.hn, 32),
    operation: capped(row.operation, 500),
    patientName: row.patientName ? capped(row.patientName, 200) : null,
    // Title first, as the board writes doctors ("นพ. ชื่อ นามสกุล").
    surgeon: capped([row.title, row.surgeon].filter(Boolean).join(" "), 200),
    dept: row.dept,
    team: row.team,
    roomId,
    shift: row.shift,
    status: row.status,
    urgency: row.urgency,
    bookedTime: row.bookedTime,
    position,
    ...(place === "skh" ? {} : { place }),
  };
}

/** The room's department code on `date`, as the plan labels it ("GENSX", or "PEDSX/GENSX" for a split room). */
function roomDept(roomId: string, date: string, periods: RepairPeriods): string | null {
  const allocation = allocationFor(roomId, date, periods);
  if (!allocation?.am) return allocation?.pm?.label ?? null;
  return allocation.split && allocation.pm ? `${allocation.am.label}/${allocation.pm.label}` : allocation.am.label;
}

export type Placed<T extends PlacedCase = PlacedCase> = { cases: T[]; rooms: RoomCount[]; unplaced: UnplacedCount[]; placed: number };

/** Each case with the room `placements` gave it, and the counts per room (`roomsOf`, in order) and per reason. */
function counted<T extends PlacedCase>(
  items: readonly T[],
  placements: readonly Placement[],
  roomsOf: (load: ReadonlyMap<string, number>) => RoomCount[],
): Placed<T> {
  const load = new Map<string, number>();
  const missed = new Map<UnplacedReason, number>();
  const cases = items.map((item, index) => {
    const placement = placements[index];
    if (placement.ok) load.set(placement.roomId, (load.get(placement.roomId) ?? 0) + 1);
    else missed.set(placement.reason, (missed.get(placement.reason) ?? 0) + 1);
    return { ...item, roomId: placement.ok ? placement.roomId : null };
  });
  const unplaced = (Object.keys(UNPLACED_TEXT) as UnplacedReason[])
    .filter((reason) => missed.has(reason))
    .map((reason) => ({ reason, label: UNPLACED_TEXT[reason], count: missed.get(reason) ?? 0 }));
  return { cases, rooms: roomsOf(load), unplaced, placed: cases.length - [...missed.values()].reduce((sum, n) => sum + n, 0) };
}

/**
 * Places each case on `date` where the board shows it (lib/board-rows.ts boardPlacements: lib/placement.ts placeAll in
 * file order, a case a doctor booked by the doctor's choice of room, or in the booking's own room when placement gives
 * none) and counts where they went. Every case is kept, placed or not (roomId null): the board leaves an unplaced case
 * off, but the stored list still says what HOSxP holds.
 */
export function placeCases<T extends PlacedCase>(
  items: readonly T[],
  date: string,
  periods: RepairPeriods,
  bookings: readonly AddedCase[] = [],
): Placed<T> {
  const placements = boardPlacements(items, bookings, date, periods);
  return counted(items, placements, (load) =>
    ROOMS.filter((room) => load.has(room.id)).map((room) => ({
      roomId: room.id,
      room: roomLabel(room),
      dept: roomDept(room.id, date, periods),
      count: load.get(room.id) ?? 0,
    })),
  );
}

/**
 * รพ.ท่าฉลอม's cases placed on `date` where its board shows them (by its table, lib/tha-chalom-schedule.ts placeThaChalom;
 * a case a doctor booked whose department the table gives no room that day, in the booking's room), with its doctors'
 * `bookings`, counted as placeCases counts รพ.สมุทรสาคร's.
 */
export function placeThaChalomCases<T extends PlacedCase>(items: readonly T[], date: string, bookings: readonly AddedCase[] = []): Placed<T> {
  return counted(items, thaChalomBoardPlacements(items, bookings, date), (load) =>
    THA_CHALOM_ROOM_LIST.filter((room) => load.has(room.id)).map((room) => ({
      roomId: room.id,
      room: room.name,
      dept: thaChalomRoomDept(room.id, date),
      count: load.get(room.id) ?? 0,
    })),
  );
}

/** รพ.ท่าฉลอม's part of the summary, from its placed cases. */
function thaChalomSummary(placed: Placed): ThaChalomSummary {
  return { toPlace: placed.cases.length, placed: placed.placed, rooms: placed.rooms, unplaced: placed.unplaced };
}

/**
 * The file's kept rows as they are stored, placed on `date`. The rows are placed as stored (operation names capped),
 * so the board, placing the stored cases again, finds the same rooms.
 */
export function placeRows(rows: readonly WorkbookRow[], date: string, periods: RepairPeriods, bookings: readonly AddedCase[] = []): Placed {
  return placeCases(
    rows.map((row, index) => placedCase(row, null, index + 1)),
    date,
    periods,
    bookings,
  );
}

/** รพ.ท่าฉลอม's kept rows as they are stored (each hospital's numbered from 1 in file order), placed on `date`. */
export function placeThaChalomRows(rows: readonly WorkbookRow[], date: string, bookings: readonly AddedCase[] = []): Placed {
  return placeThaChalomCases(
    rows.map((row, index) => placedCase(row, null, index + 1, "tha-chalom")),
    date,
    bookings,
  );
}

/**
 * A stored upload's summary with its placement (placed, per room, not placed, the repair's half) worked out again from
 * its stored cases under the dates in force now, as the board places them: an admin may have moved the repair's dates
 * since the upload, and a booking made since moves its case to the room the doctor chose. The counts of the rules (rows
 * read, dropped, cut) stay as stored. รพ.ท่าฉลอม's part, from its stored cases (`thaChalomCases`) and its bookings, only
 * for an upload that kept them (FlowSummary.thaChalom).
 */
export function placedSummary(
  summary: FlowSummary,
  cases: readonly PlacedCase[],
  date: string,
  periods: RepairPeriods,
  bookings: readonly AddedCase[] = [],
  thaChalomCases: readonly PlacedCase[] = [],
  thaChalomBookings: readonly AddedCase[] = [],
): FlowSummary {
  const placed = placeCases(cases, date, periods, bookings);
  return {
    ...summary,
    placed: placed.placed,
    rooms: placed.rooms,
    unplaced: placed.unplaced,
    repairHalf: repairOn(date, periods)?.half ?? null,
    thaChalom: summary.thaChalom ? thaChalomSummary(placeThaChalomCases(thaChalomCases, date, thaChalomBookings)) : null,
  };
}

/** Why a file is refused as a whole: it is not a readable .xlsx, its headers are not the export's, or a row is booked for another day. */
export type FlowRefusal = { ok: false; error: "file" | "headers" | "dates"; message: string };

export type ProcessedUpload = {
  ok: true;
  /** รพ.สมุทรสาคร's cases left after the filter, in file order, with its room (null when not placed). */
  cases: PlacedCase[];
  /** รพ.ท่าฉลอม's, the same way (each with `place`). */
  thaChalomCases: PlacedCase[];
  summary: FlowSummary;
};

export type FlowOptions = Omit<ParseOptions, "date1904">;

/**
 * The pipeline from sheet rows (lib/xlsx.ts readXlsx) for the target day under `periods`; a case one of `bookings`
 * (รพ.สมุทรสาคร's) or `thaChalomBookings` matches goes where the board shows it, as the doctor booked it.
 */
export function processSheet(
  sheet: { rows: readonly (readonly XlsxCell[])[]; date1904: boolean },
  target: string,
  periods: RepairPeriods,
  options: FlowOptions = {},
  bookings: readonly AddedCase[] = [],
  thaChalomBookings: readonly AddedCase[] = [],
): FlowRefusal | ProcessedUpload {
  const prepared = prepareUpload(sheet, target, options);
  if (!prepared.ok) return { ok: false, error: prepared.error, message: prepared.message };
  const placed = placeRows(prepared.cuts.kept, target, periods, bookings);
  const thaChalom = placeThaChalomRows(prepared.cuts.thaChalom, target, thaChalomBookings);
  return {
    ok: true,
    cases: placed.cases,
    thaChalomCases: thaChalom.cases,
    summary: {
      ...prepared.summary,
      placed: placed.placed,
      rooms: placed.rooms,
      unplaced: placed.unplaced,
      repairHalf: repairOn(target, periods)?.half ?? null,
      thaChalom: thaChalomSummary(thaChalom),
    },
  };
}

/** The pipeline from the file's bytes. A file that is not a readable .xlsx is refused with lib/xlsx.ts's Thai message. */
export function processWorkbook(
  data: Uint8Array | ArrayBuffer,
  target: string,
  periods: RepairPeriods,
  options: FlowOptions = {},
  bookings: readonly AddedCase[] = [],
  thaChalomBookings: readonly AddedCase[] = [],
): FlowRefusal | ProcessedUpload {
  const book = readXlsx(data);
  if (!book.ok) return { ok: false, error: "file", message: book.message };
  return processSheet(book, target, periods, options, bookings, thaChalomBookings);
}

// ---------------------------------------------------------------------------------------------------------------
// Matching with the bookings

/** One mismatch for MX: where it shows on the board, whose case, the HN and the operation. */
export type MatchRow = {
  /** A stable key for the list. */
  key: string;
  roomId: string;
  /** "OR 12". */
  room: string;
  surgeon: string;
  /** Null for a booking saved before bookings carried an HN. */
  hn: string | null;
  operation: string;
};

export type MatchReport = {
  /** The doctors' bookings on the day. */
  bookings: number;
  /** Workbook cases paired with a booking. */
  matched: number;
  /** Workbook cases on the board that nobody booked. */
  unbooked: MatchRow[];
  /** Bookings on the board that the workbook does not hold. */
  notInHosxp: MatchRow[];
};

/**
 * The upload's cases against the doctors' bookings on `date`, the board's way (lib/board-rows.ts buildBoardRows, as
 * MX sees it; buildThaChalomRows for รพ.ท่าฉลอม's, `place`): the unbooked cases are exactly the board's mismatch alert,
 * and the bookings HOSxP does not list are the ones the board leaves off since it has the upload (BoardRows.unmatched).
 * Rows the board would leave off anyway (a case not placed, a booking in a room that does not operate that day) are not
 * listed here either. `cases` and `bookings` are the one hospital's.
 */
export function matchBookings(input: {
  date: string;
  periods: RepairPeriods;
  cases: readonly WorkbookCase[];
  bookings: readonly AddedCase[];
  place?: PlaceId;
}): MatchReport {
  const tc = input.place === "tha-chalom";
  const rowsInput = {
    date: input.date,
    periods: input.periods,
    workbook: input.cases,
    bookings: input.bookings,
    viewer: { allHn: true, userId: null },
  };
  const board = tc ? buildThaChalomRows(rowsInput) : buildBoardRows(rowsInput);
  const roomName = (roomId: string) => {
    if (tc) return thaChalomRoom(roomId)?.name ?? roomId;
    const room = getRoom(roomId);
    return room ? roomLabel(room) : roomId;
  };
  // The board's own mismatches, and the bookings it leaves off because HOSxP does not list them (Pong, 15 Nov 2026).
  const listed = (flag: "unbooked" | "not-in-hosxp"): MatchRow[] =>
    (flag === "unbooked" ? board.rows : board.unmatched)
      .filter((row) => row.flag === flag)
      .map((row) => {
        return {
          key: row.id,
          roomId: row.roomId,
          room: roomName(row.roomId),
          surgeon: (flag === "not-in-hosxp" ? row.bookedBy : row.surgeon) ?? row.surgeon,
          hn: row.hn ?? null,
          operation: row.procedure || NO_OPERATION_LABEL,
        };
      });
  return {
    bookings: input.bookings.filter((booking) => booking.date === input.date).length,
    matched: board.matched,
    unbooked: listed("unbooked"),
    notInHosxp: listed("not-in-hosxp"),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The whole flow

export type UploadFlowInput = {
  /** The uploaded file. */
  data: Uint8Array | ArrayBuffer;
  /** The workday the file must list (lib/holidays.ts nextWorkdayAfter of the upload's Bangkok date). */
  target: string;
  periods: RepairPeriods;
  /** รพ.สมุทรสาคร's doctors' bookings (lib/cases.ts listCasesOn the target day); others are ignored. */
  bookings: readonly AddedCase[];
  /** รพ.ท่าฉลอม's (listCasesOn the target day there). */
  thaChalomBookings?: readonly AddedCase[];
  options?: FlowOptions;
};

export type UploadFlowResult = FlowRefusal | (ProcessedUpload & { matching: MatchReport; thaChalomMatching: MatchReport });

/** From the file's bytes to the cases to store, the summary and each hospital's matching with its bookings. */
export function runUploadFlow(input: UploadFlowInput): UploadFlowResult {
  const processed = processWorkbook(input.data, input.target, input.periods, input.options, input.bookings, input.thaChalomBookings);
  if (!processed.ok) return processed;
  const matching = matchBookings({ date: input.target, periods: input.periods, cases: processed.cases, bookings: input.bookings });
  const thaChalomMatching = matchBookings({
    date: input.target,
    periods: input.periods,
    cases: processed.thaChalomCases,
    bookings: input.thaChalomBookings ?? [],
    place: "tha-chalom",
  });
  return { ...processed, matching, thaChalomMatching };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a stored summary back

const count = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];

/** A stored summary's placement reasons, with today's labels. */
const unplacedOf = (v: unknown): UnplacedCount[] =>
  list(v)
    .filter((item) => typeof item.reason === "string" && Object.hasOwn(UNPLACED_TEXT, item.reason))
    .map((item) => ({
      reason: item.reason as UnplacedReason,
      label: UNPLACED_TEXT[item.reason as UnplacedReason],
      count: count(item.count),
    }));

/** รพ.ท่าฉลอม's part read back: its rooms checked against its own table (their ids are รพ.สมุทรสาคร's too). */
function readThaChalom(v: unknown): ThaChalomSummary | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const t = v as Record<string, unknown>;
  return {
    toPlace: count(t.toPlace),
    placed: count(t.placed),
    rooms: list(t.rooms).flatMap((item) => {
      const room = thaChalomRoom(text(item.roomId));
      return room ? [{ roomId: room.id, room: room.name, dept: text(item.dept) || null, count: count(item.count) }] : [];
    }),
    unplaced: unplacedOf(t.unplaced),
  };
}

/**
 * A summary read back from workbook_uploads.summary (jsonb), checked field by field: a row written by an older version
 * or edited by hand gives zeros and empty lists rather than breaking the page. Labels are taken from today's tables
 * when the reason is known. Null when the value is not a summary at all.
 */
export function readFlowSummary(json: unknown): FlowSummary | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const v = json as Record<string, unknown>;
  const half = v.repairHalf === 1 || v.repairHalf === 2 ? v.repairHalf : null;
  return {
    rows: count(v.rows),
    unique: count(v.unique),
    duplicates: count(v.duplicates),
    kept: count(v.kept),
    dropped: list(v.dropped)
      .filter((item) => typeof item.rule === "number" && Object.hasOwn(DROP_REASONS, item.rule))
      .map((item) => ({ rule: item.rule as DropRule, reason: DROP_REASONS[item.rule as DropRule], count: count(item.count) })),
    cut: list(v.cut)
      .filter((item) => typeof item.reason === "string" && Object.hasOwn(CUT_REASONS, item.reason))
      .map((item) => ({ reason: item.reason as CutReason, label: CUT_REASONS[item.reason as CutReason], count: count(item.count) })),
    toPlace: count(v.toPlace),
    placed: count(v.placed),
    rooms: list(v.rooms).flatMap((item) => {
      const room = getRoom(text(item.roomId));
      return room ? [{ roomId: room.id, room: roomLabel(room), dept: text(item.dept) || null, count: count(item.count) }] : [];
    }),
    unplaced: unplacedOf(v.unplaced),
    repairHalf: half,
    thaChalom: readThaChalom(v.thaChalom),
  };
}
