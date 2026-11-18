import "./_setup";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import {
  casesOf,
  KEEP_UPLOAD_DAYS,
  latestUpload,
  latestUploadForTarget,
  pastListSpan,
  savePastLists,
  saveUpload,
  workbookFor,
  workbookForDay,
  type PastList,
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

  test(`a new upload deletes the uploads made more than ${KEEP_UPLOAD_DAYS} days before it that a later list of their day replaced`, async () => {
    const day = 86_400_000;
    const now = new Date("2026-12-20T15:10:00+07:00");
    const old = (ms: number) => new Date(now.getTime() - 30 * day - ms);
    // 20 Nov: two lists more than 30 days old; the first was replaced by the second.
    const replaced = await saveUpload(pool, upload({ cycleDay: "2026-11-19", targetDate: "2026-11-20", uploadedAt: old(60_000) }));
    const latest = await saveUpload(pool, upload({ cycleDay: "2026-11-19", targetDate: "2026-11-20", uploadedAt: old(1000) }));
    // 23 Nov: replaced, but less than 30 days ago.
    const young = await saveUpload(pool, upload({ cycleDay: "2026-11-20", targetDate: "2026-11-23", uploadedAt: new Date(now.getTime() - 30 * day + 1000) }));
    await saveUpload(pool, upload({ cycleDay: "2026-11-20", targetDate: "2026-11-23", uploadedAt: new Date(now.getTime() - 30 * day + 2000) }));
    assert.equal((await casesOf(pool, replaced.id)).length, 2);

    await saveUpload(pool, upload({ cycleDay: "2026-12-20", targetDate: "2026-12-21", uploadedAt: now }));
    assert.deepEqual(await casesOf(pool, replaced.id), [], "older than 30 days and replaced: gone, with its cases");
    assert.equal((await latestUploadForTarget(pool, "2026-11-20"))?.id, latest.id, "the day's latest list stays for the calendar");
    assert.equal((await casesOf(pool, latest.id)).length, 2);
    assert.equal((await casesOf(pool, young.id)).length, 2, "replaced but younger than 30 days: kept");
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM workbook_uploads");
    assert.equal(rows[0].n, 4);
  });

  test("an old list a new upload of the same day replaces goes at once", async () => {
    const first = await saveUpload(pool, upload({ uploadedAt: new Date("2026-11-16T15:10:00+07:00") }));
    // An admin uploads the same day's list again, more than 30 days later.
    const again = await saveUpload(pool, upload({ cycleDay: "2026-12-20", uploadedAt: new Date("2026-12-20T15:10:00+07:00") }));
    assert.deepEqual(await casesOf(pool, first.id), []);
    assert.equal((await latestUploadForTarget(pool, "2026-11-17"))?.id, again.id);
  });

  describe("past days' lists an admin imports", () => {
    const at = new Date("2026-11-19T06:00:00+07:00");
    const list = (targetDate: string, cases: PlacedCase[] = [placed(1), placed(2)]): PastList => ({
      targetDate,
      totalRows: cases.length + 1,
      kept: cases.length,
      placed: cases.length,
      summary: { rows: cases.length + 1 },
      cases,
    });
    const importing = (lists: PastList[], uploadedAt = at) =>
      savePastLists(pool, { cycleDay: "2026-11-19", uploadedAt, uploadedBy: "U-admin", uploaderName: "ผู้ดูแล ทดสอบ", fileName: "export.xlsx", lists });

    test("each day gets a list the board reads like any other, marked as imported", async () => {
      assert.deepEqual(await pastListSpan(pool), { days: 0, first: null, last: null });
      const saved = await importing([list("2026-01-05"), list("2026-01-02", [placed(3)]), list("2026-01-06", [])]);
      assert.deepEqual(saved, { saved: ["2026-01-02", "2026-01-05", "2026-01-06"], mxDays: [] });

      const day = await workbookForDay(pool, "2026-01-05");
      assert.ok(day);
      assert.equal(day.upload.pastImport, true);
      assert.deepEqual([day.upload.cycleDay, day.upload.uploadedBy, day.upload.fileName, day.upload.totalRows], ["2026-11-19", "U-admin", "export.xlsx", 3]);
      assert.deepEqual(day.cases.map((item) => [item.caseId, item.hn]), [["70001", "1"], ["70002", "2"]]);
      assert.deepEqual((await workbookForDay(pool, "2026-01-02"))?.cases.map((item) => item.caseId), ["70003"]);
      assert.deepEqual((await workbookForDay(pool, "2026-01-06"))?.cases, [], "a day with no case still has its list");
      assert.deepEqual(await pastListSpan(pool), { days: 3, first: "2026-01-02", last: "2026-01-06" });
    });

    test("importing again replaces the earlier import's lists instead of stacking them", async () => {
      await importing([list("2026-01-05"), list("2026-01-06")]);
      await importing([list("2026-01-05", [placed(9)])], new Date(at.getTime() + 60_000));
      assert.deepEqual((await workbookForDay(pool, "2026-01-05"))?.cases.map((item) => item.caseId), ["70009"]);
      assert.equal((await workbookForDay(pool, "2026-01-06"))?.cases.length, 2, "a day the new file does not hold keeps its list");
      const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM workbook_uploads");
      assert.equal(rows[0].n, 2);
    });

    test("a day MX uploaded a list for keeps MX's list", async () => {
      const mx = await saveUpload(pool, upload({ targetDate: "2026-11-17" }));
      const saved = await importing([list("2026-11-16"), list("2026-11-17", [placed(5)])]);
      assert.deepEqual(saved, { saved: ["2026-11-16"], mxDays: ["2026-11-17"] });
      assert.equal((await workbookForDay(pool, "2026-11-17"))?.upload.id, mx.id);
      assert.equal((await casesOf(pool, mx.id)).length, 2);
      assert.deepEqual(await pastListSpan(pool), { days: 1, first: "2026-11-16", last: "2026-11-16" });
    });

    test("imported lists stay when MX's uploads are cleared, being their day's latest", async () => {
      await importing([list("2026-01-05")]);
      await saveUpload(pool, upload({ cycleDay: "2027-01-20", targetDate: "2027-01-21", uploadedAt: new Date("2027-01-20T15:10:00+07:00") }));
      assert.equal((await workbookForDay(pool, "2026-01-05"))?.cases.length, 2);
    });

    test("a case the table refuses rolls the whole import back", async () => {
      await assert.rejects(importing([list("2026-01-05"), list("2026-01-06", [placed(1, { roomId: "or-99" })])]));
      assert.deepEqual(await pastListSpan(pool), { days: 0, first: null, last: null });
    });
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
  });
});
