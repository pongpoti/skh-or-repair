import { bookedAtText, type AddedCase } from "./added-cases.ts";
import { allocationFor, DEPARTMENTS, type DeptCode } from "./allocation.ts";
import { buildBoardRows, type BoardRow, type BoardRows, type BoardViewer, type WorkbookCase } from "./board-rows.ts";
import { addDays } from "./days.ts";
import { isWorkday, type Holiday } from "./holidays.ts";
import type { RepairPeriods } from "./repair.ts";
import { roomsHeldBy } from "./placement.ts";
import { openRooms } from "./rooms.ts";
import type { CaseStatus, Shift } from "./schedule.ts";

/**
 * The demo schedule (Pong, 15 Nov 2026: "create a dummy OR schedule cases on all rooms, each room has at least 10
 * cases. Do it for first half and second half. Add section on admin setting to select which part to see."). An admin
 * opens it from /admin (demoDay below picks the day in each half) as /?demo=1: the board of that day
 * with these made-up cases in place of the real ones. Nothing is saved, and the real bookings and HOSxP uploads are
 * neither read nor touched.
 *
 * Every case is invented: the HNs start with 99 (a made-up range), the surgeons are "ตัวอย่าง หนึ่ง" to "ตัวอย่าง แปด",
 * and the operations are common names, never a real patient's row. The cases go through the board's own rules
 * (lib/board-rows.ts buildBoardRows, lib/placement.ts), so the demo looks as a real day would: most cases match a
 * booking, booked some days before at made-up times, some rooms have one HOSxP case nobody booked (the ! marks; not in
 * the dressing room, where booking does not matter), and the statuses and the out-of-hours shift show. No booking is
 * left without its HOSxP case: the board leaves those off once MX has uploaded (Pong, 15 Nov 2026). On a day outside the repair (a gap an admin left between the halves) the
 * weekly schedule's rooms get cases of their own departments the same way, and demoBoardRows makes sure of the 10
 * there too. Pure and isomorphic.
 */

/** The fewest cases in each open room (Pong: "each room has at least 10 cases"); a room gets 10 to 12. */
export const DEMO_MIN_CASES = 10;

/** A made-up case for a room: the department HOSxP gives it and the operation's name. */
type DemoCase = { dept: DeptCode; operation: string; team?: string };

/** A department's own cases. */
function own(dept: DeptCode, operations: readonly string[], team?: string): DemoCase[] {
  return operations.map((operation) => ({ dept, operation, ...(team ? { team } : {}) }));
}

/**
 * The cases by the room's use. The dressing room's names are all dressing names (lib/dressing.ts), so they go there by
 * the name too; the emergency room's are marked Emergency or Stat; the mixed room's are departments with no room of
 * their own during the repair, and endoscopies (a GENSX surgeon's EGD or colonoscopy, the SCOPE rule).
 */
const CASES: Partial<Record<DeptCode, readonly DemoCase[]>> = {
  GENSX: [
    { dept: "GENSX", operation: "Laparoscopic cholecystectomy" },
    { dept: "GENSX", operation: "Herniorrhaphy, right inguinal" },
    { dept: "GENSX", operation: "Excision of lipoma, back" },
    { dept: "GENSX", operation: "Total thyroidectomy" },
    { dept: "GENSX", operation: "Modified radical mastectomy, left" },
    { dept: "GENSX", operation: "Hemorrhoidectomy" },
    { dept: "GENSX", operation: "Excision of breast mass, right" },
    { dept: "GENSX", operation: "Laparoscopic appendectomy" },
    { dept: "GENSX", operation: "Wide excision, skin lesion, arm" },
    { dept: "GENSX", operation: "Right hemicolectomy" },
    { dept: "GENSX", operation: "Excision of thyroglossal cyst" },
    { dept: "GENSX", operation: "Laparoscopic hernia repair, bilateral" },
  ],
  ORTHO: [
    { dept: "ORTHO", operation: "ORIF distal radius, left" },
    { dept: "ORTHO", operation: "Total knee arthroplasty, right" },
    { dept: "ORTHO", operation: "Arthroscopic ACL reconstruction" },
    { dept: "ORTHO", operation: "Removal of implant, left tibia" },
    { dept: "ORTHO", operation: "Closed reduction and pinning, humerus" },
    { dept: "ORTHO", operation: "Carpal tunnel release, right" },
    { dept: "ORTHO", operation: "Bipolar hemiarthroplasty, left hip" },
    { dept: "ORTHO", operation: "ORIF ankle, right" },
    { dept: "ORTHO", operation: "Laminectomy L4-5" },
    { dept: "ORTHO", operation: "Trigger finger release" },
    { dept: "ORTHO", operation: "Intramedullary nailing, femur" },
    { dept: "ORTHO", operation: "Total hip arthroplasty, right" },
  ],
  MIXED: [
    { dept: "URO", operation: "TURP" },
    { dept: "ENT", operation: "Tonsillectomy" },
    { dept: "EYE", operation: "Phacoemulsification with IOL, right eye" },
    { dept: "GENSX", operation: "EGD with biopsy", team: "GENSX" },
    { dept: "VASCULAR", operation: "AV fistula creation, left arm" },
    { dept: "URO", operation: "Ureteroscopy with laser lithotripsy, left" },
    { dept: "PEDSX", operation: "Herniotomy, right" },
    { dept: "MAXILLO", operation: "Removal of impacted tooth 38" },
    { dept: "GENSX", operation: "Colonoscopy with polypectomy", team: "GENSX" },
    { dept: "ENT", operation: "Functional endoscopic sinus surgery" },
    { dept: "PLASTIC", operation: "Excision of keloid, ear" },
    { dept: "NEURO", operation: "Ventriculoperitoneal shunt" },
  ],
  EMER: [
    { dept: "GENSX", operation: "Appendectomy" },
    { dept: "ORTHO", operation: "Closed reduction and cast, distal radius" },
    { dept: "GENSX", operation: "Exploratory laparotomy" },
    { dept: "URO", operation: "Scrotal exploration" },
    { dept: "ORTHO", operation: "External fixation, open tibial fracture" },
    { dept: "PLASTIC", operation: "Repair of flexor tendon, right hand" },
    { dept: "GENSX", operation: "Repair of perforated peptic ulcer" },
    { dept: "ENT", operation: "Tracheostomy" },
    { dept: "PEDSX", operation: "Reduction of intussusception" },
    { dept: "GENSX", operation: "Laparoscopic appendectomy" },
    { dept: "ORTHO", operation: "Reduction of dislocated shoulder" },
    { dept: "URO", operation: "Suprapubic cystostomy" },
  ],
  INFECT: [
    { dept: "GENSX", operation: "Wound dressing, abdominal wound" },
    { dept: "ORTHO", operation: "Debridement, right foot" },
    { dept: "PLASTIC", operation: "VAC dressing, sacral wound" },
    { dept: "GENSX", operation: "I&D abscess, right thigh" },
    { dept: "ORTHO", operation: "Debridement and VAC, left leg" },
    { dept: "URO", operation: "Wound dressing, perineum" },
    { dept: "GENSX", operation: "Redressing, left breast" },
    { dept: "PLASTIC", operation: "D/S burn wound, both hands" },
    { dept: "ORTHO", operation: "Change VAC, below-knee stump" },
    { dept: "GENSX", operation: "I&D perianal abscess" },
    { dept: "GENSX", operation: "Debridement, diabetic foot" },
    { dept: "ORTHO", operation: "Wound dressing under GA, right knee" },
  ],
  // The weekly schedule's rooms, for a day outside the repair.
  // A GENSX surgeon's endoscopies: the SCOPE room's by the SCOPE rule (lib/placement.ts isScopeCase).
  SCOPE: own("GENSX", ["EGD with biopsy", "Colonoscopy with polypectomy", "ERCP with stent insertion", "EGD with variceal banding", "Flexible sigmoidoscopy", "EUS with FNA"], "GENSX"),
  VASCULAR: own("VASCULAR", ["AV fistula creation, left arm", "Endovenous laser ablation, right leg", "Femoral embolectomy", "Permanent catheter insertion", "Varicose vein stripping", "Carotid endarterectomy"]),
  OBGYN: own("OBGYN", ["Caesarean section", "Total abdominal hysterectomy", "Laparoscopic ovarian cystectomy", "Dilatation and curettage", "Tubal sterilization", "Myomectomy"]),
  EYE: own("EYE", ["Phacoemulsification with IOL, right eye", "Pterygium excision, left eye", "Trabeculectomy, left eye", "Pars plana vitrectomy, right eye", "Strabismus surgery", "Chalazion excision"]),
  URO: own("URO", ["TURP", "Ureteroscopy with laser lithotripsy, left", "Cystoscopy with DJ stent insertion", "PCNL, right", "Circumcision", "TUR-BT"]),
  PLASTIC: own("PLASTIC", ["Excision of keloid, ear", "Cleft lip repair", "Release of burn contracture, neck", "Local flap, nose", "Breast reduction", "Excision of skin tumour, cheek"]),
  ENT: own("ENT", ["Tonsillectomy", "Functional endoscopic sinus surgery", "Tympanoplasty, right ear", "Septoplasty", "Direct laryngoscopy with biopsy", "Parotidectomy, left"]),
  NEPHRO: own("NEPHRO", ["Tenckhoff catheter insertion", "Kidney biopsy", "Tunnelled dialysis catheter insertion", "Removal of Tenckhoff catheter", "Dialysis catheter exchange", "Peritoneal catheter repositioning"]),
  CHEST: own("CHEST", ["Bronchoscopy with BAL", "Medical thoracoscopy", "Indwelling pleural catheter", "Pleural biopsy", "Chest tube insertion", "Talc pleurodesis"]),
  PEDSX: own("PEDSX", ["Herniotomy, right", "Orchidopexy, left", "Pyloromyotomy", "Hypospadias repair", "Excision of thyroglossal cyst", "Circumcision"]),
  NEURO: own("NEURO", ["Ventriculoperitoneal shunt", "Craniotomy for tumour removal", "Burr hole drainage", "ACDF C5-6", "Lumbar microdiscectomy", "Cranioplasty"]),
  CVT: own("CVT", ["CABG", "Mitral valve replacement", "VATS wedge resection", "Pericardial window", "Decortication, right lung", "Aortic valve replacement"]),
  MAXILLO: own("MAXILLO", ["Removal of impacted tooth 38", "ORIF mandible", "Excision of ranula", "Enucleation of jaw cyst", "Arch bar removal", "Biopsy of oral lesion"]),
  MINOR: own("MINOR", ["Excision of sebaceous cyst", "Excision of lipoma, forearm", "Wedge excision, ingrown toenail", "Excision of skin tag", "Removal of foreign body, foot", "Excision of ganglion, wrist"]),
};

/** The made-up surgeons, with HOSxP's title for the workbook and the board's "ชื่อ นามสกุล" for the bookings. */
const SURGEONS = ["หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด"].map((last, i) => ({
  id: `demo-${i + 1}`,
  name: `ตัวอย่าง ${last}`,
  title: i % 3 === 1 ? "พญ." : "นพ.",
}));

/** A small stable number from a text, so each day and room gets its own mix and the same one on every reload. */
function seed(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** What the room's cases are, by its department that day; a department the list does not have gets its own name. */
function casesFor(code: DeptCode): readonly DemoCase[] {
  const own = CASES[code];
  if (own) return own;
  return Array.from({ length: 12 }, (_, i) => ({ dept: code, operation: `Elective operation ${i + 1}` }));
}

/** What one of a room's rows is: a HOSxP case with its booking, or a HOSxP case nobody booked. */
type Kind = "matched" | "hosxp";

/**
 * When a made-up booking was made: 5 to 11 days before the case at a time from 07:00 to 22:59 Bangkok, as an ISO time
 * (AddedCase.bookedAt), well before the booking form's cut-off (15:00 on the workday before).
 */
function bookedAtFor(date: string, mix: number): string {
  // Spread the seed's bits first: seeds of neighbouring cases differ only in their lowest bits.
  const spread = Math.imul(mix ^ (mix >>> 15), 2246822519) >>> 0;
  const day = addDays(date, -(5 + (spread % 7)));
  const hour = 7 + ((spread >>> 8) % 16);
  const minute = (spread >>> 16) % 60;
  return new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`).toISOString();
}

/**
 * The made-up HOSxP workbook and bookings for `date`: 10 to 12 cases in every open operating room, the dressing room
 * and the emergency room included. A recovery room, the instrument room and a closed room get none. Empty on a day
 * with no open room (a weekend).
 */
/** A made-up patient's name, written as the HOSxP export writes names (title, first name, family name). */
export function demoPatient(n: number): string {
  return `${["นาย", "นาง", "น.ส."][n % 3]} ตัวอย่าง ผู้ป่วย${n}`;
}

export function demoSchedule(date: string, periods: RepairPeriods): { workbook: WorkbookCase[]; bookings: AddedCase[] } {
  const workbook: WorkbookCase[] = [];
  const bookings: AddedCase[] = [];
  let position = 0;
  openRooms(date, periods).forEach((room, r) => {
    // A room holds no department at the weekend, so it gets no cases then.
    const code = allocationFor(room.id, date, periods)?.am?.code;
    if (!code) return;
    const list = casesFor(code);
    const mix = seed(`${date}|${room.id}`);
    const count = DEMO_MIN_CASES + (mix % 3);
    // Every other room has one HOSxP case nobody booked, so the ! marks show (the dressing room's is no mismatch).
    const flagged = r % 2 === 0;
    const emergency = code === "EMER";
    const dressing = code === "INFECT";
    for (let i = 0; i < count; i += 1) {
      const item = list[(mix + i) % list.length];
      const surgeon = SURGEONS[(r * 3 + i) % SURGEONS.length];
      const kind: Kind = flagged && i === 6 ? "hosxp" : "matched";
      const hn = `99${room.number.padStart(2, "0")}${String(i + 1).padStart(3, "0")}`;
      const id = `demo-${room.id}-${i + 1}`;
      // Late cases run out of hours in every other room.
      const shift: Shift = r % 2 === 1 && i >= count - 2 ? "out" : "in";
      position += 1;
      workbook.push({
        caseId: id,
        hn,
        patientName: demoPatient(position),
        operation: item.operation,
        surgeon: `${surgeon.title} ${surgeon.name}`,
        dept: item.dept,
        team: item.team ?? item.dept,
        urgency: emergency ? (i % 3 === 0 ? "Stat" : "Emergency") : "Elective",
        shift,
        status: statusOf(r, i),
        position,
      });
      if (kind === "matched") {
        bookings.push({
          id,
          date,
          roomId: room.id,
          hn,
          operation: item.operation,
          shift,
          dressing,
          // The dressing room's bookings answer the scrub question both ways, so both tags show.
          scrubDoes: dressing ? i % 2 === 0 : null,
          surgeonId: surgeon.id,
          surgeon: surgeon.name,
          subtype: item.dept,
          bookedAt: bookedAtFor(date, seed(`${date}|${room.id}|${i}`)),
        });
      }
    }
  });
  // Oldest booking first, as lib/cases.ts lists them: the board puts the booked cases in that order.
  bookings.sort((a, b) => (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "") || a.id.localeCompare(b.id));
  return { workbook, bookings };
}

/**
 * The demo's board rows for `date`: demoSchedule's cases through the board's own rules (buildBoardRows), then, for an
 * open room the rules left short of DEMO_MIN_CASES, more made-up rows straight in that room. That only happens outside
 * the repair (the weekly schedule pools a department's rooms and splits a room between two departments); in either
 * half every room gets its cases by the rules (lib/demo-schedule.test.ts). The added rows are booked cases, booked
 * after the others, so they go after the room's booked cases and before the ones nobody booked, as the board orders
 * them.
 */
export function demoBoardRows(date: string, periods: RepairPeriods, viewer: BoardViewer): BoardRows {
  const { workbook, bookings } = demoSchedule(date, periods);
  const built = buildBoardRows({ date, periods, workbook, bookings, viewer });
  const rows: BoardRow[] = [...built.rows];
  const countByRoom = { ...built.countByRoom };
  let matched = built.matched;
  const dressingRooms = roomsHeldBy("INFECT", date, periods);
  const bookedAt = bookedAtText(new Date(`${addDays(date, -4)}T21:00:00+07:00`).toISOString());
  openRooms(date, periods).forEach((room, r) => {
    const code = allocationFor(room.id, date, periods)?.am?.code;
    if (!code) return;
    const list = casesFor(code);
    for (let slot = (countByRoom[room.id] ?? 0) + 1; slot <= DEMO_MIN_CASES; slot += 1) {
      const item = list[slot % list.length];
      const surgeon = SURGEONS[(r + slot) % SURGEONS.length];
      rows.push({
        id: `demo-${room.id}-extra-${slot}`,
        roomId: room.id,
        order: slot,
        procedure: item.operation,
        surgeon: surgeon.name,
        specialty: DEPARTMENTS[item.dept].name,
        status: "scheduled",
        shift: "in",
        source: "matched",
        flag: null,
        ...(viewer.allHn ? { hn: `99${room.number.padStart(2, "0")}${500 + slot}`, patientName: demoPatient(500 + slot) } : {}),
        bookedBy: surgeon.name,
        bookedAt,
        ...(dressingRooms.includes(room.id) ? { doneBy: "surgeon" as const } : {}),
      });
      countByRoom[room.id] = slot;
      matched += 1;
    }
  });
  // The booked rows before the ones nobody booked (a stable sort keeps each group's order), numbered again per room.
  const booked = (row: BoardRow) => (row.source === "hosxp" ? 1 : 0);
  const order = new Map<string, number>();
  const sorted = rows.toSorted((a, b) => booked(a) - booked(b)).map((row) => {
    const slot = (order.get(row.roomId) ?? 0) + 1;
    order.set(row.roomId, slot);
    return { ...row, order: slot };
  });
  return { ...built, rows: sorted, matched, countByRoom };
}

/**
 * A case's status, so every mark shows somewhere: the first two of a room are done, the third is running in most rooms
 * (in the operating room or in recovery) and late in one, one case is cancelled in every third room, and the rest are
 * waiting.
 */
function statusOf(room: number, index: number): CaseStatus {
  if (index < 2) return "done";
  if (index === 2) return (["in-progress", "recovery", "delayed", "in-progress", "scheduled"] as const)[room % 5];
  if (index === 5 && room % 3 === 2) return "cancelled";
  return "scheduled";
}

/**
 * The day the demo shows for a half (1 or 2): the board's own day when it falls in that half, else the half's first
 * workday from today on, within `max` (the board's date picker's last day, lib/board-day.ts pickRange), so the board
 * accepts it as ?date=. Null when the half has no such day left (it is over).
 */
export function demoDay(
  half: 1 | 2,
  { today, boardDate, max, periods, holidays }: { today: string; boardDate: string; max: string; periods: RepairPeriods; holidays: readonly Holiday[] },
): string | null {
  const { from, to } = half === 1 ? periods.half1 : periods.half2;
  if (boardDate >= from && boardDate <= to) return boardDate;
  const last = to < max ? to : max;
  for (let day = from > today ? from : today; day <= last; day = addDays(day, 1)) {
    if (isWorkday(day, holidays)) return day;
  }
  return null;
}
