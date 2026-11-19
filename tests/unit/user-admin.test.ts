import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { addUser, checkNewUser } from "@/lib/user-admin";
import { subtypeChoices } from "@/lib/user-labels";
import { TEST_DB } from "./_setup";

describe("adding a name on /admin (lib/user-admin.ts)", () => {
  const pool = createPool(TEST_DB);

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    await pool.query(
      "INSERT INTO users (first_name, last_name, type, subtype, active) VALUES ('มีอยู่', 'แล้ว', 'RN', 'OR', true), ('ปิด', 'ไปแล้ว', 'PN', 'OR', false)",
    );
  });
  after(async () => {
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    await pool.end();
  });

  test("the form is checked and cleaned: names as the sync cleans them, a type, and a subtype of that type", () => {
    const ok = checkNewUser({ firstName: "  สม​ชาย  ", lastName: "ใจ   ดี", type: "DR", subtype: "ortho" });
    assert.deepEqual(ok, { ok: true, user: { firstName: "สมชาย", lastName: "ใจ ดี", type: "DR", subtype: "ORTHO" } });
    assert.deepEqual(checkNewUser({ firstName: "", lastName: "x", type: "RN", subtype: "OR" }), { ok: false, error: "กรอกชื่อ" });
    assert.deepEqual(checkNewUser({ firstName: "x", lastName: " ", type: "RN", subtype: "OR" }), { ok: false, error: "กรอกนามสกุล" });
    assert.deepEqual(checkNewUser({ firstName: "x", lastName: "y", type: "MX", subtype: "OR" }), { ok: false, error: "เลือกตำแหน่ง" });
    assert.deepEqual(checkNewUser({ firstName: "x", lastName: "y", type: "DR", subtype: "OR" }), { ok: false, error: "เลือกสาขา" });
    assert.deepEqual(checkNewUser({ firstName: "x", lastName: "y", type: "RN", subtype: "ORTHO" }), { ok: false, error: "เลือกหน่วย" });
    assert.equal(checkNewUser({ firstName: "x".repeat(101), lastName: "y", type: "RN", subtype: "OR" }).ok, false);
    assert.equal(checkNewUser({ firstName: "x\u0007", lastName: "y", type: "RN", subtype: "OR" }).ok, false);
    assert.deepEqual(
      subtypeChoices("RN").map((c) => c.code),
      ["OR", "ANES"],
    );
    assert.ok(subtypeChoices("DR").some((c) => c.code === "ANES" && c.name === "วิสัญญี"));
  });

  test("adds a new name, refuses an active one, brings an inactive one back with the new type; records who added it", async () => {
    const added = await addUser(pool, { firstName: "ใหม่", lastName: "เอี่ยม", type: "RN", subtype: "OR" }, "U-admin");
    assert.equal(added.status, "added");
    const row = await pool.query("SELECT type, subtype, active FROM users WHERE first_name = 'ใหม่'");
    assert.deepEqual(row.rows[0], { type: "RN", subtype: "OR", active: true });
    assert.deepEqual(await addUser(pool, { firstName: "มีอยู่", lastName: "แล้ว", type: "DR", subtype: "ENT" }, "U-admin"), { status: "exists" });
    assert.equal((await pool.query("SELECT type FROM users WHERE first_name = 'มีอยู่'")).rows[0].type, "RN", "an active name is left as it was");
    const back = await addUser(pool, { firstName: "ปิด", lastName: "ไปแล้ว", type: "PCA", subtype: "ANES" }, "U-admin2");
    assert.equal(back.status, "reactivated");
    assert.deepEqual((await pool.query("SELECT type, subtype, active FROM users WHERE first_name = 'ปิด'")).rows[0], {
      type: "PCA",
      subtype: "ANES",
      active: true,
    });
    const marks = await pool.query("SELECT u.first_name, a.added_by FROM users_added a JOIN users u ON u.id = a.user_id ORDER BY 1");
    assert.deepEqual(marks.rows, [
      { first_name: "ปิด", added_by: "U-admin2" },
      { first_name: "ใหม่", added_by: "U-admin" },
    ]);
    // two admins adding the same name at once: one adds it, the other is told it exists
    const both = await Promise.all(
      [1, 2].map(() => addUser(pool, { firstName: "พร้อม", lastName: "กัน", type: "RN", subtype: "OR" }, "U-admin")),
    );
    assert.deepEqual(both.map((r) => r.status).sort(), ["added", "exists"]);
  });
});
