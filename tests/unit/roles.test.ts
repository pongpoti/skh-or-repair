import "./_setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { addMx, boardViewer, canUpload, isMx, listActiveUsers, listMx, removeMx, userIdOf } from "@/lib/roles";
import { setTestEnv, TEST_DB } from "./_setup";

describe("roles: MX and admins (database)", () => {
  const pool = createPool(TEST_DB);
  const ids: Record<string, string> = {};
  const phone = (number: string, sub: string) => ({ sub, phone: number, userId: null });

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE cases, mx_members, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string; first_name: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype, active) VALUES
         ('สมหญิง', 'รักงาน', 'RN', 'OR', true), ('กมล', 'ใจดี', 'DR', 'ORTHO', true),
         ('ประเสริฐ', 'มีสุข', 'DR', 'GENSX', true), ('บุญมี', 'ใจซื่อ', 'PCA', 'OR', false)
       RETURNING id::text AS id, first_name`,
    );
    for (const r of rows) ids[r.first_name] = r.id;
    await pool.query(
      `INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0812345678', 'U-nurse'), ($2, '0900000001', 'U-doctor')`,
      [ids["สมหญิง"], ids["กมล"]],
    );
    // A doctor signed in by email: a claim with no number.
    await pool.query(
      `INSERT INTO user_claims (user_id, phone, line_sub, via, email_verified_at) VALUES ($1, NULL, 'U-email', 'email', now())`,
      [ids["ประเสริฐ"]],
    );
  });
  afterEach(() => setTestEnv());
  after(async () => {
    await pool.query("TRUNCATE cases, mx_members, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    await pool.end();
  });

  test("an admin grants MX to an active user; the role holds through the user's claim", async () => {
    const nurse = phone("0812345678", "U-nurse");
    assert.equal(await isMx(pool, nurse), false);
    assert.equal(await addMx(pool, ids["สมหญิง"], "U-admin"), "added");
    assert.equal(await addMx(pool, ids["สมหญิง"], "U-admin"), "already");
    assert.equal(await isMx(pool, nurse), true);
    assert.equal(await isMx(pool, phone("0812345678", "U-other-line")), true, "the number's claim decides, whatever LINE account");
    assert.equal(await isMx(pool, phone("0899999999", "U-x")), false, "a number with no claim");

    const email = { sub: "U-email", phone: null, userId: ids["ประเสริฐ"] };
    assert.equal(await isMx(pool, email), false);
    assert.equal(await addMx(pool, ids["ประเสริฐ"], "U-admin"), "added");
    assert.equal(await isMx(pool, email), true, "a doctor signed in by email");
    assert.equal(await isMx(pool, { ...email, sub: "U-someone-else" }), false, "only from the LINE account holding the claim");
  });

  test("no MX for a missing or inactive user, or an id that is no users.id", async () => {
    assert.equal(await addMx(pool, ids["บุญมี"], "U-admin"), "missing", "inactive");
    assert.equal(await addMx(pool, "999999", "U-admin"), "missing");
    for (const bad of ["0", "-1", "abc", "2147483648", "1; DROP TABLE users", ""]) {
      assert.equal(await addMx(pool, bad, "U-admin"), "missing", bad);
      assert.equal(await removeMx(pool, bad), false, bad);
    }
    assert.equal(userIdOf(5), "5");
    assert.equal(userIdOf("12"), "12");
    assert.equal(userIdOf("012"), null);
    assert.equal(userIdOf(1.5), null);
  });

  test("a user who goes inactive keeps the row but loses the role", async () => {
    const nurse = phone("0812345678", "U-nurse");
    await pool.query("UPDATE users SET active = false WHERE id = $1", [ids["สมหญิง"]]);
    assert.equal(await isMx(pool, nurse), false);
    const listed = await listMx(pool);
    assert.equal(listed.find((m) => m.userId === ids["สมหญิง"])?.active, false);
    await pool.query("UPDATE users SET active = true WHERE id = $1", [ids["สมหญิง"]]);
    assert.equal(await isMx(pool, nurse), true);
  });

  test("lists the members by name, with who granted them", async () => {
    const listed = await listMx(pool);
    assert.deepEqual(
      listed.map((m) => [m.name, m.type, m.subtype, m.active, m.addedBy]),
      [
        ["ประเสริฐ มีสุข", "DR", "GENSX", true, "U-admin"],
        ["สมหญิง รักงาน", "RN", "OR", true, "U-admin"],
      ],
    );
    assert.ok(listed.every((m) => m.addedAt instanceof Date));
  });

  test("admins and MX upload; nobody else does", async () => {
    process.env.AUTH_ADMIN_LINE_IDS = "U-admin";
    assert.equal(await canUpload(pool, phone("0899999999", "U-admin")), true, "an admin with no claim");
    assert.equal(await canUpload(pool, phone("0812345678", "U-nurse")), true, "MX");
    assert.equal(await canUpload(pool, phone("0900000001", "U-doctor")), false, "a doctor");
    delete process.env.AUTH_ADMIN_LINE_IDS;
    assert.equal(await canUpload(pool, phone("0899999999", "U-admin")), false, "no admin list");
  });

  test("the board's viewer: every HN for MX and admins, the user's id for their own bookings", async () => {
    process.env.AUTH_ADMIN_LINE_IDS = "U-admin";
    assert.deepEqual(await boardViewer(pool, phone("0812345678", "U-nurse")), { allHn: true, userId: ids["สมหญิง"] });
    assert.deepEqual(await boardViewer(pool, phone("0900000001", "U-doctor")), { allHn: false, userId: ids["กมล"] });
    assert.deepEqual(await boardViewer(pool, phone("0899999999", "U-admin")), { allHn: true, userId: null });
    assert.deepEqual(await boardViewer(pool, phone("0899999999", "U-x")), { allHn: false, userId: null });
  });

  test("revoking deletes the row", async () => {
    assert.equal(await removeMx(pool, ids["สมหญิง"]), true);
    assert.equal(await removeMx(pool, ids["สมหญิง"]), false);
    assert.equal(await isMx(pool, phone("0812345678", "U-nurse")), false);
  });

  test("the picker lists active users only, by name, with whether they are MX", async () => {
    assert.deepEqual(
      (await listActiveUsers(pool)).map((u) => [u.name, u.type, u.mx]),
      [
        ["กมล ใจดี", "DR", false],
        ["ประเสริฐ มีสุข", "DR", true],
        ["สมหญิง รักงาน", "RN", false],
      ],
    );
  });
});
