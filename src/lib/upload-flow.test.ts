import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import nextConfig from "../../next.config.ts";
import { fileProblem, megabytes } from "../app/upload/file-check.ts";
import type { AddedCase } from "./added-cases.ts";
import { DEPARTMENTS } from "./allocation.ts";
import { buildBoardRows } from "./board-rows.ts";
import { DEFAULT_REPAIR_PERIODS, type RepairPeriods } from "./repair.ts";
import {
  matchBookings,
  nextWindowChange,
  placedSummary,
  processSheet,
  processWorkbook,
  readFlowSummary,
  runUploadFlow,
  windowStateAt,
  type FlowSummary,
  type ProcessedUpload,
} from "./upload-flow.ts";
import { readXlsx, XLS_MESSAGE, XLSX_LIMITS, type XlsxCell } from "./xlsx.ts";

// The made-up export (tests/fixtures, every name and HN invented). Rows 1–17 are all booked for Thu 5 Nov 2026 and
// stand in for MX's file for that day; the whole file holds several days, so the date guard refuses it.
const FIXTURE = readFileSync(new URL("../../tests/fixtures/sample-or-export.xlsx", import.meta.url));
const book = readXlsx(FIXTURE);
assert.ok(book.ok);
const SHEET = book.rows;
const HEADER = SHEET[0];
const THURSDAY = "2026-11-05";
const DAY_FILE = SHEET.slice(0, 18); // header + rows 1–17

// 5 Nov 2026 is before the repair's planned dates, so the weekly schedule places the cases.
const WEEKLY = DEFAULT_REPAIR_PERIODS;
const FIRST_HALF: RepairPeriods = { half1: { from: "2026-11-01", to: "2026-11-30" }, half2: { from: "2026-12-01", to: "2027-01-15" } };
const SECOND_HALF: RepairPeriods = { half1: { from: "2026-10-01", to: "2026-10-31" }, half2: { from: "2026-11-01", to: "2026-12-31" } };

// ---------------------------------------------------------------------------------------------------------------
// A minimal .xlsx writer, so the whole pipeline runs from bytes on a file of exactly the rows a test needs.

function zip(parts: { name: string; data: string }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const data = Buffer.from(part.data, "utf8");
    const body = deflateRawSync(data);
    const name = Buffer.from(part.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function column(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** An .xlsx with one sheet named `operation` holding `rows` (strings inline, numbers and booleans as values). */
function xlsxOf(rows: readonly (readonly XlsxCell[])[]): Buffer {
  const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const cells = (row: readonly XlsxCell[], r: number) =>
    row
      .map((value, index) => {
        const ref = `${column(index)}${r}`;
        if (value === null || value === "") return "";
        if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
        if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      })
      .join("");
  const sheet = `<worksheet ${MAIN}><sheetData>${rows.map((row, index) => `<row r="${index + 1}">${cells(row, index + 1)}</row>`).join("")}</sheetData></worksheet>`;
  return zip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "_rels/.rels", data: `<Relationships><Relationship Id="rId1" Type="${TYPE}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: "xl/workbook.xml",
      data: `<workbook ${MAIN} xmlns:r="${TYPE}"><sheets><sheet name="operation" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<Relationships><Relationship Id="rId1" Type="${TYPE}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
}

/** A row in the export's 39 columns, given by header name. */
function rowOf(values: Record<string, XlsxCell>): XlsxCell[] {
  return HEADER.map((name) => (typeof name === "string" && name in values ? values[name] : null));
}

/** 46331 is Thu 5 Nov 2026 as an Excel serial. */
const ELECTIVE = { สถานะภาพ: "รอผ่าตัด", ความเร่งด่วน: "Elective", เวร: "ในเวลา", สั่งผ่าตัดวันที่: 46331, สั่งผ่าตัดเวลา: "09:00" };

function processed(result: ReturnType<typeof processWorkbook>): ProcessedUpload {
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result;
}

const roomOf = (result: ProcessedUpload) => Object.fromEntries(result.cases.map((item) => [item.caseId, item.roomId]));

// ---------------------------------------------------------------------------------------------------------------

test("the whole sample file is refused: it holds several booked days, so nothing is placed", () => {
  const result = processWorkbook(FIXTURE, THURSDAY, WEEKLY);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error === "dates");
  assert.match(!result.ok ? result.message : "", /5 พ\.ย\. 2569/);
});

test("rows 1–17 as the file for Thu 5 Nov, outside the repair: 9 kept, 2 cut, 7 placed by the weekly schedule", () => {
  const result = processed(runUploadFlow({ data: xlsxOf(DAY_FILE), target: THURSDAY, periods: WEEKLY, bookings: [] }));
  // The answers sheet's placement: GENSX rooms, the ORTHO room, dressing to OR 1, the endoscopy to SCOPE (OR 3), the
  // ENT room. On Thursdays GENSX holds OR 2 and OR 5 (fewest cases first), ORTHO OR 11 and ENT OR 4.
  assert.deepEqual(roomOf(result), {
    "900001": "or-2",
    "900002": "or-11",
    "900003": "or-5",
    "900010": "or-1",
    "900011": "or-3",
    "900014": "or-4",
    "900015": "or-2",
  });
  const summary: FlowSummary = result.summary;
  assert.equal(summary.rows, 17);
  assert.equal(summary.unique, 16);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.kept, 9);
  assert.deepEqual(
    summary.dropped.map((item) => [item.rule, item.count]),
    [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 1],
      [5, 1],
      [6, 1],
    ],
  );
  assert.deepEqual(
    summary.cut.map((item) => [item.reason, item.count]),
    [
      ["tha-chalom", 1],
      ["vascular", 1],
    ],
  );
  assert.equal(summary.toPlace, 7);
  assert.equal(summary.placed, 7);
  assert.deepEqual(summary.unplaced, []);
  assert.equal(summary.repairHalf, null);
  assert.deepEqual(
    summary.rooms.map((room) => [room.room, room.dept, room.count]),
    [
      ["OR 1", DEPARTMENTS.INFECT.label, 1],
      ["OR 2", "GENSX", 2],
      ["OR 3", "SCOPE", 1],
      ["OR 4", "ENT", 1],
      ["OR 5", "GENSX", 1],
      ["OR 11", "ORTHO", 1],
    ],
  );
});

test("the stored cases hold what the board needs, in file order, and never a patient field", () => {
  const result = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, WEEKLY));
  assert.deepEqual(
    result.cases.map((item) => item.position),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.deepEqual(result.cases[0], {
    caseId: "900001",
    hn: "99000001",
    operation: "Laparoscopic cholecystectomy",
    surgeon: "นพ. ตัวอย่าง ศัลย์ทั่วไป",
    dept: "GENSX",
    team: "GENSX",
    roomId: "or-2",
    shift: "in",
    status: "done",
    urgency: "Elective",
    bookedTime: "09:00",
    position: 1,
  });
  // The summary goes into workbook_uploads.summary: counts and labels, no HN and no case ID.
  const stored = JSON.stringify(result.summary);
  for (const item of result.cases) {
    assert.ok(!stored.includes(item.hn), "an HN in the summary");
    assert.ok(!stored.includes(item.caseId), "a case ID in the summary");
  }
});

test("the same file during the first half of the repair: the half's rooms, endoscopy and ENT in the mixed room", () => {
  const result = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, FIRST_HALF));
  assert.deepEqual(roomOf(result), {
    "900001": "or-12",
    "900002": "or-13",
    "900003": "or-12",
    "900010": "or-10",
    "900011": "or-11",
    "900014": "or-11",
    "900015": "or-12",
  });
  assert.equal(result.summary.repairHalf, 1);
  assert.equal(result.summary.placed, 7);
  assert.deepEqual(
    result.summary.rooms.map((room) => [room.room, room.dept, room.count]),
    [
      ["OR 10", DEPARTMENTS.INFECT.label, 1],
      ["OR 11", DEPARTMENTS.MIXED.label, 2],
      ["OR 12", "GENSX", 3],
      ["OR 13", "ORTHO", 1],
    ],
  );
});

test("the second half of the repair uses OR 1 to 5", () => {
  const result = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, SECOND_HALF));
  assert.equal(result.summary.repairHalf, 2);
  assert.deepEqual(roomOf(result), {
    "900001": "or-5",
    "900002": "or-2",
    "900003": "or-5",
    "900010": "or-1",
    "900011": "or-4",
    "900014": "or-4",
    "900015": "or-5",
  });
});

test("stored cases placed again give the upload's own rooms, or the new dates' rooms after an admin moves them", () => {
  // MX uploads Thursday's file during the first half; then an admin moves the dates so Thursday is in the second half.
  const upload = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, FIRST_HALF));
  const second = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, SECOND_HALF));
  const boardRooms = (periods: RepairPeriods) =>
    Object.fromEntries(
      buildBoardRows({ date: THURSDAY, periods, workbook: upload.cases, bookings: [], viewer: { allHn: true, userId: null } }).rows.map(
        (row) => [row.id.replace(/^hx-/, ""), row.roomId],
      ),
    );
  // Nothing changed: the board places the stored cases exactly where the upload did.
  assert.deepEqual(boardRooms(FIRST_HALF), roomOf(upload));
  // The dates moved: every case goes where an upload under the new dates would have put it, none is lost.
  assert.deepEqual(boardRooms(SECOND_HALF), roomOf(second));
  // The upload page's summary and matching follow the same rooms.
  const summary = placedSummary(upload.summary, upload.cases, THURSDAY, SECOND_HALF);
  const { placed, rooms, unplaced } = second.summary;
  assert.deepEqual(summary, { ...upload.summary, placed, rooms, unplaced, repairHalf: 2 });
  assert.deepEqual(placedSummary(upload.summary, upload.cases, THURSDAY, FIRST_HALF), upload.summary);
  const matching = matchBookings({ date: THURSDAY, periods: SECOND_HALF, cases: upload.cases, bookings: [] });
  assert.deepEqual(matching.unbooked.map((row) => row.roomId), Object.values(roomOf(second)));
});

test("during the repair OB-GYN is not placed (obstetric building) and a case with no department is not either", () => {
  const rows = [
    HEADER,
    rowOf({ ...ELECTIVE, ID: 910001, HN: "0123", ชื่อการผ่าตัด: "Total abdominal hysterectomy", แพทย์ผู้สั่ง: "ทดสอบ สูติ (พญ.)", แผนก: "นรีเวชกรรม" }),
    rowOf({ ...ELECTIVE, ID: 910002, HN: "0124", ชื่อการผ่าตัด: "Excision", แพทย์ผู้สั่ง: "ไม่มี ในรายชื่อ (นพ.)" }),
    rowOf({ ...ELECTIVE, ID: 910003, HN: "0125", ชื่อการผ่าตัด: "Septoplasty", แพทย์ผู้สั่ง: "ทดสอบ หู (นพ.)", ชนิด: "ENT" }),
  ];
  const repair = processed(processWorkbook(xlsxOf(rows), THURSDAY, FIRST_HALF));
  assert.deepEqual(roomOf(repair), { "910001": null, "910002": null, "910003": "or-11" });
  assert.equal(repair.summary.placed, 1);
  assert.deepEqual(repair.summary.unplaced, [
    { reason: "obgyn-building", label: "สูติ-นรีเวช ผ่าตัดที่อาคารแม่", count: 1 },
    { reason: "no-department", label: "ไม่ทราบแผนก", count: 1 },
  ]);
  // Outside the repair OB-GYN has its own room (OR 6 every weekday).
  const weekly = processed(processWorkbook(xlsxOf(rows), THURSDAY, WEEKLY));
  assert.equal(roomOf(weekly)["910001"], "or-6");
  assert.deepEqual(
    weekly.summary.unplaced.map((item) => item.reason),
    ["no-department"],
  );
});

test("a file that is not an .xlsx is refused with the reader's Thai message", () => {
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(504).fill(0)]);
  assert.deepEqual(processWorkbook(ole, THURSDAY, WEEKLY), { ok: false, error: "file", message: XLS_MESSAGE });
  const text = processWorkbook(Buffer.from("ID,HN\n1,2\n"), THURSDAY, WEEKLY);
  assert.equal(text.ok, false);
  assert.ok(!text.ok && text.error === "file");
});

test("a file whose headers are not the export's is refused, naming what is missing", () => {
  const result = processWorkbook(xlsxOf([["ID", "HN"], [1, "2"]]), THURSDAY, WEEKLY);
  assert.ok(!result.ok && result.error === "headers");
  assert.match(!result.ok ? result.message : "", /ชื่อการผ่าตัด/);
});

// ---------------------------------------------------------------------------------------------------------------
// Matching with the bookings

let nextId = 0;
function booking(more: Partial<AddedCase>): AddedCase {
  nextId += 1;
  return {
    id: String(nextId),
    date: THURSDAY,
    roomId: "or-2",
    hn: `7700${nextId}`,
    operation: "",
    shift: "in",
    surgeonId: "7",
    surgeon: "สมชาย ใจดี",
    subtype: "GENSX",
    ...more,
  };
}

test("matching: a booking with the case's HN pairs with it; the rest are unbooked or not in HOSxP", () => {
  const bookings = [
    // Bookings hold the HN normalised (lib/hn.ts): this is 900001's patient.
    booking({ hn: "99000001", roomId: "or-5" }),
    booking({ hn: "55555", roomId: "or-4", surgeon: "สมหญิง ใจงาม", operation: "Tonsillectomy" }),
    booking({ hn: "66666", date: "2026-11-06" }),
  ];
  const result = runUploadFlow({ data: xlsxOf(DAY_FILE), target: THURSDAY, periods: WEEKLY, bookings });
  assert.ok(result.ok);
  const { matching } = result;
  assert.equal(matching.bookings, 2, "only the target day's bookings count");
  assert.equal(matching.matched, 1);
  assert.deepEqual(
    matching.unbooked.map((row) => row.hn),
    ["99000002", "99000003", "99000010", "99000011", "99000014", "99000015"],
  );
  assert.deepEqual(matching.notInHosxp, [
    { key: `bk-${bookings[1].id}`, roomId: "or-4", room: "OR 4", surgeon: "สมหญิง ใจงาม", hn: "55555", operation: "Tonsillectomy" },
  ]);
  const unbooked = matching.unbooked[0];
  assert.deepEqual(
    { room: unbooked.room, surgeon: unbooked.surgeon, operation: unbooked.operation },
    { room: "OR 11", surgeon: "นพ. ตัวอย่าง กระดูก", operation: "ORIF Lt distal radius" },
  );
});

test("matching: a booking with no operation name and no HN reads as such; no bookings flags every case", () => {
  const cases = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, WEEKLY)).cases;
  const none = matchBookings({ date: THURSDAY, periods: WEEKLY, cases, bookings: [] });
  assert.deepEqual([none.bookings, none.matched, none.unbooked.length, none.notInHosxp.length], [0, 0, 7, 0]);
  const old = booking({ hn: null, roomId: "or-3" });
  const result = matchBookings({ date: THURSDAY, periods: WEEKLY, cases, bookings: [old] });
  assert.deepEqual(result.notInHosxp, [
    { key: `bk-${old.id}`, roomId: "or-3", room: "OR 3", surgeon: "สมชาย ใจดี", hn: null, operation: "จองห้อง (รอข้อมูล HOSxP)" },
  ]);
  // A booking in a room that does not operate that day is not on the board, so it is not listed either.
  const closed = matchBookings({ date: THURSDAY, periods: FIRST_HALF, cases: [], bookings: [booking({ roomId: "or-2" })] });
  assert.deepEqual(closed.notInHosxp, []);
});

// ---------------------------------------------------------------------------------------------------------------
// The stored summary, the window and the file checks

test("a stored summary reads back as it was saved; anything else gives zeros or null", () => {
  const { summary } = processed(processSheet({ rows: DAY_FILE, date1904: false }, THURSDAY, FIRST_HALF));
  assert.deepEqual(readFlowSummary(JSON.parse(JSON.stringify(summary))), summary);
  assert.equal(readFlowSummary(null), null);
  assert.equal(readFlowSummary("text"), null);
  assert.equal(readFlowSummary([1, 2]), null);
  assert.deepEqual(readFlowSummary({ rows: "17", dropped: [{ rule: 9, count: 1 }], rooms: [{ roomId: "or-99", count: 1 }], repairHalf: 3 }), {
    rows: 0,
    unique: 0,
    duplicates: 0,
    kept: 0,
    dropped: [],
    cut: [],
    toPlace: 0,
    placed: 0,
    rooms: [],
    unplaced: [],
    repairHalf: null,
  });
});

/** A Bangkok wall-clock time on Sat 14 Nov 2026. */
const bangkok = (time: string, date = "2026-11-14") => new Date(`${date}T${time}+07:00`);

test("the upload window by Bangkok time: before 15:00, from 15:00 up to 16:00, then closed until the next day", () => {
  assert.equal(windowStateAt(bangkok("14:59:59")), "before");
  assert.equal(windowStateAt(bangkok("15:00:00")), "open");
  assert.equal(windowStateAt(bangkok("15:59:59")), "open");
  assert.equal(windowStateAt(bangkok("16:00:00")), "after");
  assert.equal(windowStateAt(bangkok("00:00:00")), "before");
  // The page refreshes itself at each change.
  assert.equal(nextWindowChange(bangkok("09:30:00")).toISOString(), bangkok("15:00:00").toISOString());
  assert.equal(nextWindowChange(bangkok("15:00:00")).toISOString(), bangkok("16:00:00").toISOString());
  assert.equal(nextWindowChange(bangkok("16:00:00")).toISOString(), bangkok("00:00:00", "2026-11-15").toISOString());
  assert.equal(nextWindowChange(bangkok("23:59:59")).toISOString(), bangkok("00:00:00", "2026-11-15").toISOString());
});

test("the file checks the form and the action share: .xlsx only, not empty, at most 4 MB", () => {
  const rules = { maxBytes: XLSX_LIMITS.maxFileBytes, xlsMessage: XLS_MESSAGE };
  assert.equal(megabytes(rules.maxBytes), "4 MB");
  assert.equal(fileProblem({ name: "or-5-nov.xlsx", size: 20_000 }, rules), null);
  assert.equal(fileProblem({ name: " OR.XLSX ", size: rules.maxBytes }, rules), null);
  assert.equal(fileProblem({ name: "or.xls", size: 20_000 }, rules), XLS_MESSAGE);
  assert.equal(fileProblem({ name: "or.csv", size: 20_000 }, rules), "รับเฉพาะไฟล์ .xlsx ที่ส่งออกจาก HOSxP");
  assert.equal(fileProblem({ name: "or.xlsx", size: 0 }, rules), "ไฟล์นี้ว่างเปล่า เลือกไฟล์ใหม่");
  assert.equal(fileProblem({ name: "or.xlsx", size: rules.maxBytes + 1 }, rules), "ไฟล์ใหญ่เกิน 4 MB");
  assert.equal(fileProblem(null, rules), "เลือกไฟล์ตารางผ่าตัดก่อน");
  assert.equal(fileProblem({ name: "", size: 10 }, rules), "เลือกไฟล์ตารางผ่าตัดก่อน");
});

test("a file the page accepts always reaches the action: under Next's body limit, and that under Vercel's 4.5 MB", () => {
  // Vercel refuses a function request over 4.5 MB (413) before Next.js runs, so a bigger file would only ever show
  // "check your connection". bytes() reads "4.25mb" as 4.25 × 1024²; the platform's 4.5 MB is taken as 4,500,000 bytes,
  // the smaller reading.
  const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
  assert.equal(typeof limit, "string");
  const match = /^(\d+(?:\.\d+)?)mb$/.exec(String(limit));
  assert.ok(match, `bodySizeLimit ${String(limit)}`);
  const body = Number(match[1]) * 1024 * 1024;
  assert.ok(body < 4_500_000, "the action's body limit is under Vercel's request cap");
  // The form's own fields and multipart boundaries need some room above the file.
  assert.ok(body - XLSX_LIMITS.maxFileBytes >= 64 * 1024, "room for the form around the largest file");
});
