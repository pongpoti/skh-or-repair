import "./_setup";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import { POST as sendRoute } from "@/app/api/auth/email/send/route";
import { POST as verifyRoute } from "@/app/api/auth/email/verify/route";
import { profileFor } from "@/lib/auth/display-name";
import { userFromToken } from "@/lib/auth/user";
import { isAuthorizedDoctor, isAuthorizedPhone, resetAuthzCache } from "@/lib/authz";
import { doctorFor } from "@/lib/cases";
import { db } from "@/lib/db";
import { codeSubject, codeText, emailTransport, type EmailTransport } from "@/lib/email";
import {
  doctorWithEmails,
  EMAIL_LIMITS,
  freshEmailClaim,
  hasLiveEmailCode,
  listDoctors,
  maskEmail,
  sendEmailCode,
  signInByEmail,
  verifyEmailCode,
} from "@/lib/email-otp";
import { ConfigError, emailConfig } from "@/lib/env";
import { MSG } from "@/lib/http";
import { MAX_ATTEMPTS, upsertBinding } from "@/lib/otp";
import { buildClaimMessage, buildEmailSignInMessage } from "@/lib/telegram";
import { signPending, signSession, verifySession } from "@/lib/tokens";
import { claimUser, getListedUser } from "@/lib/user-list";
import { setTestEnv, TEST_PEPPER as PEPPER, TEST_SESSION_SECRET as SECRET } from "./_setup";

// Invented names, numbers and addresses only.

/** A transport that keeps what it was asked to send (or fails as told). */
function fakeTransport(fail?: "misconfigured" | "rejected" | "failed") {
  const sent: { to: string[]; code: string; name: string }[] = [];
  const transport: EmailTransport = {
    async sendCode(m) {
      if (fail) return { ok: false, reason: fail };
      sent.push(m);
      return { ok: true, accepted: m.to.length };
    },
  };
  return { sent, transport };
}

describe("email configuration (EMAIL_PROVIDER, SMTP_*)", () => {
  const NAMES = ["EMAIL_PROVIDER", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "EMAIL_OUTBOX_DIR", "EMAIL_DAILY_CAP", "VERCEL"];
  const saved: Record<string, string | undefined> = {};
  before(() => {
    for (const n of NAMES) saved[n] = process.env[n];
  });
  beforeEach(() => {
    for (const n of NAMES) delete process.env[n];
  });
  after(() => {
    for (const n of NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });
  const names = () => {
    try {
      emailConfig();
      return [];
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      return e.names;
    }
  };

  test("smtp by default: Gmail on 465 (implicit TLS), user and app password required, From defaults to the user", () => {
    assert.deepEqual(names(), ["SMTP_USER", "SMTP_PASS"]);
    Object.assign(process.env, { SMTP_USER: "orskh.app@example.com", SMTP_PASS: "app password" });
    const c = emailConfig();
    assert.deepEqual(
      { kind: c.kind, host: c.host, port: c.port, secure: c.secure, from: c.from, cap: c.dailyCap },
      { kind: "smtp", host: "smtp.gmail.com", port: 465, secure: true, from: "orskh.app@example.com", cap: 300 },
    );
    Object.assign(process.env, { SMTP_PORT: "587", EMAIL_FROM: "ORSKH <orskh.app@example.com>", EMAIL_DAILY_CAP: "50" });
    assert.deepEqual([emailConfig().secure, emailConfig().from, emailConfig().dailyCap], [false, "ORSKH <orskh.app@example.com>", 50]);
    for (const [name, value] of [
      ["SMTP_PORT", "0"],
      ["SMTP_PORT", "abc"],
      ["SMTP_HOST", "smtp.example.com/x"],
      ["EMAIL_FROM", "a@b.c\r\nBcc: x@y.z"],
      ["EMAIL_FROM", "no address"],
      ["EMAIL_DAILY_CAP", "0"],
      ["EMAIL_PROVIDER", "sendgrid"],
    ]) {
      const before = process.env[name];
      process.env[name] = value;
      assert.ok(names().includes(name), `${name}=${value}`);
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    }
  });

  test("console and file are for development only: never on Vercel", () => {
    process.env.EMAIL_PROVIDER = "console";
    assert.equal(emailConfig().kind, "console");
    process.env.EMAIL_PROVIDER = "file";
    assert.deepEqual(names(), ["EMAIL_OUTBOX_DIR"]);
    process.env.VERCEL = "1";
    assert.deepEqual(names(), ["SMTP_USER", "SMTP_PASS"], "smtp regardless of EMAIL_PROVIDER");
  });

  test("the email: the code in the subject and the text, no link", () => {
    assert.equal(codeSubject("123456"), "รหัสเข้าสู่ระบบ ORSKH: 123456");
    const text = codeText("123456", "สมชาย ใจดี");
    assert.match(text, /สมชาย ใจดี/);
    assert.match(text, /123456/);
    assert.match(text, /10 นาที/);
    assert.ok(!/https?:/.test(text));
  });

  test("the file transport writes the message (with the code) to EMAIL_OUTBOX_DIR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orskh-outbox-"));
    try {
      Object.assign(process.env, { EMAIL_PROVIDER: "file", EMAIL_OUTBOX_DIR: dir });
      const r = await emailTransport(emailConfig()).sendCode({ to: ["a@example.com", "b@example.com"], code: "654321", name: "x" });
      assert.deepEqual(r, { ok: true, accepted: 2 });
      const files = readdirSync(dir);
      assert.equal(files.length, 1);
      const m = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
      assert.deepEqual([m.to, m.code, m.subject], [["a@example.com", "b@example.com"], "654321", codeSubject("654321")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctors sign in by email (database)", () => {
  let pool: Pool;
  const ids: Record<string, string> = {};
  const args = (userId: string, sub: string, transport: EmailTransport, ip = "203.0.113.9") => ({
    userId,
    sub,
    ip,
    pepper: PEPPER,
    dailyCap: 100,
    transport,
  });
  const signIn = (userId: string, sub: string) => signInByEmail(pool, { userId, sub, lineName: `LINE ${sub}`, ip: "203.0.113.9", userAgent: "test" });
  /** Sends a code and returns it (as the doctor would read it in the email). */
  async function codeFor(userId: string, sub: string): Promise<string> {
    const { sent, transport } = fakeTransport();
    const r = await sendEmailCode(pool, args(userId, sub, transport));
    assert.equal(r.status, "sent");
    return sent[0].code;
  }
  const currentClaim = async (userId: string) =>
    (
      await pool.query(
        "SELECT phone, line_sub, via, email_verified_at IS NOT NULL AS verified FROM user_claims WHERE user_id = $1 AND undone_at IS NULL",
        [userId],
      )
    ).rows[0] ?? null;

  async function load() {
    await pool.query(
      "TRUNCATE cases, user_claims, email_codes, user_emails, users, line_bindings, login_events, access_requests RESTART IDENTITY",
    );
    const { rows } = await pool.query<{ id: string; first_name: string }>(
      `INSERT INTO users (first_name, last_name, type, subtype, active) VALUES
         ('สมชาย', 'ใจดี', 'DR', 'ORTHO', true),
         ('กมล', 'ทองดี', 'DR', 'OBGYN', true),
         ('ไม่มี', 'อีเมล', 'DR', 'ENT', true),
         ('เกษียณ', 'แล้ว', 'DR', 'EYE', false),
         ('ปราณี', 'สายบุญ', 'RN', 'OR', true)
       RETURNING id::text AS id, first_name`,
    );
    for (const r of rows) ids[r.first_name] = r.id;
    await pool.query(
      `INSERT INTO user_emails (user_id, email) VALUES
         ($1, 'somchai.j@example.com'), ($1, 'sj@example.org'), ($2, 'kamon@example.com'), ($3, 'retired@example.com'),
         ($4, 'nurse@example.com')`,
      [ids["สมชาย"], ids["กมล"], ids["เกษียณ"], ids["ปราณี"]],
    );
  }

  before(async () => {
    setTestEnv();
    pool = await db();
  });
  beforeEach(async () => {
    resetAuthzCache();
    await load();
  });
  after(async () => {
    await pool.query(
      "TRUNCATE cases, user_claims, email_codes, user_emails, users, line_bindings, login_events, access_requests RESTART IDENTITY",
    );
    await pool.end();
  });

  test("addresses: lower case and trimmed, one doctor may have several; the list shows names and whether one is on file", async () => {
    for (const bad of ["Upper@Example.com", " pad@example.com", "no-at.example.com", "a@b", "two@@example.com"]) {
      await assert.rejects(pool.query("INSERT INTO user_emails (user_id, email) VALUES ($1, $2)", [ids["กมล"], bad]), bad);
    }
    const list = await listDoctors(pool);
    assert.deepEqual(
      list.map((d) => [d.first_name, d.has_email]),
      [
        ["กมล", true],
        ["ไม่มี", false],
        ["สมชาย", true],
      ],
      "active doctors only, in Thai order",
    );
    for (const d of list) assert.deepEqual(Object.keys(d).sort(), ["first_name", "has_email", "id", "last_name", "subtype"]);
    assert.ok(!JSON.stringify(list).includes("@"));
    assert.deepEqual((await doctorWithEmails(pool, ids["สมชาย"]))?.emails, ["sj@example.org", "somchai.j@example.com"]);
    assert.equal(await doctorWithEmails(pool, ids["เกษียณ"]), null, "inactive");
    assert.equal(await doctorWithEmails(pool, ids["ปราณี"]), null, "not a doctor");
    assert.equal(await doctorWithEmails(pool, "999"), null);
    assert.deepEqual((await doctorWithEmails(pool, ids["ไม่มี"]))?.emails, []);
  });

  test("maskEmail keeps the first letters and the domain", () => {
    assert.equal(maskEmail("somchai.j@example.com"), "so•••@example.com");
    assert.equal(maskEmail("abc@example.com"), "a•••@example.com");
    assert.equal(maskEmail("x@example.com"), "x•••@example.com");
  });

  test("a code goes to every address of the doctor; only an HMAC is stored; the right code works once", async () => {
    const { sent, transport } = fakeTransport();
    const r = await sendEmailCode(pool, args(ids["สมชาย"], "U-a", transport));
    assert.deepEqual(r, { status: "sent", to: ["s•••@example.org", "so•••@example.com"], sentToday: 1 });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["sj@example.org", "somchai.j@example.com"]);
    assert.equal(sent[0].name, "สมชาย ใจดี");
    assert.match(sent[0].code, /^\d{6}$/);
    const row = (await pool.query("SELECT code_hash, expires_at - created_at AS ttl FROM email_codes")).rows[0];
    assert.ok(row.code_hash && !row.code_hash.includes(sent[0].code));
    assert.equal(row.ttl.minutes, 10);
    assert.equal(await hasLiveEmailCode(pool, ids["สมชาย"], "U-a"), true);

    const wrong = sent[0].code === "000000" ? "111111" : "000000";
    assert.deepEqual(await verifyEmailCode(pool, { userId: ids["สมชาย"], sub: "U-a", code: wrong, pepper: PEPPER }), {
      ok: false,
      reason: "invalid",
      remaining: MAX_ATTEMPTS - 1,
    });
    // another LINE account (or another doctor) cannot use it
    assert.equal((await verifyEmailCode(pool, { userId: ids["สมชาย"], sub: "U-b", code: sent[0].code, pepper: PEPPER })).ok, false);
    assert.equal((await verifyEmailCode(pool, { userId: ids["กมล"], sub: "U-a", code: sent[0].code, pepper: PEPPER })).ok, false);
    assert.deepEqual(await verifyEmailCode(pool, { userId: ids["สมชาย"], sub: "U-a", code: sent[0].code, pepper: PEPPER }), { ok: true });
    assert.deepEqual(await verifyEmailCode(pool, { userId: ids["สมชาย"], sub: "U-a", code: sent[0].code, pepper: PEPPER }), {
      ok: false,
      reason: "expired",
    });
  });

  test("wrong guesses lock the code; a new code makes older ones useless", async () => {
    const first = await codeFor(ids["กมล"], "U-g");
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const r = await verifyEmailCode(pool, { userId: ids["กมล"], sub: "U-g", code: "99999x", pepper: PEPPER });
      assert.equal(r.ok, false);
    }
    const wrong = first === "999999" ? "888888" : "999999";
    assert.deepEqual(await verifyEmailCode(pool, { userId: ids["กมล"], sub: "U-g", code: wrong, pepper: PEPPER }), {
      ok: false,
      reason: "locked",
    });
    assert.deepEqual(await verifyEmailCode(pool, { userId: ids["กมล"], sub: "U-g", code: first, pepper: PEPPER }), { ok: false, reason: "locked" });

    await pool.query("UPDATE email_codes SET created_at = created_at - interval '2 minutes'");
    const second = await codeFor(ids["กมล"], "U-g");
    await pool.query("UPDATE email_codes SET created_at = created_at - interval '2 minutes'");
    const third = await codeFor(ids["กมล"], "U-g");
    if (second !== third) {
      assert.equal((await verifyEmailCode(pool, { userId: ids["กมล"], sub: "U-g", code: second, pepper: PEPPER })).ok, false);
    }
    assert.deepEqual(await verifyEmailCode(pool, { userId: ids["กมล"], sub: "U-g", code: third, pepper: PEPPER }), { ok: true });
  });

  test("refused before sending: not a doctor, inactive, no address; a failed send removes its reservation", async () => {
    const { sent, transport } = fakeTransport();
    assert.deepEqual(await sendEmailCode(pool, args(ids["ปราณี"], "U-x", transport)), { status: "unavailable" });
    assert.deepEqual(await sendEmailCode(pool, args(ids["เกษียณ"], "U-x", transport)), { status: "unavailable" });
    assert.deepEqual(await sendEmailCode(pool, args(ids["ไม่มี"], "U-x", transport)), { status: "no_email" });
    assert.equal(sent.length, 0);
    for (const reason of ["misconfigured", "rejected", "failed"] as const) {
      const r = await sendEmailCode(pool, args(ids["กมล"], "U-x", fakeTransport(reason).transport));
      assert.deepEqual(r, { status: "failed", reason });
    }
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM email_codes")).rows[0].n, 0);
  });

  test("limits: a minute between codes, 3 codes per doctor per 15 minutes, 3 doctors per LINE account a day, and the daily cap", async () => {
    const { transport } = fakeTransport();
    const age = (s: string) => pool.query(`UPDATE email_codes SET created_at = created_at - interval '${s}'`);
    assert.equal((await sendEmailCode(pool, args(ids["สมชาย"], "U-l", transport))).status, "sent");
    const again = await sendEmailCode(pool, args(ids["สมชาย"], "U-l", transport));
    assert.ok(again.status === "limited" && again.reason === "cooldown" && again.retryAfterS <= EMAIL_LIMITS.cooldownS);
    await age("61 seconds");
    assert.equal((await sendEmailCode(pool, args(ids["สมชาย"], "U-l", transport))).status, "sent");
    // others asking for the same doctor count too
    assert.equal((await sendEmailCode(pool, args(ids["สมชาย"], "U-other", transport))).status, "sent");
    const user = await sendEmailCode(pool, args(ids["สมชาย"], "U-third", transport));
    assert.ok(user.status === "limited" && user.reason === "user");

    await age("16 minutes");
    assert.equal((await sendEmailCode(pool, args(ids["กมล"], "U-l", transport))).status, "sent");
    // a third doctor is the limit for one LINE account (it asked for สมชาย and กมล already)
    await pool.query("INSERT INTO user_emails (user_id, email) VALUES ($1, 'noemail.now@example.com')", [ids["ไม่มี"]]);
    assert.equal((await sendEmailCode(pool, args(ids["ไม่มี"], "U-l", transport))).status, "sent");
    await pool.query("UPDATE users SET active = true WHERE id = $1", [ids["เกษียณ"]]);
    const many = await sendEmailCode(pool, args(ids["เกษียณ"], "U-l", transport));
    assert.ok(many.status === "limited" && many.reason === "sub_users", JSON.stringify(many));

    const capped = await sendEmailCode(pool, { ...args(ids["เกษียณ"], "U-cap", transport), dailyCap: 5 });
    assert.equal(capped.status, "capped");
  });

  test("a good code makes this LINE account the holder of the name (via email, no number); next time LINE alone", async () => {
    assert.equal(await isAuthorizedDoctor(ids["สมชาย"], "U-a"), false);
    const r = await signIn(ids["สมชาย"], "U-a");
    assert.ok(r.status === "signed_in" && r.created && r.replaced === null);
    assert.deepEqual(await currentClaim(ids["สมชาย"]), { phone: null, line_sub: "U-a", via: "email", verified: true });
    resetAuthzCache();
    assert.equal(await isAuthorizedDoctor(ids["สมชาย"], "U-a"), true);
    assert.equal(await isAuthorizedDoctor(ids["สมชาย"], "U-b"), false, "another LINE account");
    assert.equal(await isAuthorizedDoctor(ids["กมล"], "U-a"), false, "another doctor");
    assert.equal(await freshEmailClaim(pool, "U-a"), ids["สมชาย"]);
    await pool.query("UPDATE user_claims SET email_verified_at = now() - interval '181 days'");
    assert.equal(await freshEmailClaim(pool, "U-a"), null, "after 180 days the code is asked again");

    // again from the same account: the same claim, newer proof
    const again = await signIn(ids["สมชาย"], "U-a");
    assert.ok(again.status === "signed_in" && !again.created);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM user_claims")).rows[0].n, 1);
    assert.equal(await freshEmailClaim(pool, "U-a"), ids["สมชาย"]);
    const ev = await pool.query("SELECT event, phone FROM login_events ORDER BY id");
    assert.deepEqual(ev.rows, [
      { event: "login_email", phone: null },
      { event: "login_email", phone: null },
    ]);
  });

  test("the name proven from another LINE account (or held by a number) moves there: the old holder is signed out", async () => {
    await signIn(ids["สมชาย"], "U-old");
    const moved = await signIn(ids["สมชาย"], "U-new");
    assert.ok(moved.status === "signed_in" && moved.created);
    assert.deepEqual(moved.replaced, { phone: null, lineSub: "U-old", lineName: "LINE U-old" });
    resetAuthzCache();
    assert.equal(await isAuthorizedDoctor(ids["สมชาย"], "U-old"), false);
    assert.equal(await isAuthorizedDoctor(ids["สมชาย"], "U-new"), true);
    const old = await pool.query("SELECT undo_reason FROM user_claims WHERE line_sub = 'U-old'");
    assert.deepEqual(old.rows, [{ undo_reason: "replaced" }]);

    // a doctor registered by number before the switch: the number keeps working until the doctor uses email
    await pool.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0900000301', 'U-phone')", [ids["กมล"]]);
    await upsertBinding(pool, "U-phone", "0900000301", "x");
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000301"), true);
    const r = await signIn(ids["กมล"], "U-phone");
    assert.ok(r.status === "signed_in" && r.replaced?.phone === "0900000301");
    assert.deepEqual(await currentClaim(ids["กมล"]), { phone: null, line_sub: "U-phone", via: "email", verified: true });
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000301"), false, "the number no longer holds the name");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM line_bindings")).rows[0].n, 0, "its LINE binding is gone");
  });

  test("a LINE account holding another active name is refused; one holding an inactive name moves on", async () => {
    await pool.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0900000302', 'U-nurse')", [ids["ปราณี"]]);
    assert.deepEqual(await signIn(ids["สมชาย"], "U-nurse"), { status: "line_has_claim" });
    assert.equal(await currentClaim(ids["สมชาย"]), null);
    await pool.query("UPDATE users SET active = false WHERE id = $1", [ids["ปราณี"]]);
    assert.equal((await signIn(ids["สมชาย"], "U-nurse")).status, "signed_in");
    assert.deepEqual((await pool.query("SELECT undo_reason FROM user_claims WHERE user_id = $1", [ids["ปราณี"]])).rows, [
      { undo_reason: "inactive" },
    ]);
    assert.deepEqual(await signIn(ids["เกษียณ"], "U-z"), { status: "unavailable" });
    assert.deepEqual(await signIn(ids["ปราณี"], "U-z"), { status: "unavailable" }, "not a doctor");
  });

  test("doctors no longer claim by number; one who did before keeps it", async () => {
    const claim = (userId: string, phone: string, sub: string) =>
      claimUser(pool, { userId, phone, sub, lineName: "x", ip: "203.0.113.9", userAgent: "test" });
    assert.equal((await claim(ids["สมชาย"], "0900000303", "U-c")).status, "unavailable");
    await pool.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0900000304', 'U-d')", [ids["กมล"]]);
    assert.equal((await claim(ids["กมล"], "0900000304", "U-d")).status, "own_claim");
    // the constraint: an email claim holds no number and is verified; a number claim holds a number
    await assert.rejects(
      pool.query("INSERT INTO user_claims (user_id, phone, line_sub, via) VALUES ($1, '0900000305', 'U-e', 'email')", [ids["สมชาย"]]),
      (e: { constraint?: string }) => e.constraint === "user_claims_via_check",
    );
    await assert.rejects(
      pool.query("INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, NULL, 'U-e')", [ids["สมชาย"]]),
      (e: { constraint?: string }) => e.constraint === "user_claims_via_check",
    );
  });

  test("the session of a doctor signed in by email: board name and role, the add-case form, and sign-out when the name moves", async () => {
    await signIn(ids["สมชาย"], "U-s");
    const token = await signSession({ sub: "U-s", phone: null, userId: ids["สมชาย"], name: "LINE", picture: null }, SECRET);
    const user = await userFromToken(token);
    assert.ok(user);
    assert.deepEqual(await profileFor(user, "LINE"), { name: "สมชาย ใจดี", role: "แพทย์ · ออร์โธปิดิกส์" });
    assert.equal((await doctorFor(pool, user))?.id, ids["สมชาย"]);
    // a forged session for another doctor (this LINE account does not hold it) is no session
    const other = await signSession({ sub: "U-s", phone: null, userId: ids["กมล"], name: "LINE", picture: null }, SECRET);
    assert.equal(await userFromToken(other), null);
    assert.deepEqual(await profileFor({ sub: "U-s", phone: null, userId: ids["กมล"] }, "LINE"), { name: "LINE", role: null });

    await signIn(ids["สมชาย"], "U-elsewhere");
    resetAuthzCache();
    assert.equal(await userFromToken(token), null, "signed out once the name was proven from another LINE account");
    assert.equal(await doctorFor(pool, user), null);
  });

  test("Telegram texts: the email sign-in notice, and a claim message without a number", async () => {
    const user = (await getListedUser(pool, ids["สมชาย"]))!;
    const at = new Date("2026-11-14T02:00:00Z");
    const html = buildEmailSignInMessage(user, { lineName: "<b>x</b>", at, replaced: null });
    assert.match(html, /📧 แพทย์ยืนยันตัวตนทางอีเมล: สมชาย ใจดี \(แพทย์ · ออร์โธปิดิกส์\)/);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.ok(!html.includes("แทนการยืนยันเดิม"));
    const moved = buildEmailSignInMessage(user, { lineName: "x", at, replaced: { phone: "0900000301", lineName: "old" } });
    assert.match(moved, /แทนการยืนยันเดิม \(เบอร์ 090-000-0301 · LINE: old\)/);
    assert.match(buildClaimMessage(user, { phone: null, lineName: "x", createdAt: at }), /ยืนยันทางอีเมล · LINE: x/);
  });

  describe("endpoints", () => {
    let outbox = "";
    const saved: Record<string, string | undefined> = {};
    before(() => {
      outbox = mkdtempSync(join(tmpdir(), "orskh-outbox-"));
      for (const n of ["EMAIL_PROVIDER", "EMAIL_OUTBOX_DIR"]) saved[n] = process.env[n];
      Object.assign(process.env, { EMAIL_PROVIDER: "file", EMAIL_OUTBOX_DIR: outbox });
    });
    after(() => {
      rmSync(outbox, { recursive: true, force: true });
      for (const n of Object.keys(saved)) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    });
    const post = (route: typeof sendRoute, path: string, body: unknown, cookie?: string) =>
      route(
        new NextRequest(`http://localhost:3999${path}`, {
          method: "POST",
          headers: { origin: "http://localhost:3999", "content-type": "application/json", ...(cookie ? { cookie } : {}) },
          body: JSON.stringify(body),
        }),
      );
    const lastCode = () => {
      const files = readdirSync(outbox).sort();
      return JSON.parse(readFileSync(join(outbox, files[files.length - 1]), "utf8")).code as string;
    };

    test("send needs the LINE sign-in (pending or access cookie) and answers masked addresses only", async () => {
      assert.equal((await post(sendRoute, "/api/auth/email/send", { userId: ids["สมชาย"] })).status, 401);
      const pending = `pending=${await signPending({ sub: "U-r", name: "x", picture: null, next: "/?room=or-2" }, SECRET)}`;
      const bad = await post(sendRoute, "/api/auth/email/send", { userId: "1; DROP" }, pending);
      assert.equal(bad.status, 400);
      const none = await post(sendRoute, "/api/auth/email/send", { userId: ids["ไม่มี"] }, pending);
      assert.deepEqual([none.status, (await none.json()).error], [400, MSG.emailNone]);
      const ok = await post(sendRoute, "/api/auth/email/send", { userId: Number(ids["สมชาย"]) }, pending);
      assert.equal(ok.status, 200);
      const text = await ok.text();
      assert.ok(!text.includes("somchai.j@example.com") && !text.includes("sj@example.org"), text);
      assert.deepEqual(JSON.parse(text), { ok: true, to: ["s•••@example.org", "so•••@example.com"], cooldown: EMAIL_LIMITS.cooldownS });
      const limited = await post(sendRoute, "/api/auth/email/send", { userId: ids["สมชาย"] }, pending);
      assert.equal(limited.status, 429);
      assert.equal((await limited.json()).codePending, true);

      // verify: a wrong code, then (with a claim already held) the right one signs in with the user id in the session
      const wrong = await post(verifyRoute, "/api/auth/email/verify", { userId: ids["สมชาย"], code: "12345" }, pending);
      assert.equal(wrong.status, 400);
      await signIn(ids["สมชาย"], "U-r"); // so the route below makes no new claim (no Telegram notice)
      const good = await post(verifyRoute, "/api/auth/email/verify", { userId: ids["สมชาย"], code: lastCode() }, pending);
      assert.equal(good.status, 200);
      assert.deepEqual(await good.json(), { ok: true, redirect: "/?room=or-2" });
      const cookies = good.headers.getSetCookie();
      const session = cookies.find((c) => c.startsWith("session="))!.split(";")[0].slice("session=".length);
      assert.deepEqual(await verifySession(session, SECRET), { sub: "U-r", phone: null, userId: ids["สมชาย"], name: "x", picture: null });
      assert.ok(cookies.some((c) => c.startsWith("pending=;")), "the pending cookie is cleared");
    });
  });
});
