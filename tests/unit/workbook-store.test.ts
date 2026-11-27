import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import {
  casesOf,
  deletePastLists,
  latestUpload,
  latestUploadForTarget,
  listedDays,
  resetDayLists,
  saveUpload,
  workbookFor,
  workbookForDay,
  type PlacedCase,
  type UploadInput,
} from "@/lib/workbook-store";
import { TEST_DB } from "./_setup";

// Made-up cases only: no real patient data in the repo.
function placed(position: number, more: Partial<PlacedCase> = {}): PlacedCase {
  return {
    caseId: String(70000 + position),
    hn: `00${position}`,
    operation: `Operation ${position}`,
    surgeon: "นพ. ตัวอย่าง ทดสอบ",
    dept: "GENSX",
    team: "GENSX",
    roomId: "or-12",
    shift: "in",
    status: "scheduled",
    urgency: "Elective",
    bookedTime: "08:30",
    position,
    patientName: `ผู้ป่วยสมมุติ ลำดับ${position}`,
    ...more,
  };
}

function upload(more: Partial<UploadInput> = {}): UploadInput {
  return {
    targetDate: "2026-11-17",
    cycleDay: "2026-11-16",
    uploadedAt: new Date("2026-11-16T15:10:00+07:00"),
    uploadedBy: "U-mx",
    uploaderName: "สมหญิง รักงาน",
    fileName: "or-list.xlsx",
    totalRows: 3,
    kept: 2,
    placed: 1,
    summary: { dropped: { "no-hn": 1 }, placed: { "or-12": 1 }, unplaced: { "no-department": 1 } },
    cases: [placed(1), placed(2, { roomId: null, dept: null, team: null, shift: null, urgency: null, bookedTime: null, patientName: null })],
    ...more,
  };
}

describe("workbook uploads (database)", () => {
  const pool = createPool(TEST_DB);

  before(() => ensureSchema(pool));
  beforeEach(() => pool.query("TRUNCATE workbook_uploads RESTART IDENTITY CASCADE"));
  after(async () => {
    await pool.query("TRUNCATE workbook_uploads RESTART IDENTITY CASCADE");
    await pool.end();
  });

  test("saves an upload with its cases and reads them back for the board", async () => {
    const saved = await saveUpload(pool, upload());
    assert.equal(saved.targetDate, "2026-11-17");
    assert.equal(saved.cycleDay, "2026-11-16");
    assert.equal(saved.uploadedAt.toISOString(), "2026-11-16T08:10:00.000Z");
    assert.deepEqual([saved.uploadedBy, saved.uploaderName, saved.fileName], ["U-mx", "สมหญิง รักงาน", "or-list.xlsx"]);
    assert.deepEqual([saved.totalRows, saved.kept, saved.placed], [3, 2, 1]);
    assert.deepEqual(saved.summary, upload().summary);

    const board = await workbookFor(pool, "2026-11-16", "2026-11-17");
    assert.ok(board);
    assert.equal(board.upload.id, saved.id);
    assert.deepEqual(
      board.cases.map(({ id, uploadId, ...rest }) => (assert.match(id, /^\d+$/), assert.equal(uploadId, saved.id), rest)),
      [
        { ...placed(1), hn: "1" },
        { ...placed(2, { roomId: null, dept: null, team: null, shift: null, urgency: null, bookedTime: null, patientName: null }), hn: "2" },
      ],
    );
    assert.equal(await workbookFor(pool, "2026-11-16", "2026-11-18"), null, "another target day");
    assert.equal(await workbookFor(pool, "2026-11-17", "2026-11-17"), null, "another cycle");
  });

  test("stores every HN normalised, keeps a case id's first row, and lists the cases in file order", async () => {
    const saved = await saveUpload(
      pool,
      upload({
        cases: [
          placed(3, { hn: " 00-12 345 " }),
          placed(1, { hn: "hn0042" }),
          placed(2, { hn: "๐๐๗๗" }),
          placed(9, { caseId: String(70000 + 3), hn: "999" }), // the same case id again
        ],
      }),
    );
    const cases = await casesOf(pool, saved.id);
    assert.deepEqual(
      cases.map((item) => [item.position, item.caseId, item.hn]),
      [
        [1, "70001", "HN0042"],
        [2, "70002", "77"],
        [3, "70003", "12345"],
      ],
    );
    assert.deepEqual(await casesOf(pool, "999999"), []);
  });

  test("an upload with no kept case is saved too, so the board knows MX has uploaded", async () => {
    const saved = await saveUpload(pool, upload({ cases: [], kept: 0, placed: 0, summary: null }));
    const board = await workbookFor(pool, "2026-11-16", "2026-11-17");
    assert.deepEqual(board, { upload: saved, cases: [] });
    assert.equal(saved.summary, null);
  });

  test("the board shows the cycle's latest upload; the upload page the latest for the target day", async () => {
    const first = await saveUpload(pool, upload({ uploadedAt: new Date("2026-11-16T15:05:00+07:00") }));
    const second = await saveUpload(pool, upload({ uploadedAt: new Date("2026-11-16T15:45:00+07:00"), cases: [placed(5)] }));
    // A file for the same day sent the evening before (another cycle), made later in time.
    const otherCycle = await saveUpload(pool, upload({ cycleDay: "2026-11-15", uploadedAt: new Date("2026-11-16T15:50:00+07:00") }));
    assert.equal((await latestUpload(pool, "2026-11-16", "2026-11-17"))?.id, second.id);
    assert.equal((await latestUpload(pool, "2026-11-15", "2026-11-17"))?.id, otherCycle.id);
    assert.equal((await latestUploadForTarget(pool, "2026-11-17"))?.id, otherCycle.id);
    assert.equal(await latestUploadForTarget(pool, "2026-11-18"), null);
    assert.deepEqual((await workbookFor(pool, "2026-11-16", "2026-11-17"))?.cases.map((item) => item.caseId), ["70005"]);
    assert.notEqual(first.id, second.id);

    // Two uploads in the same instant: the later saved wins.
    const tie = new Date("2026-11-16T15:55:00+07:00");
    await saveUpload(pool, upload({ uploadedAt: tie }));
    const last = await saveUpload(pool, upload({ uploadedAt: tie }));
    assert.equal((await latestUpload(pool, "2026-11-16", "2026-11-17"))?.id, last.id);
  });

  test("a new upload deletes every list of the days before its cycle day, at both hospitals", async () => {
    // Pong, 27 Nov 2026: "Disable past day view and clear pastday data for both places"
    const tc = (position: number) => placed(position, { caseId: String(80000 + position), roomId: "or-1", place: "tha-chalom" });
    const imported = await saveUpload(pool, upload({ cycleDay: "2026-01-04", targetDate: "2026-01-05", uploadedAt: new Date("2026-01-04T15:10:00+07:00") }));
    await pool.query("UPDATE workbook_uploads SET past_import = true WHERE id = $1", [imported.id]);
    const tuesday = await saveUpload(pool, upload({ cases: [placed(1), tc(1)] }));
    const again = await saveUpload(pool, upload({ uploadedAt: new Date("2026-11-16T15:20:00+07:00"), cases: [placed(1), tc(1)] }));
    // The next cycle's upload, for Wednesday, made on Tuesday: Tuesday's lists are still today's, so they stay.
    const wednesday = await saveUpload(
      pool,
      upload({ cycleDay: "2026-11-17", targetDate: "2026-11-18", uploadedAt: new Date("2026-11-17T15:10:00+07:00"), cases: [placed(1), tc(1)] }),
    );
    assert.deepEqual(await casesOf(pool, imported.id), [], "January's list is gone");
    assert.equal((await casesOf(pool, tuesday.id)).length, 1);
    assert.equal((await latestUploadForTarget(pool, "2026-11-17"))?.id, again.id);
    // Thursday's, made on Wednesday: Tuesday has passed, both of its lists go at both hospitals.
    await saveUpload(pool, upload({ cycleDay: "2026-11-18", targetDate: "2026-11-19", uploadedAt: new Date("2026-11-18T15:10:00+07:00"), cases: [placed(1), tc(1)] }));
    assert.deepEqual(await casesOf(pool, tuesday.id), []);
    assert.deepEqual(await casesOf(pool, again.id, "tha-chalom"), []);
    assert.equal(await workbookForDay(pool, "2026-11-17"), null);
    assert.deepEqual((await casesOf(pool, wednesday.id, "tha-chalom")).map((item) => item.caseId), ["80001"], "Wednesday's is today's");
    const { rows } = await pool.query<{ day: string }>("SELECT to_char(target_date, 'YYYY-MM-DD') AS day FROM workbook_uploads ORDER BY target_date");
    assert.deepEqual(rows.map((row) => row.day), ["2026-11-18", "2026-11-19"]);
    // On its own too, as the one-off clear-out uses it.
    assert.equal(await deletePastLists(pool, "2026-11-19"), 1);
    assert.equal(await deletePastLists(pool, "2026-11-19"), 0);
  });

  test("an admin resets one day to its bookings: every HOSxP list of the day goes, at both hospitals", async () => {
    // Pong, 27 Nov 2026: "Add option for admin to reset OR schedule of specific date (reset only for hosxp case)"
    const tc = (position: number) => placed(position, { caseId: String(80000 + position), roomId: "or-1", place: "tha-chalom" });
    await saveUpload(pool, upload({ cases: [placed(1)], uploaderName: "MX หนึ่ง" }));
    const latest = await saveUpload(pool, upload({ uploadedAt: new Date("2026-11-16T15:20:00+07:00"), cases: [placed(1), placed(2), tc(1)], uploaderName: "MX สอง" }));
    const other = await saveUpload(pool, upload({ cycleDay: "2026-11-17", targetDate: "2026-11-18", uploadedAt: new Date("2026-11-17T15:10:00+07:00") }));
    assert.deepEqual(
      (await listedDays(pool, "2026-11-17")).map((day) => [day.date, day.uploads, day.skh, day.thaChalom, day.latestBy, day.latestAt.toISOString()]),
      [
        ["2026-11-17", 2, 2, 1, "MX สอง", latest.uploadedAt.toISOString()],
        ["2026-11-18", 1, 2, 0, other.uploaderName, other.uploadedAt.toISOString()],
      ],
    );
    assert.deepEqual((await listedDays(pool, "2026-11-18")).map((day) => day.date), ["2026-11-18"], "from the given day on");

    assert.equal(await resetDayLists(pool, "2026-11-17"), 2);
    assert.equal(await workbookForDay(pool, "2026-11-17"), null);
    assert.equal(await workbookForDay(pool, "2026-11-17", "tha-chalom"), null);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM workbook_cases WHERE upload_id = $1", [latest.id])).rows[0].n, 0, "the cases went too");
    assert.equal((await workbookForDay(pool, "2026-11-18"))?.upload.id, other.id, "another day stays");
    assert.equal(await resetDayLists(pool, "2026-11-17"), 0);
  });

  test("a case the table refuses rolls the whole upload back", async () => {
    await assert.rejects(
      saveUpload(pool, upload({ cases: [placed(1), placed(2, { roomId: "or-14" })] })),
      (e: { code?: string }) => e.code === "23514",
    );
    const { rows } = await pool.query<{ uploads: number; cases: number }>(
      "SELECT (SELECT count(*)::int FROM workbook_uploads) AS uploads, (SELECT count(*)::int FROM workbook_cases) AS cases",
    );
    assert.deepEqual(rows[0], { uploads: 0, cases: 0 });
  });

  test("the table refuses a room, shift or status the board does not know, and an HN-less case", async () => {
    const saved = await saveUpload(pool, upload({ cases: [] }));
    const insert = (column: "room_id" | "shift" | "status" | "hn", value: string | null) => {
      const row: Record<string, string | null> = { hn: "1", status: "scheduled", room_id: null, shift: null, [column]: value };
      return pool.query(
        `INSERT INTO workbook_cases (upload_id, case_id, operation, surgeon, position, hn, status, room_id, shift)
         VALUES ($1, 'x', 'op', 'นพ. ก', 1, $2, $3, $4, $5)`,
        [saved.id, row.hn, row.status, row.room_id, row.shift],
      );
    };
    const check = (e: { code?: string }) => e.code === "23514";
    for (const room of ["or-0", "or-14", "OR-1", "r-1", ""]) await assert.rejects(insert("room_id", room), check, room);
    for (const room of ["or-1", "or-9", "or-13", null]) await insert("room_id", room);
    await assert.rejects(insert("shift", "night"), check);
    await assert.rejects(insert("status", "booked"), check);
    await assert.rejects(insert("hn", null), (e: { code?: string }) => e.code === "23502");
    // รพ.ท่าฉลอม's rooms only with its place (OR 1 to 4 and the Scope room), and only the two hospitals.
    const atPlace = (place: string, room: string | null) =>
      pool.query(
        `INSERT INTO workbook_cases (upload_id, case_id, operation, surgeon, position, hn, status, room_id, place)
         VALUES ($1, 'x', 'op', 'นพ. ก', 1, '1', 'scheduled', $2, $3)`,
        [saved.id, room, place],
      );
    for (const room of ["or-1", "or-4", "scope", null]) await atPlace("tha-chalom", room);
    for (const room of ["or-5", "or-13", "Scope"]) await assert.rejects(atPlace("tha-chalom", room), check, room);
    await assert.rejects(atPlace("skh", "scope"), check, "รพ.สมุทรสาคร has no Scope room");
    await assert.rejects(atPlace("elsewhere", "or-1"), check, "an unknown hospital");
  });

  // Pong, 27 Nov 2026: "Excel file include both place on one sheet".
  test("each hospital reads its own cases of an upload; an upload saved before kept no list for รพ.ท่าฉลอม", async () => {
    const tc = (position: number, more: Partial<PlacedCase> = {}) => placed(position, { caseId: String(80000 + position), roomId: "scope", place: "tha-chalom", ...more });
    const saved = await saveUpload(pool, upload({ cases: [placed(1), tc(1), placed(2), tc(2, { roomId: null })] }));
    assert.equal(saved.thaChalom, true);
    const skh = await workbookFor(pool, "2026-11-16", "2026-11-17");
    assert.deepEqual(skh?.cases.map((item) => item.caseId), ["70001", "70002"]);
    const thaChalom = await workbookFor(pool, "2026-11-16", "2026-11-17", "tha-chalom");
    assert.deepEqual(
      thaChalom?.cases.map((item) => [item.caseId, item.roomId, item.position]),
      [
        ["80001", "scope", 1],
        ["80002", null, 2],
      ],
    );
    assert.deepEqual((await workbookForDay(pool, "2026-11-17", "tha-chalom"))?.cases.length, 2);
    assert.deepEqual((await casesOf(pool, saved.id, "tha-chalom")).map((item) => item.caseId), ["80001", "80002"]);
    // An upload from before the change (tha_chalom false) is a list for รพ.สมุทรสาคร only.
    await pool.query("UPDATE workbook_uploads SET tha_chalom = false WHERE id = $1", [saved.id]);
    assert.equal(await workbookFor(pool, "2026-11-16", "2026-11-17", "tha-chalom"), null);
    assert.equal(await workbookForDay(pool, "2026-11-17", "tha-chalom"), null);
    assert.equal((await workbookFor(pool, "2026-11-16", "2026-11-17"))?.cases.length, 2);
  });
});
