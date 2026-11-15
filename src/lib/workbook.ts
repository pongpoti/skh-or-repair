import { SURGEONS } from "../data/surgeons.ts";
import type { DeptCode } from "./allocation.ts";
import { isEmergencyUrgency } from "./placement.ts";
import { isDressingCase, isScopeCase, resolveSurgeon } from "./week.ts";
import type { XlsxCell } from "./xlsx.ts";

/**
 * The HOSxP OR export that MX uploads every afternoon, from sheet rows to the cases the board needs.
 *
 * Pure and isomorphic: lib/xlsx.ts reads the file, this module reads its rows. The steps follow the extraction rules
 * written with Pong (sections 2 to 10): find the columns by their Thai headers, clean the values, check that every row
 * is booked for the target day (rule set B, step one), drop what is not an in-hours elective case (rule set B, step
 * two), count a repeated case ID once, and cut the rows the board never shows whatever the rooms are (rule set C:
 * Tha Chalom, vascular on Tuesday to Thursday). Choosing a room is placeCase's job (lib/placement.ts).
 *
 * Privacy: the export holds patient name, age, AN, diagnosis, illnesses and costs. None of them is read into a
 * WorkbookRow, so they cannot reach the database, the page or a log. HN is kept as written, for matching bookings.
 */

type SheetRows = readonly (readonly XlsxCell[])[];

/** Headers the extraction rules require (section 2). `เวลา` appears twice; the first is the request time. */
export const REQUIRED_HEADERS = [
  "ID",
  "สถานะภาพ",
  "HN",
  "ชื่อการผ่าตัด",
  "แพทย์ผู้สั่ง",
  "ความเร่งด่วน",
  "วันที่",
  "เวลา",
  "แผนก",
  "ชนิด",
  "เวร",
  "สั่งผ่าตัดวันที่",
  "สั่งผ่าตัดเวลา",
  "ห้องผ่าตัด",
] as const;

// ---------------------------------------------------------------------------------------------------------------
// Cleaning (section 4)

/** Trim, collapse whitespace and drop invisible format characters; blank cells become "". */
export function cleanText(value: XlsxCell | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Header names compare without spaces or case, so "Pre. Dx." and a stray double space still match. */
const headerKey = (value: XlsxCell | undefined) => cleanText(value).replace(/\s+/g, "").toLowerCase();

/** The column of `name` in the header row, counting repeats: `เวลา` 1 is column R, `เวลา` 2 is column AF. -1 if absent. */
export function headerIndex(header: readonly XlsxCell[], name: string, occurrence = 1): number {
  const key = headerKey(name);
  let seen = 0;
  for (let index = 0; index < header.length; index += 1) {
    if (headerKey(header[index]) === key && ++seen === occurrence) return index;
  }
  return -1;
}

/** The required headers the row lacks, in the rules' order. */
export function missingHeaders(header: readonly XlsxCell[]): string[] {
  return REQUIRED_HEADERS.filter((name) => headerIndex(header, name) < 0);
}

export type WorkbookStatus = "scheduled" | "in-progress" | "done" | "cancelled";

const STATUS: Record<string, WorkbookStatus> = {
  ผ่าตัดเสร็จแล้ว: "done",
  ยกเลิกการผ่าตัด: "cancelled",
  กำลังผ่าตัด: "in-progress",
  รอผ่าตัด: "scheduled",
};

/** Blank or unknown is scheduled. Any wording with ยกเลิก is cancelled, so a cancelled case never shows as booked. */
function statusOf(text: string): WorkbookStatus {
  const key = text.replace(/\s+/g, "");
  return STATUS[key] ?? (key.includes("ยกเลิก") ? "cancelled" : "scheduled");
}

export type Urgency = "Elective" | "Urgency" | "Stat" | "Emergency";

/** `Unknow` (sic), blank and anything else are no label. */
function urgencyOf(text: string): Urgency | null {
  const key = text.toLowerCase();
  return (["Elective", "Urgency", "Stat", "Emergency"] as const).find((label) => label.toLowerCase() === key) ?? null;
}

export type WorkbookShift = "in" | "out";

/** นอกเวลา and นอกเวลา (วิสัญญี) are out of hours, ในเวลา… in hours, ไม่ระบุ or blank unknown. */
function shiftOf(text: string): WorkbookShift | null {
  if (text.startsWith("นอกเวลา")) return "out";
  if (text.startsWith("ในเวลา")) return "in";
  return null;
}

/** Title spellings by their letters alone: น.พ. and นพ. are the same title. */
const TITLES: Record<string, string> = { นพ: "นพ.", พญ: "พญ.", ทพ: "ทพ.", ทพญ: "ทพญ." };

const normaliseTitle = (title: string) => TITLES[title.replace(/[.\s]/g, "")] ?? title;

/**
 * "ตัวอย่าง ศัลย์ทั่วไป (นพ.)" → name "ตัวอย่าง ศัลย์ทั่วไป", title "นพ." (with or without a space before the bracket).
 * A leading title is taken only with its dot, so a first name such as นพดล stays whole.
 */
export function splitSurgeon(text: XlsxCell | undefined): { name: string; title: string } {
  const clean = cleanText(text);
  const bracket = /^(.*?)\s*\(([^()]*)\)$/.exec(clean);
  if (bracket) return { name: bracket[1].trim(), title: normaliseTitle(bracket[2].trim()) };
  const lead = /^(น\.\s?พ\.|นพ\.|พ\.\s?ญ\.|พญ\.)\s*(.+)$/.exec(clean);
  if (lead) return { name: lead[2], title: normaliseTitle(lead[1]) };
  return { name: clean, title: "" };
}

const THAI_DIGITS = /[๐-๙]/g;
const asciiDigits = (text: string) => text.replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50));

const THAI_MONTHS = [
  ["ม.ค.", "มกราคม"],
  ["ก.พ.", "กุมภาพันธ์"],
  ["มี.ค.", "มีนาคม"],
  ["เม.ย.", "เมษายน"],
  ["พ.ค.", "พฤษภาคม"],
  ["มิ.ย.", "มิถุนายน"],
  ["ก.ค.", "กรกฎาคม"],
  ["ส.ค.", "สิงหาคม"],
  ["ก.ย.", "กันยายน"],
  ["ต.ค.", "ตุลาคม"],
  ["พ.ย.", "พฤศจิกายน"],
  ["ธ.ค.", "ธันวาคม"],
] as const;

const monthKey = (text: string) => text.replace(/[.\s]/g, "");

/** An ISO date, or null when the parts are not a real day. Years from 2400 are Buddhist (2569 → 2026). */
function isoOf(year: number, month: number, day: number): string | null {
  const y = year >= 2400 ? year - 543 : year;
  if (y < 1900 || y > 2200 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(y, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

/**
 * A date cell as an ISO date. Numbers are Excel serials (1900 system, or the 1904 system when the workbook says so);
 * text is d/m/y (Thai order), y-m-d or "5 พ.ย. 2569", with a Buddhist year taken back by 543. Null when unreadable.
 */
export function parseDateCell(value: XlsxCell | undefined, date1904 = false): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < (date1904 ? 0 : 1) || value >= 2_958_466) return null;
    const days = Math.floor(value);
    // The 1900 system counts a 29 Feb 1900 that never was (serial 60); serials before it are one day off.
    if (!date1904 && days === 60) return null;
    const base = date1904 ? Date.UTC(1904, 0, 1) : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
    const date = new Date(base + days * DAY_MS);
    // A Buddhist year typed into a real date cell (5/11/2569) gives a serial in the 26th century.
    return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof value !== "string") return null;
  const text = asciiDigits(cleanText(value));
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (ymd) return isoOf(+ymd[1], +ymd[2], +ymd[3]);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/.exec(text);
  if (dmy) return isoOf(+dmy[3], +dmy[2], +dmy[1]);
  // Words of the month name are split by one space each: an optional space here would backtrack exponentially.
  const named = /^(\d{1,2})\s*([^\d\s]+(?:\s[^\d\s]+)*)\s*(\d{4})(?:\s.*)?$/.exec(text);
  if (named) {
    const month = THAI_MONTHS.findIndex((names) => names.some((name) => monthKey(name) === monthKey(named[2])));
    if (month >= 0) return isoOf(+named[3], month + 1, +named[1]);
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function clock(seconds: number): string {
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  return ss ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(hh)}:${pad(mm)}`;
}

/**
 * A time cell as "HH:MM" ("HH:MM:SS" when it has seconds). Numbers are a fraction of a day (a date-and-time serial
 * keeps its time; a whole number is a date with no time, so null). Text is "9:00", "09.00", "9:00 น." or a date and time.
 */
export function parseTimeCell(value: XlsxCell | undefined): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const fraction = value - Math.floor(value);
    if (value >= 1 && fraction === 0) return null;
    return clock(Math.min(86_399, Math.round(fraction * 86_400)));
  }
  if (typeof value !== "string") return null;
  const text = asciiDigits(cleanText(value));
  // A dot separates hours only when the cell is a time alone ("09.30"), never inside a date ("05.11.2569").
  const parts =
    /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(?:น\.?)?$/.exec(text) ?? /(?:^|\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!parts) return null;
  const [hh, mm, ss] = [+parts[1], +parts[2], +(parts[3] ?? 0)];
  return hh < 24 && mm < 60 && ss < 60 ? clock(hh * 3600 + mm * 60 + ss) : null;
}

const secondsOf = (time: string) => time.split(":").reduce((total, part, index) => total + +part * [3600, 60, 1][index], 0);

// ---------------------------------------------------------------------------------------------------------------
// Departments (section 9, plus Neuro → NEURO)

/** แผนก (column T) by its Thai name, spaces removed. */
const DEPT_BY_NAME: Record<string, DeptCode> = {
  ศัลยกรรม: "GENSX",
  ศัลยกรรมกระดูก: "ORTHO",
  จักษุ: "EYE",
  ศัลยกรรมทางเดินปัสสาวะ: "URO",
  ศัลยกรรมหลอดเลือด: "VASCULAR",
  โสตศอนาสิก: "ENT",
  นรีเวชกรรม: "OBGYN",
  สูติกรรม: "OBGYN",
  ศัลยกรรมตกแต่ง: "PLASTIC",
  ศัลยกรรมหัวใจและหลอดเลือด: "CVT",
  ศัลยกรรมหัวใจและทรวงอก: "CVT",
  ศัลยกรรมทรวงอก: "CVT",
};

/** ชนิด (column U) by its code, upper case. */
const DEPT_BY_TYPE: Record<string, DeptCode> = {
  GEN: "GENSX",
  ORTHO: "ORTHO",
  EYE: "EYE",
  URO: "URO",
  ENT: "ENT",
  PLASTIC: "PLASTIC",
  GYN: "OBGYN",
  OBS: "OBGYN",
  "OBS/PED": "OBGYN",
  CVT: "CVT",
  MAXILLO: "MAXILLO",
  NEURO: "NEURO",
};

/** Where a row's department came from: แผนก, ชนิด, the surgeon list, or the surgeon's usual department in the file. */
export type DeptSource = "dept" | "type" | "surgeon" | "file";

/** The department from the row's own columns: แผนก first, then ชนิด (a แผนก the table does not know falls through). */
export function deptOfColumns(deptText: string, typeText: string): { dept: DeptCode; from: DeptSource } | null {
  const byName = DEPT_BY_NAME[deptText.replace(/\s+/g, "")];
  if (byName) return { dept: byName, from: "dept" };
  const byType = DEPT_BY_TYPE[typeText.replace(/\s+/g, "").toUpperCase()];
  return byType ? { dept: byType, from: "type" } : null;
}

let listed: Map<string, DeptCode> | null = null;

/**
 * The surgeon's specialty from the supplied lists: the surgeon list (src/data/surgeons.ts) with its specialty codes,
 * else the physician list's team (resolveSurgeon). Null for a name on neither.
 */
export function surgeonDept(name: string, title: string): DeptCode | null {
  listed ??= new Map(SURGEONS.map((surgeon) => [cleanText(surgeon.name), surgeon.specialty]));
  return listed.get(cleanText(name)) ?? resolveSurgeon(name, title).team;
}

// ---------------------------------------------------------------------------------------------------------------
// Rows

/** One case from the export, holding only what the board and the upload rules need. */
export type WorkbookRow = {
  /** The sheet row number Excel shows (the header is 1), for messages to MX. */
  line: number;
  caseId: string;
  /** As written in the export (text, leading zeros kept). Matching against bookings normalises it elsewhere. */
  hn: string;
  operation: string;
  /** The surgeon's name without the title. */
  surgeon: string;
  /** นพ., พญ. … or "" (น.พ. and พ.ญ. normalised). */
  title: string;
  status: WorkbookStatus;
  urgency: Urgency | null;
  /** Marked Stat or Emergency. */
  emergency: boolean;
  shift: WorkbookShift | null;
  /** สั่งผ่าตัดวันที่ (W), the booked operation date, as an ISO date. */
  bookedDate: string | null;
  /** สั่งผ่าตัดเวลา (X), "HH:MM" ("HH:MM:SS" when it has seconds), often blank. */
  bookedTime: string | null;
  dept: DeptCode | null;
  deptFrom: DeptSource | null;
  /**
   * The team the SCOPE rule checks (placeCase's `team`): the surgeon's team in the physician list, else the row's
   * department, so a general surgeon missing from the list still takes an endoscopy to the SCOPE room.
   */
  team: string | null;
  /** A row of the partner hospital (รพ.นครท่าฉลอม) by its แผนก, room or operation text. */
  thaChalom: boolean;
  /** "SMC" in the operation text: the after-hours private list. */
  smc: boolean;
  dressing: boolean;
  scope: boolean;
};

export type ParseOptions = {
  /** The workbook uses the 1904 date system (XlsxResult.date1904). */
  date1904?: boolean;
  /** A surgeon's specialty; defaults to the supplied lists. The server may pass the admin's surgeon table instead. */
  surgeonDept?: (name: string, title: string) => DeptCode | null;
};

export type ParseResult =
  | { ok: true; rows: WorkbookRow[]; missingHeaders: [] }
  | { ok: false; rows: []; missingHeaders: string[]; message: string };

const isBlankRow = (row: readonly XlsxCell[]) => row.every((cell) => cleanText(cell) === "");

/**
 * Sheet rows (lib/xlsx.ts) to WorkbookRows. The header is the first row that is not blank (row 1 in the export);
 * columns are found by header name, so a reordered export still reads. Blank rows are skipped.
 */
export function parseExport(sheetRows: SheetRows, options: ParseOptions = {}): ParseResult {
  const headerAt = sheetRows.findIndex((row) => !isBlankRow(row));
  const header = headerAt >= 0 ? sheetRows[headerAt] : [];
  const missing = missingHeaders(header);
  if (missing.length > 0) {
    const message = `ไม่พบหัวคอลัมน์ ${missing.join(", ")} กรุณาใช้ไฟล์ที่ส่งออกจาก HOSxP โดยไม่แก้หัวตาราง`;
    return { ok: false, rows: [], missingHeaders: missing, message };
  }
  const col = (name: (typeof REQUIRED_HEADERS)[number]) => headerIndex(header, name);
  const at = {
    id: col("ID"),
    status: col("สถานะภาพ"),
    hn: col("HN"),
    operation: col("ชื่อการผ่าตัด"),
    surgeon: col("แพทย์ผู้สั่ง"),
    urgency: col("ความเร่งด่วน"),
    dept: col("แผนก"),
    type: col("ชนิด"),
    shift: col("เวร"),
    bookedDate: col("สั่งผ่าตัดวันที่"),
    bookedTime: col("สั่งผ่าตัดเวลา"),
    room: col("ห้องผ่าตัด"),
  };
  const lookUp = options.surgeonDept ?? surgeonDept;

  const rows: WorkbookRow[] = [];
  for (let index = headerAt + 1; index < sheetRows.length; index += 1) {
    const cells = sheetRows[index];
    if (isBlankRow(cells)) continue;
    const text = (column: number) => cleanText(cells[column]);
    const operation = text(at.operation);
    const { name, title } = splitSurgeon(cells[at.surgeon]);
    const deptText = text(at.dept);
    const fromColumns = deptOfColumns(deptText, text(at.type));
    const fromSurgeon = fromColumns ? null : lookUp(name, title);
    const urgency = urgencyOf(text(at.urgency));
    rows.push({
      line: index + 1,
      caseId: text(at.id),
      hn: text(at.hn),
      operation,
      surgeon: name,
      title,
      status: statusOf(text(at.status)),
      urgency,
      emergency: isEmergencyUrgency(urgency),
      shift: shiftOf(text(at.shift)),
      bookedDate: parseDateCell(cells[at.bookedDate], options.date1904),
      bookedTime: parseTimeCell(cells[at.bookedTime]),
      dept: fromColumns?.dept ?? fromSurgeon,
      deptFrom: fromColumns?.from ?? (fromSurgeon ? "surgeon" : null),
      team: null,
      thaChalom: [deptText, text(at.room), operation].some((value) => value.includes("ท่าฉลอม")),
      smc: /\bsmc\b/i.test(operation),
      dressing: isDressingCase(operation),
      scope: false,
    });
  }

  // A surgeon on no list, with both department columns blank, takes the department they have most often in this
  // file (ties go to the one seen first).
  const usual = new Map<string, Map<DeptCode, number>>();
  for (const row of rows) {
    if (!row.dept || (row.deptFrom !== "dept" && row.deptFrom !== "type")) continue;
    const counts = usual.get(row.surgeon) ?? new Map<DeptCode, number>();
    counts.set(row.dept, (counts.get(row.dept) ?? 0) + 1);
    usual.set(row.surgeon, counts);
  }
  for (const row of rows) {
    if (!row.dept && row.surgeon) {
      let best: [DeptCode, number] | null = null;
      for (const entry of usual.get(row.surgeon) ?? []) {
        if (!best || entry[1] > best[1]) best = entry;
      }
      if (best) {
        row.dept = best[0];
        row.deptFrom = "file";
      }
    }
    row.team = resolveSurgeon(row.surgeon, row.title).team ?? row.dept;
    row.scope = isScopeCase(row.operation, row.team);
  }
  return { ok: true, rows, missingHeaders: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Rule set B, step one: the date guard

const THAI_SHORT_MONTHS = THAI_MONTHS.map(([short]) => short);

/** "5 พ.ย. 2569", for messages. */
function thaiShortDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${THAI_SHORT_MONTHS[month - 1]} ${year + 543}`;
}

export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      /** Every booked date in the file, the target included, in order. */
      dates: string[];
      /** Rows whose booked date is blank or unreadable. */
      blank: number;
      message: string;
    };

/** Every row's booked date (W) must be the target date; otherwise the whole file is refused. */
export function guardTargetDate(rows: readonly WorkbookRow[], target: string): GuardResult {
  const found = new Set<string>();
  let blank = 0;
  for (const row of rows) {
    if (row.bookedDate) found.add(row.bookedDate);
    else blank += 1;
  }
  if (blank === 0 && [...found].every((date) => date === target)) return { ok: true };
  const dates = [...found].sort();
  const listed = [...dates.map(thaiShortDate), ...(blank ? [`ไม่มีวันที่ ${blank} แถว`] : [])].join(", ");
  return {
    ok: false,
    dates,
    blank,
    message: `ไฟล์นี้มีวันสั่งผ่าตัด ${listed} แต่ต้องเป็นวันที่ ${thaiShortDate(target)} ทุกแถว กรุณาส่งออกจาก HOSxP ใหม่เฉพาะวันนั้น`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rule set B, step two: the filter

/** Section 6: words in the operation name that mark a case as not elective. `stat` and `today` whole words, `emer` starting one. */
const NOT_ELECTIVE = /\bon\s*-?\s*call|\bemer|\bstat\b|\btoday\b|วันนี้|ด่วน|เพิ่ม/i;

/** The section 6 keyword in an operation name, or null. */
export function notElectiveKeyword(operation: string): string | null {
  return NOT_ELECTIVE.exec(operation)?.[0] ?? null;
}

/** 1–6 are rule set B's rules in order; 0 is a row with no case ID, which cannot be counted or stored. */
export type DropRule = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Why a row is dropped, in Thai for the upload summary (the rules doc's English reason at the end of each line). */
export const DROP_REASONS: Readonly<Record<DropRule, string>> = {
  0: "ไม่มีเลข ID", // (not in the rules: a row with no ID)
  1: "ยกเลิกการผ่าตัด", // Cancelled
  2: "ระบุ Stat / Emergency", // Marked Stat / Emergency
  3: "ชื่อการผ่าตัดระบุ on call / ฉุกเฉิน", // Text says on call / emergency
  4: "นอกเวลา", // Out of hours (SMC included)
  5: "เวลาผ่าตัดนอกช่วง 08:00–15:00 น.", // Booked outside 08:00–15:00
  6: "Urgency แต่ไม่ระบุเวลา", // Urgency with no booked time
};

export type DroppedRow = {
  caseId: string;
  line: number;
  rule: DropRule;
  /** DROP_REASONS[rule]. */
  reason: string;
  /** What matched: the keyword (rule 3), "SMC" (rule 4), the booked time (rule 5). */
  detail: string | null;
};

export type DuplicateRow = { caseId: string; line: number };

export type FilterCounts = {
  rows: number;
  /** Rows less the repeated IDs. */
  unique: number;
  duplicates: number;
  kept: number;
  dropped: number;
  byRule: Record<DropRule, number>;
};

export type FilterResult = { kept: WorkbookRow[]; dropped: DroppedRow[]; duplicates: DuplicateRow[]; counts: FilterCounts };

const EARLIEST = 8 * 3600;
const LATEST = 15 * 3600;

/** The first rule of set B that drops the row, or null for an in-hours elective case. */
export function dropRuleOf(row: WorkbookRow): { rule: DropRule; detail: string | null } | null {
  if (!row.caseId) return { rule: 0, detail: null };
  if (row.status === "cancelled") return { rule: 1, detail: null };
  if (row.emergency) return { rule: 2, detail: row.urgency };
  const keyword = notElectiveKeyword(row.operation);
  if (keyword) return { rule: 3, detail: keyword };
  if (row.shift === "out" || row.smc) return { rule: 4, detail: row.shift === "out" ? null : "SMC" };
  // 08:00 and 15:00 both count as inside.
  if (row.bookedTime && (secondsOf(row.bookedTime) < EARLIEST || secondsOf(row.bookedTime) > LATEST)) {
    return { rule: 5, detail: row.bookedTime };
  }
  if (row.urgency === "Urgency" && !row.bookedTime) return { rule: 6, detail: null };
  return null;
}

/**
 * Rule set B's filter. A repeated case ID is counted once (its first row decides), then each row goes through the
 * rules in order and the first that matches drops it. Everything left is an in-hours elective case.
 */
export function filterForUpload(rows: readonly WorkbookRow[]): FilterResult {
  const kept: WorkbookRow[] = [];
  const dropped: DroppedRow[] = [];
  const duplicates: DuplicateRow[] = [];
  const seen = new Set<string>();
  const byRule: Record<DropRule, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const row of rows) {
    if (row.caseId && seen.has(row.caseId)) {
      duplicates.push({ caseId: row.caseId, line: row.line });
      continue;
    }
    if (row.caseId) seen.add(row.caseId);
    const drop = dropRuleOf(row);
    if (drop) {
      dropped.push({ caseId: row.caseId, line: row.line, rule: drop.rule, reason: DROP_REASONS[drop.rule], detail: drop.detail });
      byRule[drop.rule] += 1;
    } else {
      kept.push(row);
    }
  }
  return {
    kept,
    dropped,
    duplicates,
    counts: {
      rows: rows.length,
      unique: rows.length - duplicates.length,
      duplicates: duplicates.length,
      kept: kept.length,
      dropped: dropped.length,
      byRule,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Rule set C: the cuts that do not depend on rooms

export type CutReason = "tha-chalom" | "vascular";

export const CUT_REASONS: Readonly<Record<CutReason, string>> = {
  "tha-chalom": "เคสของ รพ.นครท่าฉลอม",
  vascular: "ศัลยกรรมหลอดเลือด วันอังคาร–พฤหัสบดี (โควตาท่าฉลอม)",
};

export type CutRow = { caseId: string; line: number; reason: CutReason; label: string };
export type CutResult = { kept: WorkbookRow[]; cut: CutRow[] };

/** 0 = Sunday … 6 = Saturday. */
const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * The board never shows Tha Chalom's cases, nor vascular surgery on Tuesday to Thursday (Tha Chalom's quota). Room
 * rules (OB-GYN in the obstetric building during the repair, no room for a department) are placeCase's.
 */
export function boardCuts(kept: readonly WorkbookRow[], date: string): CutResult {
  const vascularDay = [2, 3, 4].includes(weekdayOf(date));
  const out: WorkbookRow[] = [];
  const cut: CutRow[] = [];
  for (const row of kept) {
    const reason: CutReason | null = row.thaChalom ? "tha-chalom" : vascularDay && row.dept === "VASCULAR" ? "vascular" : null;
    if (reason) cut.push({ caseId: row.caseId, line: row.line, reason, label: CUT_REASONS[reason] });
    else out.push(row);
  }
  return { kept: out, cut };
}

// ---------------------------------------------------------------------------------------------------------------
// Summary and the whole pipeline

/** Counts only (no HN, no case IDs), so it can be stored with the upload and shown to MX. */
export type UploadSummary = {
  rows: number;
  unique: number;
  duplicates: number;
  kept: number;
  /** Rules that dropped at least one row, in rule order. */
  dropped: { rule: DropRule; reason: string; count: number }[];
  cut: { reason: CutReason; label: string; count: number }[];
  /** Cases left for placeCase. */
  toPlace: number;
};

export function summariseUpload(filter: FilterResult, cuts: CutResult): UploadSummary {
  const rules = Object.keys(DROP_REASONS).map(Number) as DropRule[];
  return {
    rows: filter.counts.rows,
    unique: filter.counts.unique,
    duplicates: filter.counts.duplicates,
    kept: filter.counts.kept,
    dropped: rules
      .filter((rule) => filter.counts.byRule[rule] > 0)
      .map((rule) => ({ rule, reason: DROP_REASONS[rule], count: filter.counts.byRule[rule] })),
    cut: (Object.keys(CUT_REASONS) as CutReason[])
      .map((reason) => ({ reason, label: CUT_REASONS[reason], count: cuts.cut.filter((row) => row.reason === reason).length }))
      .filter((item) => item.count > 0),
    toPlace: cuts.kept.length,
  };
}

export type PreparedUpload =
  | { ok: false; error: "headers"; message: string; missingHeaders: string[] }
  | { ok: false; error: "dates"; message: string; dates: string[]; blank: number }
  | { ok: true; rows: WorkbookRow[]; filter: FilterResult; cuts: CutResult; summary: UploadSummary };

/**
 * Parse, guard, filter and cut in one call, for the upload action: `prepareUpload(readXlsx(file), target)` once the
 * read is ok. The cases to place are `cuts.kept`. An export with no case rows passes (nothing to refuse).
 */
export function prepareUpload(
  sheet: { rows: SheetRows; date1904: boolean },
  target: string,
  options: Omit<ParseOptions, "date1904"> = {},
): PreparedUpload {
  const parsed = parseExport(sheet.rows, { ...options, date1904: sheet.date1904 });
  if (!parsed.ok) return { ok: false, error: "headers", message: parsed.message, missingHeaders: parsed.missingHeaders };
  const guard = guardTargetDate(parsed.rows, target);
  if (!guard.ok) return { ok: false, error: "dates", message: guard.message, dates: guard.dates, blank: guard.blank };
  const filter = filterForUpload(parsed.rows);
  const cuts = boardCuts(filter.kept, target);
  return { ok: true, rows: parsed.rows, filter, cuts, summary: summariseUpload(filter, cuts) };
}
