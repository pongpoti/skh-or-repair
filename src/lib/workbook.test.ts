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
  notElectiveKeyword,
  parseDateCell,
  parseExport,
  parseTimeCell,
  prepareUpload,
  REQUIRED_HEADERS,
  splitSurgeon,
  summariseUpload,
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

/** Rule set B answers: the rule number of each dropped case (the answers sheet's "#N …"). */
const DROPPED_BY_ANSWERS = {
  "900004": 6, // Urgency with no booked time
  "900005": 1, // Cancelled
  "900006": 2, // Marked Stat / Emergency
  "900007": 3, // Text says on call / emergency ("on call")
  "900008": 4, // Out of hours
  "900009": 5, // Booked outside 08:00–15:00 (16:20)
  "900029": 3, // Text says on call / emergency ("stat")
} as const;
const KEPT_BY_ANSWERS = ["900001", "900002", "900003", "900010", "900011", "900012", "900013", "900014", "900015"];

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

test("rule set B on rows 1–17 as the file for Thu 5 Nov: 17 rows, 16 cases, 9 kept, 7 dropped, 1 duplicate", () => {
  const rows = parsed();
  assert.equal(rows.length, 17);
  assert.deepEqual(guardTargetDate(rows, THURSDAY), { ok: true });
  const result = filterForUpload(rows);
  assert.deepEqual(result.counts, {
    rows: 17,
    unique: 16,
    duplicates: 1,
    kept: 9,
    dropped: 7,
    byRule: { 0: 0, 1: 1, 2: 1, 3: 2, 4: 1, 5: 1, 6: 1 },
  });
  assert.deepEqual(result.kept.map((row) => row.caseId), KEPT_BY_ANSWERS);
  assert.deepEqual(
    Object.fromEntries(result.dropped.map((row) => [row.caseId, row.rule])),
    DROPPED_BY_ANSWERS,
  );
  for (const row of result.dropped) assert.equal(row.reason, DROP_REASONS[row.rule]);
  const detail = Object.fromEntries(result.dropped.map((row) => [row.caseId, row.detail]));
  assert.equal(detail["900007"], "on call");
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

test("board cuts: of the 9 kept, Tha Chalom's 900012 and Thursday's vascular 900013 go, 7 are left to place", () => {
  const { kept } = filterForUpload(parsed());
  const cuts = boardCuts(kept, THURSDAY);
  assert.deepEqual(
    cuts.cut.map(({ caseId, reason }) => ({ caseId, reason })),
    [
      { caseId: "900012", reason: "tha-chalom" },
      { caseId: "900013", reason: "vascular" },
    ],
  );
  assert.deepEqual(cuts.kept.map((row) => row.caseId), ["900001", "900002", "900003", "900010", "900011", "900014", "900015"]);
  // Vascular surgery stays on a Monday or a Friday; Tha Chalom's cases never do.
  assert.deepEqual(boardCuts(kept, "2026-11-02").cut.map((row) => row.caseId), ["900012"]);
  assert.deepEqual(boardCuts(kept, "2026-11-06").cut.map((row) => row.caseId), ["900012"]);
  assert.deepEqual(boardCuts(kept, "2026-11-03").cut.map((row) => row.caseId), ["900012", "900013"]);
});

test("departments from แผนก, then ชนิด, then the surgeon's usual department in the file", () => {
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
    ]),
  );
  assert.deepEqual(
    rowsOf.map((row) => [row.dept, row.deptFrom]),
    [
      ["URO", "surgeon"],
      ["NEURO", "type"],
      [null, null],
    ],
  );
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

test("flags: dressing, SCOPE, Tha Chalom, SMC, emergency, and the cleaned values", () => {
  const rows = byId(parsed());
  assert.equal(rows.get("900010")?.dressing, true); // Dressing wound Lt leg
  assert.equal(rows.get("900004")?.dressing, false); // Debridement
  // EGD by a general surgeon who is on no list: the row's GENSX stands in for the team.
  assert.equal(rows.get("900011")?.scope, true);
  assert.equal(rows.get("900011")?.team, "GENSX");
  assert.equal(rows.get("900001")?.scope, false);
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

test("rows keep no patient name, age, AN, diagnosis, illnesses or costs", () => {
  const rows = parsed(SHEET);
  const keys = [
    "line", "caseId", "hn", "operation", "surgeon", "title", "status", "urgency", "emergency", "shift", "bookedDate",
    "bookedTime", "dept", "deptFrom", "team", "thaChalom", "smc", "dressing", "scope",
  ];
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), [...keys].sort());
  const text = JSON.stringify(rows);
  for (const secret of ["ผู้ป่วย", "690000001", "ปี", "เดือน", "ประกันสังคม", "IPD", "2750", "ศัลยกรรมหญิง"]) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("HN stays text as written, leading zeros kept", () => {
  const rows = parsed(sheetOf([{ ...ROW, HN: " 0012345 " }, { ...ROW, ID: 2, HN: 678 }]));
  assert.deepEqual(rows.map((row) => row.hn), ["0012345", "678"]);
  assert.equal(byId(parsed()).get("900001")?.hn, "99000001");
});

test("the date guard refuses the full sample (several dates) and lists them", () => {
  const rows = parsed(SHEET);
  assert.equal(rows.length, 28);
  const guard = guardTargetDate(rows, THURSDAY);
  assert.ok(!guard.ok);
  assert.deepEqual(guard.dates, ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.equal(guard.blank, 0);
  assert.match(guard.message, /2 พ\.ย\. 2569, 3 พ\.ย\. 2569, 4 พ\.ย\. 2569, 5 พ\.ย\. 2569, 6 พ\.ย\. 2569, 7 พ\.ย\. 2569/);
  assert.match(guard.message, /ต้องเป็นวันที่ 5 พ\.ย\. 2569/);

  // A blank booked date refuses the file too, and so does a file of the wrong day alone.
  const blank = guardTargetDate(parsed(sheetOf([ROW, { ...ROW, ID: 2, สั่งผ่าตัดวันที่: null }])), THURSDAY);
  assert.ok(!blank.ok);
  assert.deepEqual([blank.dates, blank.blank], [[THURSDAY], 1]);
  assert.match(blank.message, /ไม่มีวันที่ 1 แถว/);
  const wrongDay = guardTargetDate(parsed(), "2026-11-06");
  assert.ok(!wrongDay.ok);
  assert.deepEqual(wrongDay.dates, [THURSDAY]);
  // No case rows: nothing to refuse.
  assert.deepEqual(guardTargetDate([], THURSDAY), { ok: true });
});

test("missing headers are listed, and the two เวลา columns are told apart by order", () => {
  const header = SHEET[0].map((name) => (name === "HN" || name === "เวร" ? "อื่น" : name));
  const result = parseExport([header, ...SHEET.slice(1, 3)]);
  assert.ok(!result.ok);
  assert.deepEqual(result.missingHeaders, ["HN", "เวร"]);
  assert.match(result.message, /HN, เวร/);
  const empty = parseExport([]);
  assert.ok(!empty.ok);
  assert.deepEqual(empty.missingHeaders, [...REQUIRED_HEADERS]);

  assert.equal(headerIndex(SHEET[0], "เวลา"), 17); // R
  assert.equal(headerIndex(SHEET[0], "เวลา", 2), 31); // AF
  assert.equal(headerIndex(SHEET[0], "เวลา", 3), -1);
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

test("section 6 keywords: whole words for stat and today, emer starting a word", () => {
  assert.equal(notElectiveKeyword("Transurethral resection of prostate"), null);
  assert.equal(notElectiveKeyword("check status"), null);
  assert.equal(notElectiveKeyword("Remerge"), null);
  assert.equal(notElectiveKeyword("ICD Rt chest STAT"), "STAT");
  assert.equal(notElectiveKeyword("Appendectomy (on call)"), "on call");
  assert.equal(notElectiveKeyword("ORIF oncall"), "oncall");
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
    kept: 9,
    dropped: [
      { rule: 1, reason: "ยกเลิกการผ่าตัด", count: 1 },
      { rule: 2, reason: "ระบุ Stat / Emergency", count: 1 },
      { rule: 3, reason: "ชื่อการผ่าตัดระบุ on call / ฉุกเฉิน", count: 2 },
      { rule: 4, reason: "นอกเวลา", count: 1 },
      { rule: 5, reason: "เวลาผ่าตัดนอกช่วง 08:00–15:00 น.", count: 1 },
      { rule: 6, reason: "Urgency แต่ไม่ระบุเวลา", count: 1 },
    ],
    cut: [
      { reason: "tha-chalom", label: "เคสของ รพ.นครท่าฉลอม", count: 1 },
      { reason: "vascular", label: "ศัลยกรรมหลอดเลือด วันอังคาร–พฤหัสบดี (โควตาท่าฉลอม)", count: 1 },
    ],
    toPlace: 7,
  });
  assert.equal(JSON.stringify(day.summary).includes("99000"), false); // no HN
});
