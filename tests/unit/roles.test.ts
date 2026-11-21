import "./_setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { addMx, boardViewer, canUpload, isMx, listActiveUsers, listMx, mxEligible, removeMx, userIdOf } from "@/lib/roles";
import { setTestEnv, TEST_DB } from "./_setup";

describe("roles: MX and admins (database)", () => {
  const pool = createPool(TEST_DB);
  const ids: Record<string, string> = {};
  const phone = (number: string, sub: string) => ({ sub, phone: number, userId: null });
  const byEmail = (userId: string, sub: string) => ({ sub, phone: null, userId });

  before(async () => {
    await ensureSchema(pool);
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string; first_name: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype, active) VALUES
         ('สมหญิง', 'รักงาน', 'RN', 'OR', true), ('กมล', 'ใจดี', 'DR', 'ORTHO', true),
         ('ประเสริฐ', 'มีสุข', 'DR', 'GENSX', true), ('บุญมี', 'ใจซื่อ', 'PCA', 'OR', false)
       RETURNING id::text AS id, first_name`,
    );
    for (const r of rows) ids[r.first_name] = r.id;
    await pool.query(`INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0812345678', 'U-nurse')`, [ids["สมหญิง"]]);
    // Doctors sign in by email: claims with no number.
    await pool.query(
      `INSERT INTO user_claims (user_id, phone, line_sub, via, email_verified_at) VALUES
         ($1, NULL, 'U-email', 'email', now()), ($2, NULL, 'U-doctor', 'email', now())`,
      [ids["ประเสริฐ"], ids["กมล"]],
    );
  });
  afterEach(() => setTestEnv());
  after(async () => {
    await pool.query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_phones, user_claims, email_codes, user_emails, users RESTART IDENTITY");
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

    // Only RN of the OR unit may be MX (Pong, 17 Nov 2026): a doctor is refused
    assert.equal(await addMx(pool, ids["ประเสริฐ"], "U-admin"), "ineligible");
    assert.equal((await pool.query("SELECT 1 FROM mx_members WHERE user_id = $1", [ids["ประเสริฐ"]])).rowCount, 0);
  });

  test("MX is for RN-OR only: the rule, and a member whose row stops being RN-OR keeps the row but not the role", async () => {
    assert.equal(mxEligible("RN", "OR"), true);
    assert.equal(mxEligible("RN", " OR "), true);
    for (const [type, subtype] of [["RN", "ANES"], ["PN", "OR"], ["PCA", "OR"], ["DR", "ORTHO"], ["RN", null], ["RN", "or"]] as const) {
      assert.equal(mxEligible(type, subtype), false, `${type} ${subtype}`);
    }
    const nurse = phone("0812345678", "U-nurse");
    await addMx(pool, ids["สมหญิง"], "U-admin");
    assert.equal(await isMx(pool, nurse), true);
    await pool.query("UPDATE users SET subtype = 'ANES' WHERE id = $1", [ids["สมหญิง"]]);
    assert.equal(await isMx(pool, nurse), false, "no longer RN-OR");
    assert.equal((await boardViewer(pool, nurse)).allHn, false);
    assert.equal((await listMx(pool)).find((m) => m.userId === ids["สมหญิง"])?.eligible, false, "listed as not eligible");
    await pool.query("UPDATE users SET subtype = 'OR' WHERE id = $1", [ids["สมหญิง"]]);
    assert.equal(await isMx(pool, nurse), true, "RN-OR again: the role works again");
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

  test("lists the members by name, with who granted them and whether the role works for them", async () => {
    // a member from before the RN-OR rule (added by hand): listed, but the role does nothing for a doctor
    await pool.query("INSERT INTO mx_members (user_id, added_by) VALUES ($1, 'U-admin')", [ids["ประเสริฐ"]]);
    assert.equal(await isMx(pool, byEmail(ids["ประเสริฐ"], "U-email")), false);
    const listed = await listMx(pool);
    assert.deepEqual(
      listed.map((m) => [m.name, m.type, m.subtype, m.active, m.eligible, m.addedBy]),
      [
        ["ประเสริฐ มีสุข", "DR", "GENSX", true, false, "U-admin"],
        ["สมหญิง รักงาน", "RN", "OR", true, true, "U-admin"],
      ],
    );
    assert.ok(listed.every((m) => m.addedAt instanceof Date));
  });

  test("admins and MX upload; nobody else does", async () => {
    process.env.AUTH_ADMIN_LINE_IDS = "U-admin";
    assert.equal(await canUpload(pool, phone("0899999999", "U-admin")), true, "an admin with no claim");
    assert.equal(await canUpload(pool, phone("0812345678", "U-nurse")), true, "MX");
    assert.equal(await canUpload(pool, byEmail(ids["กมล"], "U-doctor")), false, "a doctor");
    delete process.env.AUTH_ADMIN_LINE_IDS;
    assert.equal(await canUpload(pool, phone("0899999999", "U-admin")), false, "no admin list");
  });

  test("the board's viewer: every HN for MX and admins, the user's id for their own bookings", async () => {
    process.env.AUTH_ADMIN_LINE_IDS = "U-admin";
    assert.deepEqual(await boardViewer(pool, phone("0812345678", "U-nurse")), { allHn: true, userId: ids["สมหญิง"] });
    assert.deepEqual(await boardViewer(pool, byEmail(ids["กมล"], "U-doctor")), { allHn: false, userId: ids["กมล"] });
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
