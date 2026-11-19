import assert from "node:assert/strict";
import { test } from "node:test";
import { WEEK_DATA } from "../data/week-data.ts";
import { boardDayHref, boardHref, DAY_KEYS, DAY_NAMES, parseDay, shortThaiDay, thaiDate, todayIso, weekDates, workdayIndex } from "./days.ts";
import { DEFAULT_REPAIR_PERIODS } from "./repair.ts";
import { boardFor, isDressingCase, isScopeCase, resolveSurgeon, weekBoard, type WeekCase, type WeekFile } from "./week.ts";

// These weeks (Sep and Oct 2026) fall in the first half, which runs from 1 Jan 2026, so its rooms place the cases:
// there is no weekly schedule in this app (Pong, 18 Nov 2026: "forget normal day OR schedule"). lib/placement.test.ts
// covers placement in both halves; the tests here are the export week's own.
const REPAIR = DEFAULT_REPAIR_PERIODS;

function fixture(cases: Partial<WeekCase>[]): WeekFile {
  return {
    meta: { days: ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"], rows: 0, kept: 0, dropped: {} },
    cases: cases.map((item) => ({
      day: 0, dept: null, surgeon: "สมชาย กลับกลาย", title: "นพ.", proc: "x", status: "done",
      shift: null, emergency: false, ...item,
    })),
  };
}
const GENSX_SURGEON = "ขจรศักดิ์ โภคสมบัติ";
const roomsOf = (data: WeekFile, day = 0) => weekBoard(data, REPAIR)[day].operations.map((item) => item.roomId);

test("the export week runs Monday to Friday", () => {
  assert.deepEqual([...DAY_NAMES], ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  assert.deepEqual([...DAY_KEYS], ["mon", "tue", "wed", "thu", "fri"]);
  assert.deepEqual(weekBoard(WEEK_DATA, REPAIR).map((day) => day.name), [...DAY_NAMES]);
  assert.deepEqual(weekBoard(fixture([]), REPAIR).map((day) => day.date), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert.deepEqual(weekDates("2026-10-29"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.deepEqual(weekDates("2026-11-01"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]); // Sunday
  assert.deepEqual(weekDates("2026-12-31"), ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]); // across the year end
  assert.equal(parseDay(undefined), null);
  assert.equal(parseDay("nope"), null);
  assert.equal(parseDay("tue"), 1);
  assert.equal(parseDay(" FRI "), 4);
});

test("shows today's date in Thailand and that weekday's cases", () => {
  // 17:30 UTC on Monday is already Tuesday in Bangkok.
  assert.equal(todayIso(new Date("2026-10-26T17:30:00Z")), "2026-10-27");
  assert.equal(todayIso(new Date("2026-10-26T16:59:00Z")), "2026-10-26");
  assert.equal(workdayIndex("2026-10-26"), 0);
  assert.equal(workdayIndex("2026-10-30"), 4);
  assert.equal(workdayIndex("2026-10-31"), null);
  assert.equal(workdayIndex("2026-11-01"), null);
  assert.equal(thaiDate("2026-10-27"), "วันอังคารที่ 27 ตุลาคม 2569");
  assert.equal(thaiDate("2026-11-26", "short"), "วันพฤหัสบดีที่ 26 พ.ย. 2569");
  assert.equal(boardFor("2026-10-27", REPAIR)?.key, "tue");
  assert.equal(boardFor("2026-10-31", REPAIR), null);
  assert.equal(boardFor("2026-10-31", REPAIR, 2)?.key, "wed");
});

test("builds room links and keeps other parameters", () => {
  assert.equal(boardHref(null), "/");
  assert.equal(boardHref("or-3"), "/?room=or-3");
  assert.equal(boardHref(null, "/preview", "?day=thu&room=or-2"), "/preview?day=thu");
  assert.equal(boardHref("or-9", "/preview", "?day=fri"), "/preview?day=fri&room=or-9");
});

test("another day's address keeps the room and drops the date for the board's own day", () => {
  assert.equal(boardDayHref("2026-11-20", "2026-11-19"), "/?date=2026-11-20");
  assert.equal(boardDayHref("2026-11-18", "2026-11-19", "/", "?room=or-3&date=2026-11-17"), "/?room=or-3&date=2026-11-18");
  assert.equal(boardDayHref("2026-11-19", "2026-11-19", "/", "?room=or-3&date=2026-11-18"), "/?room=or-3");
  assert.equal(boardDayHref(null, "2026-11-19", "/", "?date=2026-11-18"), "/");
  assert.equal(boardDayHref("2026-11-20", "", "/preview", "?sample=1&date=2026-11-19"), "/preview?sample=1&date=2026-11-20");
});

test("a swipe's hint names the day short", () => {
  assert.equal(shortThaiDay("2026-11-20"), "ศ. 20 พ.ย.");
  assert.equal(shortThaiDay("2026-11-22"), "อา. 22 พ.ย.");
  assert.equal(shortThaiDay("2027-01-04"), "จ. 4 ม.ค.");
});

test("no case data is loaded, so today's board is empty and follows this week's allocation", () => {
  assert.equal(WEEK_DATA.cases.length, 0);
  assert.deepEqual(WEEK_DATA.meta.days, []);
  const today = boardFor("2026-10-27", REPAIR);
  assert.equal(today?.date, "2026-10-27");
  assert.deepEqual(today?.operations, []);
  assert.equal(boardFor("2026-10-27", REPAIR, 4)?.date, "2026-10-30"); // the preview's ?day=fri shows this week's Friday
});

test("every placed case lands in an OR", () => {
  const data = fixture([{ dept: "GENSX" }, { day: 2, dept: "ORTHO" }, { day: 4, dept: "EYE", proc: "dressing" }]);
  for (const day of weekBoard(data, REPAIR)) {
    for (const item of day.operations) assert.match(item.roomId, /^or-(1[0-3]|[1-9])$/);
  }
  assert.equal(weekBoard(data, REPAIR).reduce((sum, day) => sum + day.operations.length, 0), 3);
});

test("keeps no patient fields in the case data", () => {
  const allowed = new Set(["day", "dept", "surgeon", "title", "proc", "status", "shift", "emergency"]);
  for (const item of WEEK_DATA.cases) {
    for (const key of Object.keys(item)) assert.ok(allowed.has(key), key);
    assert.doesNotMatch(`${item.proc} ${item.surgeon}`, /(นาย|นางสาว|นาง |น\.ส\.|\bHN\b|\bAN\b|\d{6,})/);
  }
});

test("rooms follow the first half's rules, with no weekly schedule", () => {
  const data = fixture([
    { proc: "Dressing wound", dept: "GENSX" },
    { emergency: true, dept: "ORTHO" },
    { dept: "EYE" },
    { dept: "ORTHO" },
    { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "colonoscopy" },
    { dept: "GENSX" },
    { dept: "OBGYN" }, // operates in the obstetric building: off the board
  ]);
  // Monday 28 Sep 2026: dressing OR 10, emergency OR 9, EYE and the endoscopy the mixed room OR 11, ORTHO OR 13,
  // GENSX OR 12. Before 18 Nov 2026 this was the weekly schedule's OR 1, 8, 10, 11 or 12, 3 and 2 or 5.
  assert.deepEqual(roomsOf(data), ["or-10", "or-9", "or-11", "or-13", "or-11", "or-12"]);
});

test("orders each room's cases and tells the surgeon's department", () => {
  const day = weekBoard(fixture([{ dept: "GENSX", surgeon: GENSX_SURGEON, proc: "EGD" }, { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "ERCP" }, { dept: "GENSX", surgeon: GENSX_SURGEON, proc: "hernia" }]), REPAIR)[0];
  assert.deepEqual(day.operations.map((item) => [item.roomId, item.order]), [["or-11", 1], ["or-11", 2], ["or-12", 1]]);
  assert.equal(day.operations[0].specialty, "ศัลยกรรม · GENSX");
});

test("matches surgeons to the physician list, including a spelling variant", () => {
  assert.deepEqual(resolveSurgeon("สมชาย  กลับกลาย", "นพ."), { label: "นพ. สมชาย กลับกลาย", specialty: "ศัลยกรรม · URO", team: "URO" });
  assert.equal(resolveSurgeon("วันทนันท์ หล่อวัฒนกิจชัย", "นพ.").label, "นพ. วันทนันท์ หล่อวัฒนากิจชัย");
  assert.equal(resolveSurgeon("วันทนันท์ หล่อวัฒนกิจชัย", "นพ.").specialty, "ศัลยกรรมออร์โธปิดิกส์");
  assert.deepEqual(resolveSurgeon("ไม่มี ในรายชื่อ", "พญ."), { label: "พญ. ไม่มี ในรายชื่อ", specialty: null, team: null });
});

test("ignores a room the export names and places the case by the half's rooms", () => {
  // The file says OR 4, closed in the first half; general surgery lands in OR 12 whatever the file says.
  const data = fixture([{ dept: "GENSX", room: 4 } as Partial<WeekCase>]);
  assert.deepEqual(roomsOf(data), ["or-12"]);
});

test("the SCOPE room takes only a GENSX surgeon's endoscopic cases", () => {
  for (const name of ["EGD", "OGD under GA", "Gastroscopy", "Esophagoscopy", "colonoscopy+polypectomy", "Sigmoidoscopy", "ERCP", "Endoscopic sphincterotomy", "EUS"]) {
    assert.ok(isScopeCase(name, "GENSX"), name);
  }
  assert.equal(isScopeCase("BEGD", "GENSX"), false); // \b: whole word only
  // foreign-body removal is excluded, and so is anyone who is not labelled GENSX
  for (const name of ["remove FB by EGD", "Remove  fb", "foreign body removal gastroscopy", "FB esophagus"]) {
    assert.equal(isScopeCase(name, "GENSX"), false, name);
  }
  assert.equal(isScopeCase("colonoscopy", "URO"), false);
  assert.equal(isScopeCase("colonoscopy", null), false);
  assert.equal(isScopeCase("hernia repair", "GENSX"), false);
});

test("finds dressing cases by the rule bookings use: Pong's words, debridement in, grafts out (15 Nov 2026)", () => {
  for (const name of [
    "Dressing wound OD",
    "change vac dressing",
    "Change vac d/s",
    "D / S wound",
    "ds wound",
    "DW",
    "vacc d",
    "ทำแผล",
    "ล้างแผลที่ขา",
    "เปลี่ยนแผล",
    // the hospital's rule left these out; Pong's words take them in
    "debridement and dressing",
    "DB",
    "d.b. wound",
    "scrub and dressing",
    "closure with dressing",
    "excision lesion dw",
    "amputation d/s",
  ]) {
    assert.ok(isDressingCase(name), name);
  }
  // a graft keeps a case out; d/s, ds and dw inside a longer word are not the words
  for (const name of ["STSG dressing", "Skin graft + dressing", "suture wound", "hernia repair", "adsorb", "midwife dwell"]) {
    assert.equal(isDressingCase(name), false, name);
  }
});

test("the dressing room (OR 10 in the first half) takes dressing cases from any department and nothing else", () => {
  const data = fixture([
    { dept: "ORTHO", proc: "Dressing wound" },
    { dept: "URO", proc: "change vac dressing", emergency: true }, // dressing is checked before emergency
    { dept: "GENSX", proc: "STSG and dressing" }, // a graft is not a dressing case
  ]);
  const rooms = roomsOf(data);
  assert.equal(rooms[0], "or-10");
  assert.equal(rooms[1], "or-10");
  assert.notEqual(rooms[2], "or-10");
});
