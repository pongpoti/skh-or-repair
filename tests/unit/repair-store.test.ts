import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { DEFAULT_REPAIR_PERIODS } from "@/lib/repair";
import { getRepairPeriods, saveRepairPeriods } from "@/lib/repair-store";
import { TEST_DB } from "./_setup";

describe("repair periods (database)", () => {
  const pool = createPool(TEST_DB);

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE repair_periods, schedule_mode");
  });
  after(async () => {
    // Leave the seed as a fresh database has it.
    await pool.query("TRUNCATE repair_periods, schedule_mode");
    await ensureSchema(pool);
    await pool.end();
  });

  test("the schema seeds the planned dates, and applying it again never overwrites a saved half", async () => {
    await ensureSchema(pool);
    assert.deepEqual(await getRepairPeriods(pool), { ...DEFAULT_REPAIR_PERIODS, mode: "auto" });
    const { rows } = await pool.query("SELECT half, updated_by FROM repair_periods ORDER BY half");
    assert.deepEqual(rows, [{ half: 1, updated_by: null }, { half: 2, updated_by: null }]);

    const moved = { half1: { from: "2026-11-20", to: "2027-01-31" }, half2: { from: "2027-02-01", to: "2027-03-31" } };
    assert.deepEqual(await saveRepairPeriods(pool, moved, "U-admin"), { ok: true, periods: { ...moved, mode: "auto" } });
    await ensureSchema(pool);
    assert.deepEqual(await getRepairPeriods(pool), { ...moved, mode: "auto" });
    const saved = await pool.query("SELECT half, updated_by FROM repair_periods ORDER BY half");
    assert.deepEqual(saved.rows, [{ half: 1, updated_by: "U-admin" }, { half: 2, updated_by: "U-admin" }]);
  });

  test("a seed nobody edited moves to the repair's start on 8 Dec 2026; an admin's dates stay", async () => {
    await pool.query("TRUNCATE repair_periods");
    await pool.query("INSERT INTO repair_periods (half, from_date, to_date) VALUES (1, '2026-01-01', '2027-01-26'), (2, '2027-01-27', '2027-03-17')");
    await ensureSchema(pool);
    assert.equal((await getRepairPeriods(pool)).half1.from, "2026-12-08");
    await pool.query("UPDATE repair_periods SET from_date = '2026-01-01', updated_by = 'U-admin' WHERE half = 1");
    await ensureSchema(pool);
    assert.equal((await getRepairPeriods(pool)).half1.from, "2026-01-01", "an admin's own date");
  });

  test("the admin's switch is saved for everyone with the dates, and a missing or unreadable switch is auto", async () => {
    await pool.query("TRUNCATE schedule_mode");
    const dates = { half1: DEFAULT_REPAIR_PERIODS.half1, half2: DEFAULT_REPAIR_PERIODS.half2 };
    assert.equal((await getRepairPeriods(pool)).mode, "auto", "no row");
    for (const mode of ["normal", "half1", "half2", "auto"] as const) {
      assert.deepEqual(await saveRepairPeriods(pool, { ...dates, mode }, "U-admin"), { ok: true, periods: { ...dates, mode } });
      assert.equal((await getRepairPeriods(pool)).mode, mode);
    }
    const before = await pool.query("SELECT updated_at FROM schedule_mode");
    await saveRepairPeriods(pool, { ...dates, mode: "auto" }, "U-other");
    const unchanged = await pool.query("SELECT updated_at, updated_by FROM schedule_mode");
    assert.deepEqual(unchanged.rows, [{ updated_at: before.rows[0].updated_at, updated_by: "U-admin" }], "the same choice writes nothing");
    assert.deepEqual(await saveRepairPeriods(pool, { ...dates, mode: "weekly" }, "U-admin"), { ok: false, error: "เลือกตารางที่ใช้ให้ถูกต้อง" });
    const code = (c: string) => (e: { code?: string }) => e.code === c;
    await assert.rejects(pool.query("UPDATE schedule_mode SET mode = 'weekly'"), code("23514"));
    await assert.rejects(pool.query("INSERT INTO schedule_mode (id, mode) VALUES (2, 'auto')"), code("23514"));
  });

  test("a refused input saves nothing and says why in Thai", async () => {
    const before = await getRepairPeriods(pool);
    const bad = { half1: { from: "2026-11-20", to: "2027-01-31" }, half2: { from: "2027-01-31", to: "2027-03-31" } };
    assert.deepEqual(await saveRepairPeriods(pool, bad, "U-admin"), { ok: false, error: "ช่วงที่ 2 ต้องเริ่มหลังช่วงที่ 1 จบ" });
    assert.deepEqual(await saveRepairPeriods(pool, { half1: { from: "x" } }, "U-admin"), { ok: false, error: "ใส่วันที่ให้ครบทั้ง 4 ช่อง" });
    assert.deepEqual(await getRepairPeriods(pool), before);
  });

  test("the table itself refuses a half outside 1 and 2 and a half that ends before it starts", async () => {
    const code = (c: string) => (e: { code?: string }) => e.code === c;
    await assert.rejects(pool.query("INSERT INTO repair_periods (half, from_date, to_date) VALUES (3, '2027-01-01', '2027-01-02')"), code("23514"));
    await assert.rejects(pool.query("UPDATE repair_periods SET to_date = '2026-01-01' WHERE half = 1"), code("23514"));
  });

  test("falls back to the planned dates when a half is missing or the table cannot be read, warning once", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    await pool.query("DELETE FROM repair_periods WHERE half = 2");
    assert.deepEqual(await getRepairPeriods(pool), { ...DEFAULT_REPAIR_PERIODS, mode: "auto" });
    const broken = { query: async () => Promise.reject(new Error("connection refused")) } as unknown as typeof pool;
    assert.deepEqual(await getRepairPeriods(broken), DEFAULT_REPAIR_PERIODS);
    assert.deepEqual(await getRepairPeriods(broken), DEFAULT_REPAIR_PERIODS);
    assert.ok(warn.mock.calls.length <= 1, "one warning per server instance");
  });
});
