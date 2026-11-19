import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  boardCuts,
  cleanText,
  DROP_REASONS,
  filterForUpload,
  guardTargetDate,
  headerIndex,
  isBookedAhead,
  notElectiveKeyword,
  parseDateCell,
  parseExport,
  parseTimeCell,
  prepareUpload,
  REQUIRED_HEADERS,
  requestTimeIndex,
  splitSurgeon,
  summariseUpload,
  surgeonDeptOf,
  thaiDateSpan,
  type WorkbookRow,
} from "./workbook.ts";
import { readXlsx, type XlsxCell } from "./xlsx.ts";

// The made-up export (tests/fixtures, every name and HN invented) and its answers sheet: rows 1–17 are all booked for
// Thu 5 Nov 2026 and stand in for MX's file for that day; rows 18–28 are other days.
const book = readXlsx(readFileSync(new URL("../../tests/fixtures/sample-or-export.xlsx", import.meta.url)));
assert.ok(book.ok);
const SHEET = book.rows;
const THURSDAY = "2026-11-05";
const DAY_FILE = SHEET.slice(0, 18); // header + rows 1–17

function parsed(rows: readonly (readonly XlsxCell[])[] = DAY_FILE, date1904 = false): WorkbookRow[] {
  const result = parseExport(rows, { date1904 });
  assert.ok(result.ok, result.ok ? "" : result.message);
  return result.rows;
}

const byId = (rows: readonly WorkbookRow[]) => new Map(rows.map((row) => [row.caseId, row]));

/**
 * Rule set B answers: the rule number of each dropped case (the answers sheet's "#N …"). One change since the sheet:
 * 900007 "Appendectomy (on call)" was keyed in the day before, so it is booked ahead and kept (Pong, 18 Nov 2026: "If it
 * is booked in advance, that is elective case. Just ignore 'on call' word"); the sheet still drops it under #3.
 */
const DROPPED_BY_ANSWERS = {
  "900004": 6, // Urgency with no booked time
  "900005": 1, // Cancelled
  "900006": 2, // Marked Stat / Emergency
  "900008": 4, // Out of hours
  "900009": 5, // Booked outside 08:00–15:00 (16:20)
  "900029": 3, // Text says on call / emergency ("stat")
} as const;
const KEPT_BY_ANSWERS = ["900001", "900002", "900003", "900007", "900010", "900011", "900012", "900013", "900014", "900015"];

/** The answers sheet's department code for every case of rows 1–17. */
const DEPT_BY_ANSWERS: Record<string, string> = {
  "900001": "GENSX",
  "900002": "ORTHO",
  "900003": "GENSX",
  "900004": "ORTHO",
  "900005": "GENSX",
  "900006": "OBGYN",
  "900007": "GENSX",
  "900008": "EYE",
  "900009": "URO",
  "900010": "PLASTIC",
  "900011": "GENSX",
  "900012": "GENSX",
  "900013": "VASCULAR",
  "900014": "ENT",
  "900015": "GENSX",
  "900029": "GENSX",
};

/** A sheet built in the test: the export's 39 headers, then rows given by header name. */
function sheetOf(rows: Record<string, XlsxCell>[]): XlsxCell[][] {
  const header = SHEET[0];
  return [header, ...rows.map((values) => header.map((name) => (typeof name === "string" && name in values ? values[name] : null)))];
}
const ROW = { ID: 1, สถานะภาพ: "รอผ่าตัด", HN: "1", ชื่อการผ่าตัด: "Septoplasty", แพทย์ผู้สั่ง: "ทดสอบ หนึ่ง (นพ.)", เวร: "ในเวลา", ชนิด: "ENT", สั่งผ่าตัดวันที่: 46331 };

test("rule set B on rows 1–17 as the file for Thu 5 Nov: 17 rows, 16 cases, 10 kept, 6 dropped, 1 duplicate", () => {
  const rows = parsed();
  assert.equal(rows.length, 17);
  assert.deepEqual(guardTargetDate(rows, THURSDAY), { ok: true });
  const result = filterForUpload(rows);
  assert.deepEqual(result.counts, {
    rows: 17,
    unique: 16,
    duplicates: 1,
    kept: 10,
    dropped: 6,
    byRule: { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 },
  });
  assert.deepEqual(result.kept.map((row) => row.caseId), KEPT_BY_ANSWERS);
  assert.deepEqual(
    Object.fromEntries(result.dropped.map((row) => [row.caseId, row.rule])),
    DROPPED_BY_ANSWERS,
  );
  for (const row of result.dropped) assert.equal(row.reason, DROP_REASONS[row.rule]);
  const detail = Object.fromEntries(result.dropped.map((row) => [row.caseId, row.detail]));
  assert.equal(detail["900029"], "stat");
  assert.equal(detail["900009"], "16:20");
  // Row 17 repeats 900002: counted once, the first row decides.
  assert.deepEqual(result.duplicates, [{ caseId: "900002", line: 18 }]);
});

test("the Thai reasons for the upload summary", () => {
  assert.deepEqual(DROP_REASONS, {
    0: "ไม่มีเลข ID",
    1: "ยกเลิกการผ่าตัด",
    2: "ระบุ Stat / Emergency",
    3: "ชื่อการผ่าตัดระบุ on call / ฉุกเฉิน",
    4: "นอกเวลา",
    5: "เวลาผ่าตัดนอกช่วง 08:00–15:00 น.",
    6: "Urgency แต่ไม่ระบุเวลา",
  });
});

test("board cuts: of the 10 kept, only Tha Chalom's 900012 goes, 9 are left to place", () => {
  const { kept } = filterForUpload(parsed());
  const cuts = boardCuts(kept);
  assert.deepEqual(
    cuts.cut.map(({ caseId, reason }) => ({ caseId, reason })),
    [{ caseId: "900012", reason: "tha-chalom" }],
  );
  // 900013 is vascular surgery on a Thursday. The utilisation report cut it as Tha Chalom's quota; the board now
  // follows the schedule in force instead and leaves the room to placeCase (Pong, 18 Nov 2026: "stick to the interim
  // schedule").
  assert.deepEqual(cuts.kept.map((row) => row.caseId), ["900001", "900002", "900003", "900007", "900010", "900011", "900013", "900014", "900015"]);
});

test("departments from the surgeon by name, then แผนก, then ชนิด, then the surgeon's usual department in the file", () => {
  const rows = byId(parsed());
  for (const [caseId, dept] of Object.entries(DEPT_BY_ANSWERS)) assert.equal(rows.get(caseId)?.dept, dept, caseId);
  assert.equal(rows.get("900001")?.deptFrom, "dept");
  assert.equal(rows.get("900012")?.deptFrom, "type"); // แผนก รพ.นครท่าฉลอม is not in the table, so ชนิด GEN
  assert.equal(rows.get("900014")?.deptFrom, "type"); // แผนก blank
  assert.equal(rows.get("900015")?.deptFrom, "file"); // both blank, the surgeon is on no list

  // A surgeon on the surgeon list gets their specialty; Neuro maps to NEURO; nothing known leaves it null.
  const rowsOf = parsed(
    sheetOf([
      { ...ROW, ID: 1, ชนิด: null, แพทย์ผู้สั่ง: "สมชาย กลับกลาย (นพ.)" },
      { ...ROW, ID: 2, ชนิด: "Neuro" },
      { ...ROW, ID: 3, ชนิด: null, แพทย์ผู้สั่ง: "ไม่มี ในรายชื่อ (พญ.)" },
      // Pong, 19 Nov 2026: "now base on surgeon name and dept only": the surgeon's own department wins over แผนก and
      // ชนิด, so a general surgeon's case keyed under ORTHO goes to the GENSX room
      { ...ROW, ID: 4, แผนก: "ศัลยกรรมกระดูก", ชนิด: "ORTHO", แพทย์ผู้สั่ง: "สมชาย กลับกลาย (นพ.)" },
      // A surgeon on no list keeps แผนก (another name than row 3's, whose usual department it would otherwise give).
      { ...ROW, ID: 5, แผนก: "ศัลยกรรมกระดูก", ชนิด: "ORTHO", แพทย์ผู้สั่ง: "อีกคน ไม่อยู่ในรายชื่อ (พญ.)" },
    ]),
  );
  assert.deepEqual(
    rowsOf.map((row) => [row.dept, row.deptFrom]),
    [
      ["URO", "surgeon"],
      ["NEURO", "type"],
      [null, null],
      ["URO", "surgeon"],
      ["ORTHO", "dept"],
    ],
  );
});

test("a stored case's department by its surgeon, for lists stored before the surgeon came first", () => {
  assert.equal(surgeonDeptOf("พญ. คริสทีน โรจจวัฒน์"), "GENSX");
  assert.equal(surgeonDeptOf("นพ. สมชาย กลับกลาย"), "URO");
  assert.equal(surgeonDeptOf("สมชาย กลับกลาย"), "URO", "no title");
  assert.equal(surgeonDeptOf("นพ. ไม่มี ในรายชื่อ"), null);
  assert.equal(surgeonDeptOf(""), null);
});

test("the surgeon is split from the title, and น.พ. / พ.ญ. are normalised", () => {
  const rows = byId(parsed());
  assert.deepEqual([rows.get("900001")?.surgeon, rows.get("900001")?.title], ["ตัวอย่าง ศัลย์ทั่วไป", "นพ."]);
  assert.deepEqual([rows.get("900002")?.surgeon, rows.get("900002")?.title], ["ตัวอย่าง กระดูก", "นพ."]); // no space before "("
  assert.deepEqual([rows.get("900009")?.surgeon, rows.get("900009")?.title], ["ตัวอย่าง ทางเดินปัสสาวะ", "นพ."]); // (น.พ.)
  assert.deepEqual(splitSurgeon("ทดสอบ  สอง (พ.ญ.)"), { name: "ทดสอบ สอง", title: "พญ." });
  assert.deepEqual(splitSurgeon("พญ.ทดสอบ สาม"), { name: "ทดสอบ สาม", title: "พญ." });
  assert.deepEqual(splitSurgeon("นพดล ทดสอบ"), { name: "นพดล ทดสอบ", title: "" }); // a first name, not a title
  assert.deepEqual(splitSurgeon(null), { name: "", title: "" });
});

test("flags: dressing, Tha Chalom, SMC, emergency, and the cleaned values", () => {
  const rows = byId(parsed());
  assert.equal(rows.get("900010")?.dressing, true); // Dressing wound Lt leg
  assert.equal(rows.get("900004")?.dressing, true); // Debridement: a dressing case since Pong's 15 Nov 2026 rule
  // A general surgeon who is on no list: the row's GENSX stands in for the team.
  assert.equal(rows.get("900011")?.team, "GENSX");
  assert.equal(rows.get("900012")?.thaChalom, true);
  assert.equal([...rows.values()].filter((row) => row.thaChalom).length, 1);
  assert.equal(rows.get("900008")?.smc, true);
  assert.equal(rows.get("900006")?.emergency, true);
  const first = rows.get("900001")!;
  assert.deepEqual(
    [first.status, first.urgency, first.shift, first.bookedDate, first.bookedTime, first.line],
    ["done", "Elective", "in", THURSDAY, "09:00", 2],
  );
  assert.equal(rows.get("900014")?.urgency, null); // Unknow
  assert.equal(rows.get("900005")?.status, "cancelled");
});

test("rows keep the patient's name (Pong, 16 Nov 2026) but no age, AN, diagnosis, illnesses or costs", () => {
  const rows = parsed(SHEET);
  const keys = [
    "line", "caseId", "hn", "patientName", "operation", "surgeon", "title", "status", "urgency", "emergency", "shift",
    "requestDate", "requestTime", "bookedDate", "bookedTime", "dept", "deptFrom", "team", "thaChalom", "smc", "dressing",
  ];
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...keys].sort());
  assert.equal(byId(rows).get("900001")?.patientName, "ตัวอย่าง ผู้ป่วย01");
  const text = JSON.stringify(rows, (key, value) => (key === "patientName" ? undefined : value));
  for (const secret of ["ผู้ป่วย", "690000001", "ปี", "เดือน", "ประกันสังคม", "IPD", "2750", "ศัลยกรรมหญิง"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("the patient's name is cleaned, and optional: an export without ชื่อ still reads, with empty names", () => {
  const rows = parsed(sheetOf([ROW, { ...ROW, ID: 2, ชื่อ: "  ตัวอย่าง   ผู้ป่วย  " }]));
  assert.deepEqual(rows.map((row) => row.patientName), ["", "ตัวอย่าง ผู้ป่วย"]);
  assert.ok(!(REQUIRED_HEADERS as readonly string[]).includes("ชื่อ"));
  const at = SHEET[0].indexOf("ชื่อ");
  assert.ok(at >= 0);
  const without = sheetOf([{ ...ROW, ชื่อ: "ตัวอย่าง ผู้ป่วย" }]).map((row) => row.filter((_, index) => index !== at));
  assert.deepEqual(parsed(without).map((row) => [row.caseId, row.patientName]), [["1", ""]]);
});

test("HN stays text as written, leading zeros kept", () => {
  const rows = parsed(sheetOf([{ ...ROW, HN: " 0012345 " }, { ...ROW, ID: 2, HN: 678 }]));
  assert.deepEqual(rows.map((row) => row.hn), ["0012345", "678"]);
  assert.equal(byId(parsed()).get("900001")?.hn, "99000001");
});

test("date spans read as short as is clear", () => {
  assert.equal(thaiDateSpan("2026-10-01", "2026-10-31"), "1–31 ต.ค. 2569");
  assert.equal(thaiDateSpan("2026-10-28", "2026-11-03"), "28 ต.ค. – 3 พ.ย. 2569");
  assert.equal(thaiDateSpan("2026-12-30", "2027-01-04"), "30 ธ.ค. 2569 – 4 ม.ค. 2570");
  assert.equal(thaiDateSpan("2026-11-18", "2026-11-18"), "18 พ.ย. 2569");
});

test("the date guard refuses the full sample (several dates) and says their span in one short line", () => {
  const rows = parsed(SHEET);
  assert.equal(rows.length, 28);
  const guard = guardTargetDate(rows, THURSDAY);
  assert.ok(!guard.ok);
  assert.deepEqual(guard.dates, ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.equal(guard.blank, 0);
  assert.equal(guard.message, "ไฟล์นี้มีตาราง 6 วัน (2–7 พ.ย. 2569) ต้องเป็นตารางวันที่ 5 พ.ย. 2569 เท่านั้น");

  // A blank booked date refuses the file too, and so does a file of the wrong day alone.
  const blank = guardTargetDate(parsed(sheetOf([ROW, { ...ROW, ID: 2, สั่งผ่าตัดวันที่: null }])), THURSDAY);
  assert.ok(!blank.ok);
  assert.deepEqual([blank.dates, blank.blank], [[THURSDAY], 1]);
  assert.equal(blank.message, "ไฟล์นี้มี 1 แถวที่ไม่มีวันที่ ทุกแถวต้องเป็นวันที่ 5 พ.ย. 2569 ส่งออกจาก HOSxP ใหม่");
  const wrongDay = guardTargetDate(parsed(), "2026-11-06");
  assert.ok(!wrongDay.ok);
  assert.deepEqual(wrongDay.dates, [THURSDAY]);
  assert.equal(wrongDay.message, "ไฟล์นี้เป็นตารางวันที่ 5 พ.ย. 2569 ต้องเป็นตารางวันที่ 6 พ.ย. 2569 เท่านั้น");
  // No case rows: nothing to refuse.
  assert.deepEqual(guardTargetDate([], THURSDAY), { ok: true });
});

test("missing headers are listed, and the two เวลา columns are told apart by order", () => {
  const header = SHEET[0].map((name) => (name === "HN" || name === "เวร" ? "อื่น" : name));
  const result = parseExport([header, ...SHEET.slice(1, 3)]);
  assert.ok(!result.ok);
  assert.deepEqual(result.missingHeaders, ["HN", "เวร"]);
  assert.equal(result.message, "ไฟล์ไม่มีคอลัมน์ HN, เวร ใช้ไฟล์จาก HOSxP ที่ไม่ได้แก้ไข");
  const empty = parseExport([]);
  assert.ok(!empty.ok);
  assert.deepEqual(empty.missingHeaders, [...REQUIRED_HEADERS]);
  // More than three missing: not the HOSxP export at all, said without the list.
  assert.equal(empty.message, "ไฟล์นี้ไม่ใช่ตารางผ่าตัดจาก HOSxP");

  assert.equal(headerIndex(SHEET[0], "เวลา"), 17); // R
  assert.equal(headerIndex(SHEET[0], "เวลา", 2), 31); // AF
  assert.equal(headerIndex(SHEET[0], "เวลา", 3), -1);
  // The request time is the เวลา beside วันที่, whichever way round the columns come.
  assert.equal(requestTimeIndex(SHEET[0]), 17);
  assert.equal(requestTimeIndex([...SHEET[0]].reverse()), 38 - 17);
  assert.equal(headerIndex(SHEET[0], " pre.  dx. "), 27);
  // Columns are found by name, so a reordered export reads the same.
  const reordered = DAY_FILE.map((row) => Array.from({ length: 39 }, (_, index) => row[index] ?? null).reverse());
  assert.deepEqual(parsed(reordered), parsed());
  // Blank rows and a header below a blank first row are fine.
  assert.equal(parsed([[], ...DAY_FILE.slice(0, 2), [null, " "], ...DAY_FILE.slice(2)]).length, 17);
});

test("dates: Excel serials (1900 and 1904 systems) and text with Buddhist years", () => {
  assert.equal(parseDateCell(46331), THURSDAY);
  assert.equal(parseDateCell(46331.99), THURSDAY);
  assert.equal(parseDateCell(46331 - 1462, true), THURSDAY); // the 1904 system starts 1,462 days later
  assert.equal(parseDateCell(1), "1900-01-01");
  assert.equal(parseDateCell(61), "1900-03-01");
  assert.equal(parseDateCell(60), null); // Excel's 29 Feb 1900
  // 5/11/2569 typed into a real date cell is a serial in the 26th century.
  assert.equal(parseDateCell(Date.UTC(2569, 10, 5) / 86_400_000 + 25_569), THURSDAY);
  assert.equal(parseDateCell("05/11/2569"), THURSDAY);
  assert.equal(parseDateCell("5/11/2026"), THURSDAY);
  assert.equal(parseDateCell("5 พ.ย. 2569"), THURSDAY);
  assert.equal(parseDateCell("5 พฤศจิกายน 2569"), THURSDAY);
  assert.equal(parseDateCell("๕/๑๑/๒๕๖๙"), THURSDAY);
  assert.equal(parseDateCell("2569-11-05"), THURSDAY);
  assert.equal(parseDateCell("2026-11-05T00:00:00"), THURSDAY);
  assert.equal(parseDateCell("05/11/2569 00:00:00"), THURSDAY);
  for (const bad of ["31/02/2569", "11/5", "พรุ่งนี้", "", null, true, -1, Number.NaN]) assert.equal(parseDateCell(bad), null, String(bad));
  // A month name that never ends must not backtrack exponentially (the cell text is untrusted).
  const started = Date.now();
  assert.equal(parseDateCell(`5 ${"ก".repeat(100_000)} x`), null);
  assert.ok(Date.now() - started < 1000);

  // The flag reaches the rows: the same serial is four years and a day later in a 1904 workbook.
  const rows = sheetOf([{ ...ROW, สั่งผ่าตัดวันที่: 46331 - 1462 }]);
  assert.equal(parsed(rows, true)[0].bookedDate, THURSDAY);
  assert.equal(parsed(rows, false)[0].bookedDate, "2022-11-04");
  // prepareUpload takes the flag from the sheet.
  assert.equal(prepareUpload({ rows, date1904: true }, THURSDAY).ok, true);
});

test("times: day fractions, date-and-time serials and text", () => {
  assert.equal(parseTimeCell(0.375), "09:00");
  assert.equal(parseTimeCell(0.4273379629629629), "10:15:22");
  assert.equal(parseTimeCell(46331 + 16 / 24 + 20 / 1440), "16:20");
  assert.equal(parseTimeCell(0), "00:00");
  assert.equal(parseTimeCell(46331), null); // a date with no time
  assert.equal(parseTimeCell("16:20"), "16:20");
  assert.equal(parseTimeCell("9.30"), "09:30");
  assert.equal(parseTimeCell("9:00 น."), "09:00");
  assert.equal(parseTimeCell("05/11/2569 13:00"), "13:00");
  assert.equal(parseTimeCell("05.11.2569"), null);
  assert.equal(parseTimeCell("25:00"), null);
  assert.equal(parseTimeCell(null), null);
});

test("rule edges: 08:00 and 15:00 are inside, a second past 15:00 is not, SMC is out of hours", () => {
  const ruleOf = (values: Record<string, XlsxCell>) => {
    const result = filterForUpload(parsed(sheetOf([{ ...ROW, ...values }])));
    return result.dropped[0]?.rule ?? null;
  };
  assert.equal(ruleOf({ สั่งผ่าตัดเวลา: 8 / 24 }), null);
  assert.equal(ruleOf({ สั่งผ่าตัดเวลา: 15 / 24 }), null);
  assert.equal(ruleOf({ สั่งผ่าตัดเวลา: "15:00:01" }), 5);
  assert.equal(ruleOf({ สั่งผ่าตัดเวลา: "07:59" }), 5);
  assert.equal(ruleOf({ ความเร่งด่วน: "Urgency" }), 6);
  assert.equal(ruleOf({ ความเร่งด่วน: "Urgency", สั่งผ่าตัดเวลา: "13:00" }), null);
  assert.equal(ruleOf({ ชื่อการผ่าตัด: "Septoplasty SMC" }), 4);
  assert.equal(ruleOf({ เวร: "นอกเวลา (วิสัญญี)" }), 4);
  assert.equal(ruleOf({ ความเร่งด่วน: "Emergency" }), 2);
  assert.equal(ruleOf({ สถานะภาพ: "ยกเลิกการผ่าตัด", ความเร่งด่วน: "Stat" }), 1); // the first rule wins
  assert.equal(ruleOf({ ID: null }), 0);
});

test("on call counts only for a case keyed in on its operation day or from 16:00 the evening before (Pong, 18 Nov 2026)", () => {
  const THU = 46331; // Thu 5 Nov 2026
  const ruleOf = (values: Record<string, XlsxCell>) => {
    const result = filterForUpload(parsed(sheetOf([{ ...ROW, ...values }])));
    return result.dropped[0] ? [result.dropped[0].rule, result.dropped[0].detail] : null;
  };
  // Booked ahead: "on call" is ignored, whatever the spelling.
  assert.equal(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call", วันที่: THU - 1, เวลา: "10:40:02" }), null);
  assert.equal(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call", วันที่: THU - 1, เวลา: 15.99 / 24 }), null);
  assert.equal(ruleOf({ ชื่อการผ่าตัด: "Appendectomy oncall", วันที่: THU - 3, เวลา: "22:00" }), null);
  assert.equal(ruleOf({ ชื่อการผ่าตัด: "Debridement under GA on-call", วันที่: "04/11/2569", เวลา: "09:15" }), null);
  // Keyed in on the day, from 16:00 the evening before (perhaps a duty case after midnight), or with no readable
  // request date or evening-before time: "on call" drops it.
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call", วันที่: THU, เวลา: "07:00" }), [3, "on call"]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call", วันที่: THU - 1, เวลา: "16:00:00" }), [3, "on call"]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call", วันที่: THU - 1, เวลา: "23:10" }), [3, "on call"]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call", วันที่: THU - 1 }), [3, "on call"]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "ORIF Lt radius on call" }), [3, "on call"]);
  // The other words still drop a case booked ahead.
  const ahead = { วันที่: THU - 1, เวลา: "10:00" };
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "ICD Rt chest stat", ...ahead }), [3, "stat"]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "on call explore lap emer", ...ahead }), [3, "emer"]);
  // Booked ahead does not override the label, the shift or the booked time.
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "Appendectomy on call", ...ahead, ความเร่งด่วน: "Emergency" }), [2, "Emergency"]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "Appendectomy on call", ...ahead, เวร: "นอกเวลา" }), [4, null]);
  assert.deepEqual(ruleOf({ ชื่อการผ่าตัด: "Appendectomy on call", ...ahead, สั่งผ่าตัดเวลา: "18:00" }), [5, "18:00"]);
});

test("booked ahead: keyed in before 16:00 on a day before the booked day", () => {
  const at = (requestDate: string | null, requestTime: string | null, bookedDate = "2026-11-05") => isBookedAhead({ requestDate, requestTime, bookedDate });
  assert.equal(at("2026-11-04", "15:59:59"), true);
  assert.equal(at("2026-11-04", "16:00"), false);
  assert.equal(at("2026-11-04", null), false);
  assert.equal(at("2026-11-03", "23:00"), true);
  assert.equal(at("2026-11-03", null), true);
  assert.equal(at("2026-11-05", "07:00"), false);
  assert.equal(at("2026-11-06", "07:00"), false);
  assert.equal(at(null, "07:00"), false);
  // across a month and a year
  assert.equal(at("2026-11-30", "15:00", "2026-12-01"), true);
  assert.equal(at("2026-12-31", "20:00", "2027-01-01"), false);
  const rows = byId(parsed());
  assert.deepEqual([rows.get("900007")?.requestDate, rows.get("900007")?.requestTime], ["2026-11-04", "10:40:02"]);
});

test("section 6 keywords: whole words for stat and today, emer starting a word", () => {
  assert.equal(notElectiveKeyword("Transurethral resection of prostate"), null);
  assert.equal(notElectiveKeyword("check status"), null);
  assert.equal(notElectiveKeyword("Remerge"), null);
  assert.equal(notElectiveKeyword("ICD Rt chest STAT"), "STAT");
  assert.equal(notElectiveKeyword("Appendectomy (on call)"), "on call");
  assert.equal(notElectiveKeyword("ORIF oncall"), "oncall");
  assert.equal(notElectiveKeyword("debridement under GA on-call"), "on-call");
  assert.equal(notElectiveKeyword("ORIF with LCPon call under SB"), "on call");
  assert.equal(notElectiveKeyword("revision sinus 28/01/2569On call บ่าย"), "On call");
  assert.equal(notElectiveKeyword("revision call"), null);
  assert.equal(notElectiveKeyword("ORIF on call", true), null);
  assert.equal(notElectiveKeyword("on call craniectomy stat", true), "stat");
  assert.equal(notElectiveKeyword("on call craniectomy stat"), "on call"); // the first word in the text
  assert.equal(notElectiveKeyword("Emergency laparotomy"), "Emer");
  assert.equal(notElectiveKeyword("Excision mass today"), "today");
  assert.equal(notElectiveKeyword("Cystoscopy ด่วน"), "ด่วน");
  assert.equal(notElectiveKeyword("ผ่าตัดวันนี้"), "วันนี้");
  assert.equal(notElectiveKeyword("เพิ่ม case"), "เพิ่ม");
});

test("cleaning trims, collapses spaces and drops invisible characters", () => {
  assert.equal(cleanText("  a\u00a0\u200b b\n\tc "), "a b c");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(900001), "900001");
});

test("prepareUpload: refusals, and the summary holds counts only", () => {
  const headers = prepareUpload({ rows: [SHEET[0].slice(0, 5)], date1904: false }, THURSDAY);
  assert.ok(!headers.ok && headers.error === "headers");
  const dates = prepareUpload({ rows: SHEET, date1904: false }, THURSDAY);
  assert.ok(!dates.ok && dates.error === "dates");
  assert.equal(dates.dates.length, 6);

  const day = prepareUpload({ rows: DAY_FILE, date1904: false }, THURSDAY);
  assert.ok(day.ok);
  assert.deepEqual(day.summary, summariseUpload(day.filter, day.cuts));
  assert.deepEqual(day.summary, {
    rows: 17,
    unique: 16,
    duplicates: 1,
    kept: 10,
    dropped: [
      { rule: 1, reason: "ยกเลิกการผ่าตัด", count: 1 },
      { rule: 2, reason: "ระบุ Stat / Emergency", count: 1 },
      { rule: 3, reason: "ชื่อการผ่าตัดระบุ on call / ฉุกเฉิน", count: 1 },
      { rule: 4, reason: "นอกเวลา", count: 1 },
      { rule: 5, reason: "เวลาผ่าตัดนอกช่วง 08:00–15:00 น.", count: 1 },
      { rule: 6, reason: "Urgency แต่ไม่ระบุเวลา", count: 1 },
    ],
    cut: [
      { reason: "tha-chalom", label: "เคสของ รพ.นครท่าฉลอม", count: 1 },
    ],
    toPlace: 9,
  });
  assert.equal(JSON.stringify(day.summary).includes("99000"), false); // no HN
});
