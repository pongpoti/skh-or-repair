import "./_setup";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { isAuthorizedPhone, resetAuthzCache } from "@/lib/authz";
import { db } from "@/lib/db";
import { upsertBinding } from "@/lib/otp";
import { claimBlocked, claimUser, getClaim, saveClaimTelegramRefs, type UserClaim, type ListedUser } from "@/lib/user-list";
import {
  announceClaim,
  buildClaimMessage,
  CLAIM_RETRY_MS,
  buildClaimUndoneMessage,
  claimCallbackData,
  claimKeyboard,
  parseClaimCallbackData,
  sendClaimMessages,
  ensureWebhook,
  resetWebhookMemo,
  TELEGRAM_WEBHOOK_PATH,
  webhookSecret,
  webhookUrl,
} from "@/lib/telegram";
import { ANSWERS, handleTelegramWebhook } from "@/lib/telegram-webhook";
import { setTestEnv, TEST_SESSION_SECRET } from "./_setup";

const TOKEN = "123456789:AAtestTOKENtestTOKENtestTOKEN_x-y";
const ADMIN = 111;
const ADMIN_2 = 222;
const GROUP = "-1001234567890";

describe("Telegram claim message", () => {
  const user: ListedUser = { id: "9", firstName: "สมชาย", lastName: "ใจดี", type: "DR", subtype: "ORTHO" };
  const claim = { phone: "0812345678", lineName: "Som", createdAt: new Date("2026-10-25T09:30:00Z") };

  test("exact layout: name with type and subtype, the whole number and the LINE name, Bangkok time", () => {
    assert.equal(
      buildClaimMessage(user, claim),
      ["🪪 ยืนยันชื่อ: สมชาย ใจดี (แพทย์ · ออร์โธปิดิกส์)", "เบอร์ 081-234-5678 · LINE: Som", "เวลา 25 ต.ค. 2569 16:30 น."].join("\n"),
    );
    assert.match(buildClaimMessage({ ...user, type: "PCA", subtype: null }, claim), /^🪪 ยืนยันชื่อ: สมชาย ใจดี \(พนักงานช่วยเหลือคนไข้\)\n/);
    assert.match(buildClaimMessage({ ...user, type: "RN", subtype: "ANES" }, claim), /\(พยาบาล · วิสัญญี\)/);
    assert.match(buildClaimMessage(user, { ...claim, lineName: null }), /· LINE: ไม่ระบุ\n/);
  });

  test("the LINE name and the tapper's name cannot inject markup or lines", () => {
    const html = buildClaimMessage(user, { ...claim, lineName: '<a href="https://evil.test">x</a>\nเบอร์ 099-999-9999\u202E' });
    const lines = html.split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[1].startsWith("เบอร์ 081-234-5678 · LINE: &lt;a href=") && !html.includes("<a") && !html.includes("\u202E"), lines[1]);
    const undone = buildClaimUndoneMessage(user, claim, "<b>Admin</b>\n🪪 fake", new Date("2026-10-25T10:05:00Z"));
    assert.equal(
      undone,
      `${buildClaimMessage(user, claim)}\n\n↩️ ยกเลิกแล้ว โดย &lt;b&gt;Admin&lt;/b&gt; 🪪 fake เวลา 25 ต.ค. 2569 17:05 น.`,
    );
  });

  test("one undo button; callback_data oc:<claim id>:u, parsed strictly (the former request buttons ox: are not claims)", () => {
    assert.deepEqual(claimKeyboard("42"), { inline_keyboard: [[{ text: "↩️ ยกเลิกการยืนยัน", callback_data: "oc:42:u" }]] });
    const max = claimCallbackData("999999999999999");
    assert.ok(Buffer.byteLength(max) <= 64);
    assert.deepEqual(parseClaimCallbackData(max), { claimId: "999999999999999" });
    assert.deepEqual(parseClaimCallbackData("oc:7:u"), { claimId: "7" });
    for (const bad of ["", "oc:7", "oc:7:a", "oc:0:u", "oc:07:u", "oc:-7:u", "oc:7:u ", " oc:7:u", "ox:7:u", "oc:1234567890123456:u", "oc:7:u:x", null, 7]) {
      assert.equal(parseClaimCallbackData(bad), null, JSON.stringify(bad));
    }
    assert.equal(parseClaimCallbackData("ox:7:a"), null);
    assert.equal(parseClaimCallbackData("ox:7:r"), null);
  });
});

describe("webhook secret", () => {
  test("derived from the bot token and SESSION_SECRET; URL-safe; changes with either", () => {
    const s = webhookSecret(TOKEN, TEST_SESSION_SECRET);
    assert.match(s, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(s, webhookSecret(TOKEN, TEST_SESSION_SECRET));
    assert.notEqual(s, webhookSecret(`${TOKEN}x`, TEST_SESSION_SECRET));
    assert.notEqual(s, webhookSecret(TOKEN, `${TEST_SESSION_SECRET}x`));
    assert.ok(!s.includes(TOKEN.split(":")[1].slice(0, 8)));
    const url = webhookUrl("https://orskh.vercel.app", s);
    assert.match(url, /^https:\/\/orskh\.vercel\.app\/api\/telegram\/webhook\?v=[0-9a-f]{12}$/);
    assert.ok(!url.includes(s), "the URL never carries the secret itself");
    assert.notEqual(url, webhookUrl("https://orskh.vercel.app", `${s}x`));
  });
});

describe("Telegram webhook and Bot API (mock)", () => {
  let server: Server;
  let base = "";
  const calls: { method: string; token: string; body: Record<string, unknown> }[] = [];
  const failing = new Set<string>();
  let webhook = { url: "", allowed_updates: [] as string[] };
  let nextMessageId = 100;
  let cb = 0;

  before(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "");
        const body = JSON.parse(data || "{}");
        const method = m?.[2] ?? "";
        calls.push({ method, token: m?.[1] ?? "", body });
        const reply = (status: number, payload: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        };
        if (failing.has(method)) return reply(400, { ok: false, description: "Bad Request: message to edit not found" });
        if (method === "sendMessage") return reply(200, { ok: true, result: { message_id: nextMessageId++ } });
        if (method === "getWebhookInfo") return reply(200, { ok: true, result: { ...webhook, pending_update_count: 0 } });
        if (method === "setWebhook") {
          webhook = { url: body.url, allowed_updates: body.allowed_updates };
          return reply(200, { ok: true, result: true });
        }
        return reply(200, { ok: true, result: true });
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    configure();
    await (await db()).query("TRUNCATE access_requests, login_events RESTART IDENTITY");
  });
  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await (await db()).end();
  });
  beforeEach(() => {
    setTestEnv();
    configure();
    calls.length = 0;
    failing.clear();
    resetWebhookMemo();
  });

  function configure() {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_CHAT_ID = `${ADMIN}, ${ADMIN_2}, ${GROUP}`;
    process.env.TELEGRAM_API_URL = base;
  }

  const secret = () => webhookSecret(TOKEN, TEST_SESSION_SECRET);

  function tap(data: unknown, from: unknown = ADMIN, message: unknown = undefined) {
    return {
      update_id: ++cb,
      callback_query: {
        id: `cbq-${cb}`,
        from: { id: from, is_bot: false, first_name: "Admin" },
        chat_instance: "1",
        data,
        ...(message === undefined ? {} : { message }),
      },
    };
  }

  /** Runs the handler like the route does, then the deferred work (after the response). */
  async function post(update: unknown, header: string | null = secret()) {
    const tasks: (() => Promise<void>)[] = [];
    let read = false;
    const headers = new Headers({ "content-type": "application/json" });
    if (header !== null) headers.set("x-telegram-bot-api-secret-token", header);
    const reply = await handleTelegramWebhook(
      headers,
      async () => {
        read = true;
        return update as Record<string, unknown> | null;
      },
      (t) => void tasks.push(t),
    );
    for (const t of tasks) await t();
    return { ...reply, read };
  }

  const answers = () => calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text);

  /** A fresh users list and one claimed name (see newClaim() below). */
  async function freshClaim(phone: string, sub: string, first: string) {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    return newClaim(phone, sub, first);
  }
  const current = async (id: string) => (await getClaim(await db(), id))?.undoneAt === null;

  test("wrong or missing secret: 401, body not read, nothing changes (the webhook is registered again once)", async () => {
    const { claim } = await freshClaim("0900000011", "U-s1", "ลับ");
    webhook = { url: "", allowed_updates: [] };
    calls.length = 0;
    for (const header of [null, "", "wrong", `${secret()}x`, secret().slice(1)]) {
      const res = await post(tap(claimCallbackData(claim.id)), header);
      assert.equal(res.status, 401, String(header));
      assert.deepEqual(res.body, { ok: false });
      assert.equal(res.read, false, "the update is not even read");
    }
    assert.deepEqual(
      calls.map((c) => c.method),
      ["getWebhookInfo", "setWebhook"],
      "only a re-registration (at most once a minute), no answer, edit or message",
    );
    assert.equal(calls[1].body.secret_token, secret());
    assert.equal(await current(claim.id), true, "the claim stands");
    // registered on this instance: later refused calls cost nothing, even after the minute
    resetWebhookMemo();
    await ensureWebhook();
    calls.length = 0;
    await post(tap(claimCallbackData(claim.id)), "wrong");
    assert.deepEqual(calls.map((c) => c.method), [], "memoized");
    // Telegram not configured: nothing to authenticate against
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal((await post(tap(claimCallbackData(claim.id)))).status, 404);
  });

  test("malformed or other updates: 200 and ignored", async () => {
    for (const update of [
      null,
      {},
      { update_id: 1, message: { text: "/start" } },
      { update_id: 2, callback_query: "x" },
      { update_id: 3, callback_query: { from: { id: ADMIN }, data: "ox:1:a" } },
      { update_id: 4, callback_query: { id: "", from: { id: ADMIN }, data: "ox:1:a" } },
    ]) {
      const res = await post(update);
      assert.equal(res.status, 200, JSON.stringify(update));
      assert.deepEqual(res.body, { ok: true });
    }
    assert.equal(calls.length, 0);
    const bad = await post(tap("drop table", ADMIN));
    assert.equal(bad.status, 200);
    assert.deepEqual(answers(), [ANSWERS.invalid]);
  });

  test("a tap on skh-or-schedule's buttons (same bot, same numbering) is refused and nothing is edited", async () => {
    const tapped = { message_id: 501, chat: { id: ADMIN, type: "private" }, date: 0, text: "skh request" };
    for (const data of ["ar:7:a", "ar:7:r"]) {
      const res = await post(tap(data, ADMIN, tapped));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
    }
    assert.deepEqual(answers(), [ANSWERS.invalid, ANSWERS.invalid]);
    assert.equal(calls.filter((c) => c.method !== "answerCallbackQuery").length, 0, "the other app's message is not edited");
  });

  test("the approve and reject buttons of the former access requests do nothing: invalid, the row unchanged, nobody authorized", async () => {
    const pool = await db();
    await pool.query("TRUNCATE access_requests RESTART IDENTITY");
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO access_requests (phone, line_sub, line_name, first_name, last_name, position, tg_messages)
       VALUES ('0900000014', 'U1', 'Som', 'พิมพ์', 'เอง', 'RN', '[{"chat_id":"111","message_id":77}]') RETURNING id::text AS id`,
    );
    const id = rows[0].id;
    resetAuthzCache();
    const tapped = { message_id: 77, chat: { id: ADMIN, type: "private" }, date: 0, text: "…" };
    for (const data of [`ox:${id}:a`, `ox:${id}:r`]) {
      const res = await post(tap(data, ADMIN, tapped));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: true });
    }
    assert.deepEqual(answers(), [ANSWERS.invalid, ANSWERS.invalid]);
    assert.equal(calls.filter((c) => c.method !== "answerCallbackQuery").length, 0, "no edit");
    const row = await pool.query("SELECT status, decided_at FROM access_requests WHERE id = $1", [id]);
    assert.deepEqual(row.rows, [{ status: "pending", decided_at: null }]);
    assert.equal(await isAuthorizedPhone("0900000014"), false);
    assert.equal(await isAuthorizedPhone("0900000014", { fresh: true }), false);
    // an approved one from before authorizes nothing either
    await pool.query("UPDATE access_requests SET status = 'approved', decided_at = now(), decided_by = 111 WHERE id = $1", [id]);
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000014"), false);
    const ev = await pool.query("SELECT count(*)::int AS n FROM login_events WHERE event IN ('access_approved', 'access_rejected')");
    assert.equal(ev.rows[0].n, 0);
  });

  test("Telegram errors during an undo are logged without the token and never thrown; the undo stands", async () => {
    const { claim } = await freshClaim("0900000016", "U-e1", "ผิดพลาด");
    await saveClaimTelegramRefs(await db(), claim.id, [{ chat_id: String(ADMIN), message_id: 5 }]);
    failing.add("editMessageText");
    failing.add("answerCallbackQuery");
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
    try {
      const res = await post(tap(claimCallbackData(claim.id)));
      assert.equal(res.status, 200);
    } finally {
      console.error = orig;
    }
    assert.equal(await current(claim.id), false, "the undo stands");
    assert.equal(logged.length, 2, logged.join(" | "));
    for (const l of logged) assert.ok(!l.includes(TOKEN) && /HTTP 400/.test(l), l);
  });

  test("after a secret rotation the first refused tap registers the new secret, and Telegram's retry undoes", async () => {
    const { claim } = await freshClaim("0900000017", "U-r1", "หมุนเวียน");
    webhook = { url: "", allowed_updates: [] };
    await ensureWebhook(); // registered before the rotation
    const old = secret();
    process.env.SESSION_SECRET = `${TEST_SESSION_SECRET}-rotated`; // redeployed with a new SESSION_SECRET
    const rotated = webhookSecret(TOKEN, process.env.SESSION_SECRET);
    calls.length = 0;
    const refused = await post(tap(claimCallbackData(claim.id)), old);
    assert.equal(refused.status, 401);
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
    assert.equal(calls[1].body.secret_token, rotated);
    assert.equal(calls[1].body.url, webhookUrl("http://localhost:3999", rotated));
    assert.equal(await current(claim.id), true);
    calls.length = 0;
    await post(tap(claimCallbackData(claim.id)), old);
    assert.equal(calls.length, 0, "no more Bot API calls for refused calls");
    const retried = await post(tap(claimCallbackData(claim.id)), rotated);
    assert.equal(retried.status, 200);
    assert.equal(await current(claim.id), false);
  });

  test("ensureWebhook: registers once per instance; again when the secret changes", async () => {
    resetWebhookMemo();
    webhook = { url: "", allowed_updates: [] };
    assert.equal(await ensureWebhook(), true);
    const set = calls.filter((c) => c.method === "setWebhook");
    assert.equal(set.length, 1);
    assert.equal(set[0].body.url, webhookUrl("http://localhost:3999", secret()));
    assert.ok(String(set[0].body.url).startsWith(`http://localhost:3999${TELEGRAM_WEBHOOK_PATH}?v=`));
    assert.equal(set[0].body.secret_token, secret());
    assert.deepEqual(set[0].body.allowed_updates, ["callback_query"]);

    calls.length = 0;
    assert.equal(await ensureWebhook(), true);
    assert.equal(calls.length, 0, "memoized");

    resetWebhookMemo();
    assert.equal(await ensureWebhook(), true);
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo"], "already ours: no setWebhook");

    calls.length = 0;
    process.env.SESSION_SECRET = `${TEST_SESSION_SECRET}-rotated`;
    assert.equal(await ensureWebhook(), true);
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
    assert.notEqual(calls[1].body.secret_token, secret());

    // someone else's webhook (or the old one without our allowed_updates) is replaced
    resetWebhookMemo();
    calls.length = 0;
    webhook = { ...webhook, allowed_updates: ["message", "callback_query"] };
    await ensureWebhook();
    assert.deepEqual(calls.map((c) => c.method), ["getWebhookInfo", "setWebhook"]);
  });

  test("ensureWebhook: real Telegram (no override) needs https; http is refused without any call", async () => {
    resetWebhookMemo();
    delete process.env.TELEGRAM_API_URL;
    await assert.rejects(ensureWebhook(), /https APP_URL/);
    process.env.TELEGRAM_API_URL = base;
    process.env.VERCEL = "1";
    await assert.rejects(ensureWebhook(), /https APP_URL/);
    assert.equal(calls.length, 0);
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(await ensureWebhook(), false, "off when Telegram is not configured");
  });

  async function newClaim(phone: string, sub: string, first: string): Promise<{ claim: UserClaim; user: ListedUser }> {
    const pool = await db();
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO users (first_name, last_name, type, subtype) VALUES ($1, 'ทดสอบ', 'RN', 'OR') RETURNING id::text AS id",
      [first],
    );
    const r = await claimUser(pool, { userId: rows[0].id, phone, sub, lineName: "Som", ip: "203.0.113.5", userAgent: "t" });
    assert.ok(r.status === "claimed");
    return r;
  }

  test("claim messages go to every chat with the undo button", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { claim, user } = await newClaim("0900000031", "U-c1", "ส่งข้อความ");
    const sent = await sendClaimMessages(user, claim);
    assert.equal(sent.length, 3);
    for (const m of calls.filter((c) => c.method === "sendMessage")) {
      assert.equal(m.body.text, buildClaimMessage(user, claim));
      assert.equal(m.body.parse_mode, "HTML");
      assert.deepEqual(m.body.reply_markup, claimKeyboard(claim.id));
    }
    await saveClaimTelegramRefs(await db(), claim.id, sent);
    assert.deepEqual((await getClaim(await db(), claim.id))?.tgMessages, sent);
  });

  test("to groups or channels only (nobody may undo): the claim is a notice, without a button nobody could press", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    process.env.TELEGRAM_CHAT_ID = `${GROUP}, @orskh_test`;
    const { claim, user } = await newClaim("0900000036", "U-c6", "กลุ่ม");
    const sent = await sendClaimMessages(user, claim);
    const msgs = calls.filter((c) => c.method === "sendMessage");
    assert.equal(sent.length, 2);
    assert.deepEqual(
      msgs.map((m) => [m.body.chat_id, m.body.text, "reply_markup" in m.body]),
      [
        [GROUP, buildClaimMessage(user, claim), false],
        ["@orskh_test", buildClaimMessage(user, claim), false],
      ],
    );
  });

  test("undo by someone not in TELEGRAM_CHAT_ID: refused, the claim stands", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { claim } = await newClaim("0900000032", "U-c2", "คนแปลก");
    for (const from of [333, Number(GROUP), "111", null]) {
      assert.equal((await post(tap(claimCallbackData(claim.id), from))).status, 200);
    }
    assert.deepEqual(answers(), Array(4).fill(ANSWERS.notAdmin));
    assert.equal(calls.filter((c) => c.method !== "answerCallbackQuery").length, 0, "no edit");
    assert.equal((await getClaim(await db(), claim.id))?.undoneAt, null);
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000032"), true);
  });

  test("undo: the name is freed, the binding deleted, this instance's cache drops the number, each message says who undid it", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { claim, user } = await newClaim("0900000033", "U-c3", "ยกเลิก");
    const usersBefore = (await (await db()).query("SELECT * FROM users ORDER BY id")).rows;
    await upsertBinding(await db(), "U-c3", "0900000033", "Som");
    await saveClaimTelegramRefs(await db(), claim.id, [
      { chat_id: String(ADMIN), message_id: 301 },
      { chat_id: String(ADMIN_2), message_id: 302 },
    ]);
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000033"), true, "in this instance's cached list");
    const tapped = { message_id: 302, chat: { id: ADMIN_2, type: "private" }, date: 0 };
    const update = tap(claimCallbackData(claim.id), ADMIN_2, tapped);
    (update.callback_query.from as Record<string, unknown>).last_name = "Ops";
    const res = await post(update);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const pool = await db();
    const row = await getClaim(pool, claim.id);
    assert.equal(row?.undoneBy, String(ADMIN_2));
    assert.equal(row?.undoReason, "admin");
    assert.ok(row?.undoneAt instanceof Date);
    const s = await pool.query("SELECT count(*)::int AS n FROM user_claims WHERE user_id = $1 AND undone_at IS NULL", [user.id]);
    assert.equal(s.rows[0].n, 0, "the name is free again");
    assert.deepEqual(usersBefore, (await pool.query("SELECT * FROM users ORDER BY id")).rows, "users is never written");
    assert.equal((await pool.query("SELECT 1 FROM line_bindings WHERE phone = '0900000033'")).rowCount, 0, "binding deleted");
    assert.equal(await isAuthorizedPhone("0900000033"), false, "this instance refuses the session at once");
    assert.equal(await claimBlocked(pool, "0900000033", "U-other"), "phone", "no new claim for 24 h");
    assert.deepEqual(answers(), [ANSWERS.claimUndone]);
    const edits = calls.filter((c) => c.method === "editMessageText");
    assert.deepEqual(
      edits.map((e) => [e.body.chat_id, e.body.message_id]),
      [
        [String(ADMIN), 301],
        [String(ADMIN_2), 302],
      ],
    );
    for (const e of edits) {
      assert.equal(e.body.reply_markup, undefined, "button removed");
      assert.ok(String(e.body.text).startsWith(`${buildClaimMessage(user, claim)}\n\n↩️ ยกเลิกแล้ว โดย Admin Ops เวลา `), String(e.body.text));
    }
    const ev = await pool.query("SELECT line_sub FROM login_events WHERE event = 'claim_undone' AND phone = '0900000033'");
    assert.deepEqual(ev.rows, [{ line_sub: "U-c3" }]);

    // later taps: nothing changes
    calls.length = 0;
    await post(tap(claimCallbackData(claim.id), ADMIN));
    assert.deepEqual(answers(), [ANSWERS.claimAlready]);
    assert.equal(ANSWERS.claimAlready, "ดำเนินการไปแล้ว");
    assert.equal(calls.length, 1, "no edit");
  });

  test("undo of an ended claim (released by hand, the name claimed again) and of an unknown claim change nothing", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const pool = await db();
    const first = await newClaim("0900000034", "U-c4", "เก่า");
    await pool.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = $1", [first.claim.id]);
    const second = await claimUser(pool, { userId: first.user.id, phone: "0900000035", sub: "U-c5", lineName: "x", ip: "", userAgent: "" });
    assert.ok(second.status === "claimed");
    await post(tap(claimCallbackData(first.claim.id), ADMIN));
    assert.deepEqual(answers(), [ANSWERS.claimAlready]);
    assert.equal((await getClaim(pool, first.claim.id))?.undoReason, "manual", "not turned into an admin undo (no 24 h block)");
    assert.equal(await claimBlocked(pool, "0900000034", "U-c4"), null);
    const cur = await pool.query("SELECT phone FROM user_claims WHERE user_id = $1 AND undone_at IS NULL", [first.user.id]);
    assert.equal(cur.rows[0].phone, "0900000035", "the newer claim stands");
    calls.length = 0;
    await post(tap(claimCallbackData("987654"), ADMIN));
    assert.deepEqual(answers(), [ANSWERS.claimMissing]);
    assert.equal(calls.filter((c) => c.method === "editMessageText").length, 0);
  });

  test("undo of a break-glass number (ALLOWED_PHONES) says it stays authorized; an old approved request keeps nobody in", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const pool = await db();
    const { claim } = await newClaim("0900000036", "U-c6", "ออกแล้ว");
    await pool.query(
      `INSERT INTO access_requests (phone, line_sub, first_name, last_name, position, status, decided_at)
       VALUES ('0900000036', 'U-c6', 'ยัง', 'เข้าได้', 'RN', 'approved', now())`,
    );
    await post(tap(claimCallbackData(claim.id), ADMIN));
    assert.deepEqual(answers(), [ANSWERS.claimUndone]);
    resetAuthzCache();
    assert.equal(await isAuthorizedPhone("0900000036"), false, "an approved typed name does not keep the number in");
    // a break-glass number (ALLOWED_PHONES has 081-234-5678)
    calls.length = 0;
    const glass = await newClaim("0812345678", "U-c7", "ฉุกเฉิน");
    await post(tap(claimCallbackData(glass.claim.id), ADMIN));
    assert.deepEqual(answers(), [ANSWERS.claimUndoneStillAllowed]);
  });

  test("a claim announcement that reaches no chat is tried once more", async () => {
    await (await db()).query("TRUNCATE tutorial_seen, cases, mx_members, users_added, user_claims, email_codes, user_emails, users RESTART IDENTITY");
    const { claim, user } = await newClaim("0900000037", "U-c8", "ส่งซ้ำ");
    const waits: number[] = [];
    failing.add("sendMessage");
    const none = await announceClaim(user, claim, async (ms) => {
      waits.push(ms);
    });
    assert.deepEqual(none, []);
    assert.deepEqual(waits, [CLAIM_RETRY_MS]);
    assert.equal(calls.filter((c) => c.method === "sendMessage").length, 6, "two rounds of three chats");
    calls.length = 0;
    failing.clear();
    let retried = false;
    const sent = await announceClaim(user, claim, async () => {
      retried = true;
    });
    assert.equal(sent.length, 3);
    assert.equal(retried, false, "no retry when it went out");
    // not configured: no retry either
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.deepEqual(await announceClaim(user, claim, async () => assert.fail("no wait")), []);
  });
});
