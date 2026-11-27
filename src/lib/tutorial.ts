import { bookingDept, bookingRoom, type AddedCase } from "./added-cases.ts";
import type { DeptCode } from "./allocation.ts";
import type { BoardNotice } from "./board-notices.ts";
import { buildBoardRows, type BoardRows, type WorkbookCase } from "./board-rows.ts";
import type { RepairPeriods } from "./repair.ts";

/**
 * The doctors' tutorial (Pong, 19 Nov 2026: "create user-friendly step-by-step interactive tutorial guide with dummy
 * example (just like start of mobile game app), also explain details of symbols. Note that this tutorial is for DR role
 * only"): a made-up day on the real board, which the doctor walks through at /tutorial (components/tutorial.tsx). Pure
 * and isomorphic: the page builds the day again in the browser after each step, through the board's own rules
 * (lib/board-rows.ts buildBoardRows), so every icon and mark shows as it would on a real day. Nothing here is saved.
 */

/** The practice booking's id and the doctor's id on the made-up day: the doctor sees the HN of this booking alone. */
export const TUTORIAL_ME = "tutorial-me";

/** The badge first in the strip, so the made-up cases are never taken for the day's real list. */
export const TUTORIAL_NOTICE: BoardNotice = {
  id: "demo",
  tone: "neutral",
  icon: "flask",
  text: "บทเรียน · เคสตัวอย่าง ไม่ใช่ข้อมูลจริง",
  short: "บทเรียน",
  detail: "เคสสมมติ ไม่ได้บันทึก ไม่กระทบการจองจริง",
  testId: "tutorial-notice",
};

/** Before MX's upload (the doctors' bookings alone) or after it (HOSxP's list matched with the bookings). */
export type TutorialPhase = "before" | "after";

/** The made-up doctors, each with HOSxP's title for the workbook. */
const KIND = { name: "ตัวอย่าง ใจดี", title: "พญ." };
const STEADY = { name: "ตัวอย่าง มั่นคง", title: "นพ." };
const BONE = { name: "ตัวอย่าง กระดูกดี", title: "นพ." };
const SKIN = { name: "ตัวอย่าง ผิวสวย", title: "พญ." };

/** A name long enough to be cut on a phone's line, so the doctor can unfold it. */
export const LONG_OPERATION = "Laparoscopic assisted right hemicolectomy with primary anastomosis";

/**
 * HOSxP's case nobody booked whose name reads as a dressing (lib/dressing.ts): the board puts it in the dressing room by
 * itself, not general surgery's room (Pong, 20 Nov 2026: "show how app automatically assign some cases to dressing
 * room").
 */
export const AUTO_DRESSING_OPERATION = "I&D abscess, right thigh";

/**
 * The names the dressing-room card shows with where the board puts each when nobody booked it (the card asks the rule
 * itself): three dressings, then a graft, which stays in its department's room.
 */
export const DRESSING_EXAMPLES = ["I&D abscess", "Debridement", "D/S + VAC", "STSG"] as const;

/**
 * The department the practice booking goes by: the doctor's own, unless it has no room on the day (obstetrics during
 * the repair operates in its own building), when general surgery stands in so the practice booking can be made.
 */
export function practiceSubtype(subtype: string | null | undefined, date: string, periods: RepairPeriods): string {
  const own = typeof subtype === "string" ? subtype.trim() : "";
  if (own && bookingRoom(own, "practice", date, periods, "dept").ok) return own;
  return "GENSX";
}

/**
 * The cookie the tutorial sets when someone starts or skips it on their first visit, holding their users.id: the board
 * reads it as well as their tutorial_seen row, so a skip never comes back because the row was not written yet, or could
 * not be. Doctors since 19 Nov 2026; the rest of the staff (RN, PN, PCA, MX) since 27 Nov 2026, when Pong turned their
 * tutorial from every app open to once ("Disable always-on").
 */
export const TUTORIAL_COOKIE = "tutorial_seen";

/** Who the tutorial is for: a doctor (with the practice booking) or the rest of the staff (looking only). */
export type TutorialAudience = "doctor" | "staff";

/** The board a tutorial goes back to: รพ.ท่าฉลอม's when the staff member was sent from there, else รพ.สมุทรสาคร's. */
export function tutorialBack(back: string | undefined): "skh" | "tha-chalom" {
  return back === "tha-chalom" ? "tha-chalom" : "skh";
}

/** The room the doctor's practice booking takes (their department's room that day), or null when none can. */
export function practiceRoom(subtype: string, date: string, periods: RepairPeriods): string | null {
  const room = bookingRoom(subtype, "practice", date, periods, "dept");
  return room.ok ? room.roomId : null;
}

/**
 * An ISO time on the day before `today`, `hour`:`minute` in Bangkok: when the made-up doctors booked. Always in the past,
 * so always before the doctor's own practice booking: a room's list puts the earliest booking first, and the times on
 * the rows have to agree with the order the tutorial teaches.
 */
function eveAt(today: string, hour: number, minute: number): string {
  const [y, m, d] = today.split("-").map(Number);
  // Bangkok is UTC+7 all year.
  return new Date(Date.UTC(y, m - 1, d - 1, hour - 7, minute)).toISOString();
}

/** One made-up booking: its room is worked out the way the form works it out. */
function booking(
  id: string,
  date: string,
  periods: RepairPeriods,
  who: { name: string },
  subtype: string,
  operation: string,
  hn: string,
  bookedAt: string,
  more: { dressing?: boolean; scrubDoes?: boolean | null; note?: string; time?: [number, number] } = {},
): AddedCase | null {
  const dressing = more.dressing ?? false;
  const room = bookingRoom(subtype, operation, date, periods, dressing ? "dressing" : "dept");
  if (!room.ok) return null;
  return {
    id,
    date,
    roomId: room.roomId,
    hn,
    operation,
    shift: "in",
    dressing,
    scrubDoes: dressing ? (more.scrubDoes ?? null) : null,
    note: more.note ?? "",
    surgeonId: id,
    surgeon: who.name,
    subtype,
    bookedAt,
    start: more.time?.[0] ?? null,
    end: more.time?.[1] ?? null,
  };
}

/** One row of the made-up HOSxP list. */
function hosxp(position: number, hn: string, operation: string, who: { name: string; title: string }, dept: DeptCode, more: Partial<WorkbookCase> = {}): WorkbookCase {
  return {
    caseId: `tutorial-${position}`,
    hn,
    operation,
    surgeon: `${who.title} ${who.name}`,
    dept,
    team: dept,
    urgency: "Elective",
    shift: "in",
    status: "scheduled",
    position,
    patientName: null,
    ...more,
  };
}

/**
 * The made-up day: the bookings of three made-up doctors and, after the upload, HOSxP's list.
 * - A colleague of the doctor's own department booked a long-named case in the same room, with a note to the team; HOSxP
 *   lists it, so it is matched (a handshake) and its name can be unfolded.
 * - An orthopaedic surgeon (general surgery when the doctor is one) booked a case HOSxP does not list: it is on the
 *   board before the upload and gone after it.
 * - A plastic surgeon booked a dressing for the scrub nurse; HOSxP lists it (the nurse's portrait).
 * - HOSxP adds, nobody having booked them: a case in the doctor's room (a database icon, after the booked cases, and
 *   the room's "!") and a general surgery case whose name reads as a dressing, which the board puts in the dressing room
 *   by itself (the doctor's portrait). Both in hours: MX's upload drops out-of-hours cases, so the real board never
 *   shows one.
 * - The made-up doctors booked the day before `today` (the real one), before the doctor's own practice booking.
 * - The doctor's own practice booking (`mine`), once made; HOSxP lists it under the HN they typed, with a made-up
 *   patient's name only they see.
 */
export function tutorialCases({
  date,
  today,
  periods,
  doctor,
  mine,
}: {
  date: string;
  /** The real today, for the made-up bookings' times. */
  today: string;
  periods: RepairPeriods;
  doctor: { name: string; subtype: string };
  mine: AddedCase | null;
}): { bookings: AddedCase[]; workbook: WorkbookCase[] } {
  const dept = bookingDept(doctor.subtype) ?? "GENSX";
  const other = dept === "ORTHO" ? "GENSX" : "ORTHO";
  // Never one of the doctor's own: a made-up HN equal to the practice one would pair with it.
  const used = new Set(mine?.hn ? [mine.hn] : []);
  let next = 9900101;
  const hn = () => {
    while (used.has(String(next))) next += 1;
    used.add(String(next));
    return String(next++);
  };
  const colleagueHn = hn();
  const goneHn = hn();
  const dressingHn = hn();

  const made = [
    booking("tutorial-gone", date, periods, BONE, other, other === "ORTHO" ? "ORIF distal radius, left" : "Herniorrhaphy, right inguinal", goneHn, eveAt(today, 9, 12), {
      time: [9 * 60, 10 * 60 + 30],
    }),
    booking("tutorial-dressing", date, periods, SKIN, "PLASTIC", "D/S + VAC, sacral wound", dressingHn, eveAt(today, 10, 5), {
      dressing: true,
      // The doctor's own: the case HOSxP lists that nobody booked is the scrub nurse's (Pong, 27 Nov 2026), so the
      // room shows both portraits.
      scrubDoes: false,
      time: [9 * 60 + 30, 10 * 60],
    }),
    // The morning of the doctor's own room: the practice booking takes a time after it.
    booking("tutorial-colleague", date, periods, KIND, doctor.subtype, LONG_OPERATION, colleagueHn, eveAt(today, 11, 41), {
      note: "เตรียมเลือด 2 unit\nขอ ultrasound",
      time: [8 * 60 + 30, 10 * 60 + 30],
    }),
  ].filter((item): item is AddedCase => item !== null);
  const bookings = mine ? [...made, mine] : made;

  const workbook = [
    hosxp(1, colleagueHn, LONG_OPERATION, KIND, dept),
    hosxp(2, dressingHn, "D/S + VAC, sacral wound", SKIN, "PLASTIC"),
    hosxp(3, hn(), "Excision of lipoma, back", STEADY, dept),
    hosxp(4, hn(), AUTO_DRESSING_OPERATION, STEADY, "GENSX"),
  ];
  if (mine?.hn) {
    workbook.unshift(
      hosxp(0, mine.hn, mine.operation, { name: doctor.name, title: "" }, dept, { surgeon: doctor.name, patientName: "ตัวอย่าง ผู้ป่วย" }),
    );
  }
  return { bookings, workbook };
}

/** The made-up day's rows as the doctor sees them, before or after the upload. */
export function tutorialBoard(input: {
  date: string;
  today: string;
  periods: RepairPeriods;
  doctor: { name: string; subtype: string };
  mine: AddedCase | null;
  phase: TutorialPhase;
  /** MX sees every HN on the real board, so on the made-up day too. */
  allHn?: boolean;
}): BoardRows {
  const { bookings, workbook } = tutorialCases(input);
  return buildBoardRows({
    date: input.date,
    periods: input.periods,
    workbook: input.phase === "after" ? workbook : null,
    bookings,
    viewer: { allHn: input.allHn ?? false, userId: TUTORIAL_ME },
  });
}
