import "./_setup";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { addUser, checkNewUser, type NewUser } from "@/lib/user-admin";
import { claimUser, listClaimable } from "@/lib/user-list";
import { subtypeChoices } from "@/lib/user-labels";
import { TEST_DB } from "./_setup";

describe("adding a name on /admin (lib/user-admin.ts)", () => {
  const pool = createPool(TEST_DB);

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    await pool.query(
      "INSERT INTO users (first_name, last_name, type, subtype, active) VALUES ('มีอยู่', 'แล้ว', 'RN', 'OR', true), ('ปิด', 'ไปแล้ว', 'PN', 'OR', false)",
    );
  });
  after(async () => {
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    await pool.end();
  });

  test("the form is checked and cleaned: names as the sync cleans them, a type, and a subtype of that type", () => {
    const ok = checkNewUser({ firstName: "  สม​ชาย  ", lastName: "ใจ   ดี", type: "DR", subtype: "ortho", email: " Som.Chai@Gmail.com " });
    assert.deepEqual(ok, {
      ok: true,
      user: { firstName: "สมชาย", lastName: "ใจ ดี", type: "DR", subtype: "ORTHO", email: "som.chai@gmail.com", phone: null },
    });
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

  test("a doctor needs an email address, anyone else a Thai mobile number (Pong, 21 Nov 2026)", () => {
    const base = { firstName: "x", lastName: "y" };
    const dr = (email?: unknown, phone?: unknown) => checkNewUser({ ...base, type: "DR", subtype: "ENT", email, phone });
    const rn = (phone?: unknown, email?: unknown) => checkNewUser({ ...base, type: "RN", subtype: "OR", phone, email });
    assert.deepEqual(dr(), { ok: false, error: "กรอกอีเมล" });
    assert.deepEqual(dr("  "), { ok: false, error: "กรอกอีเมล" });
    assert.deepEqual(dr(undefined, "0812345678"), { ok: false, error: "กรอกอีเมล" }, "a number is not enough for a doctor");
    for (const bad of ["somchai", "somchai@", "@gmail.com", "som chai@gmail.com", "somchai@gmail", "somchai@gmail.c", "a..b@gmail.com", ".a@gmail.com", "a@-gmail.com", "ทดลอง@gmail.com", `${"a".repeat(65)}@gmail.com`]) {
      assert.deepEqual(dr(bad), { ok: false, error: "อีเมลไม่ถูกต้อง เช่น name@gmail.com" }, bad);
    }
    assert.equal((dr("nat.w+or@skh.go.th") as { user: NewUser }).user.email, "nat.w+or@skh.go.th");
    assert.equal((dr("A@B.CO") as { user: NewUser }).user.email, "a@b.co");
    assert.deepEqual(rn(), { ok: false, error: "กรอกเบอร์มือถือ" });
    assert.deepEqual(rn(undefined, "a@gmail.com"), { ok: false, error: "กรอกเบอร์มือถือ" }, "an email is not enough for a nurse");
    for (const bad of ["02-123-4567", "0812345", "08123456789", "07123456789", "1234567890", "abc"]) {
      assert.deepEqual(rn(bad), { ok: false, error: "ใส่เบอร์มือถือ 10\u00A0หลัก ขึ้นต้นด้วย 06, 08 หรือ 09" }, bad);
    }
    for (const good of ["081-234-5678", "+66 81 234 5678", "๐๘๑๒๓๔๕๖๗๘", "0612345678", "0912345678"]) {
      const user = (rn(good) as { user: NewUser }).user;
      assert.ok(user.phone && /^0[689]\d{8}$/.test(user.phone) && user.email === null, good);
    }
    assert.equal((rn("+66 81 234 5678") as { user: NewUser }).user.phone, "0812345678");
  });

  test("adds a new name, refuses an active one, brings an inactive one back with the new type; records who added it", async () => {
    const added = await addUser(pool, { firstName: "ใหม่", lastName: "เอี่ยม", type: "RN", subtype: "OR", email: null, phone: "0811110001" }, "U-admin");
    assert.equal(added.status, "added");
    const row = await pool.query("SELECT type, subtype, active FROM users WHERE first_name = 'ใหม่'");
    assert.deepEqual(row.rows[0], { type: "RN", subtype: "OR", active: true });
    assert.deepEqual(await addUser(pool, { firstName: "มีอยู่", lastName: "แล้ว", type: "DR", subtype: "ENT", email: "mee@example.com", phone: null }, "U-admin"), { status: "exists" });
    assert.equal((await pool.query("SELECT type FROM users WHERE first_name = 'มีอยู่'")).rows[0].type, "RN", "an active name is left as it was");
    const back = await addUser(pool, { firstName: "ปิด", lastName: "ไปแล้ว", type: "PCA", subtype: "ANES", email: null, phone: "0811110002" }, "U-admin2");
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
      [1, 2].map(() => addUser(pool, { firstName: "พร้อม", lastName: "กัน", type: "RN", subtype: "OR", email: null, phone: "0811110003" }, "U-admin")),
    );
    assert.deepEqual(both.map((r) => r.status).sort(), ["added", "exists"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_emails WHERE email = 'mee@example.com'")).rows[0].n, 0, "nothing saved for a refused name");
  });

  test("saves a doctor's email address and anyone else's number; refuses one another active name has", async () => {
    const doc: NewUser = { firstName: "หมอ", lastName: "ใหม่", type: "DR", subtype: "ENT", email: "mor.mai@example.com", phone: null };
    const added = await addUser(pool, doc, "U-admin");
    assert.equal(added.status, "added");
    const id = (added as { id: string }).id;
    assert.deepEqual((await pool.query("SELECT email FROM user_emails WHERE user_id = $1", [id])).rows, [{ email: "mor.mai@example.com" }]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_phones WHERE user_id = $1", [id])).rows[0].n, 0, "no number for a doctor");
    // the same address for another doctor: refused, nothing added
    assert.deepEqual(await addUser(pool, { ...doc, firstName: "หมอ", lastName: "สอง" }, "U-admin"), { status: "email_taken" });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM users WHERE last_name = 'สอง'")).rows[0].n, 0);

    const nurse: NewUser = { firstName: "พยาบาล", lastName: "ใหม่", type: "RN", subtype: "OR", email: null, phone: "0822220001" };
    const rn = await addUser(pool, nurse, "U-admin");
    assert.equal(rn.status, "added");
    const rnId = (rn as { id: string }).id;
    assert.deepEqual((await pool.query("SELECT phone, added_by FROM user_phones WHERE user_id = $1", [rnId])).rows, [
      { phone: "0822220001", added_by: "U-admin" },
    ]);
    assert.deepEqual(await addUser(pool, { ...nurse, lastName: "สอง" }, "U-admin"), { status: "phone_taken" }, "a number given to another name");
    // a number that holds a name by SMS (a current claim) is taken too
    const { rows: held } = await pool.query("SELECT id FROM users WHERE first_name = 'มีอยู่'");
    await pool.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0822220002', 'U-held')", [held[0].id]);
    assert.deepEqual(await addUser(pool, { ...nurse, lastName: "สาม", phone: "0822220002" }, "U-admin"), { status: "phone_taken" });
    // a number given to a name that is no longer active is free again
    await pool.query("UPDATE users SET active = false WHERE id = $1", [rnId]);
    const reused = await addUser(pool, { ...nurse, lastName: "สี่" }, "U-admin");
    assert.equal(reused.status, "added");
    assert.deepEqual((await pool.query("SELECT user_id::text AS id FROM user_phones WHERE phone = '0822220001'")).rows, [{ id: (reused as { id: string }).id }]);
  });

  test("a name added with a number is claimed by that number only, and that number claims no other name", async () => {
    const nurse: NewUser = { firstName: "จอง", lastName: "เบอร์", type: "PN", subtype: "OR", email: null, phone: "0833330001" };
    const added = await addUser(pool, nurse, "U-admin");
    const id = (added as { id: string }).id;
    const other = (await pool.query("INSERT INTO users (first_name, last_name, type, subtype) VALUES ('อื่น', 'ทั่วไป', 'PN', 'OR') RETURNING id::text AS id")).rows[0].id;
    const claim = (phone: string, userId: string, sub: string) =>
      claimUser(pool, { userId, phone, sub, lineName: "", ip: "127.0.0.1", userAgent: "test" });
    // the claim page: taken for any other number, free for its own
    const listed = async (phone: string) => (await listClaimable(pool, "PN", phone)).find((n) => n.id === id)?.claimed;
    assert.equal(await listed("0833330009"), true);
    assert.equal(await listed("0833330001"), false);
    assert.equal(await listed("0899999999"), true);
    assert.equal((await listClaimable(pool, "PN", "0833330009")).find((n) => n.id === other)?.claimed, false, "a name without a number is free");
    assert.deepEqual(await claim("0833330009", id, "U-x"), { status: "taken" }, "another number");
    assert.deepEqual(await claim("0833330001", other, "U-y"), { status: "phone_has_claim" }, "its number on another name");
    const ok = await claim("0833330001", id, "U-z");
    assert.equal(ok.status, "claimed");
  });
});
