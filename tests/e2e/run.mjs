#!/usr/bin/env node
// End-to-end sign-in tests: mock LINE (+ mock Telegram) + mock deeSMSX + production build (next start) + Playwright
// (Chromium). The main app runs in provider mode (SMS_PROVIDER=deesmsx against tests/mock-deesmsx.mjs through
// DEESMSX_API_URL); a second app on the same build runs in local file mode (SMS_PROVIDER=file) near the end.
// Configurable so several copies can run in parallel:
//   E2E_APP_PORT (3100)  E2E_FILE_APP_PORT (3101)  E2E_GATE_APP_PORT (3103)  E2E_LINE_PORT (4010)  E2E_SMS_PORT (4011)
//   E2E_DATABASE_URL (postgres://postgres:postgres@localhost:5432/orskh_e2e)
//   E2E_OUTBOX_DIR (tmp)  E2E_SCREENS_DIR (tmp)  E2E_SKIP_BUILD=1 (reuse .next)
//   ALLOW_REMOTE_TEST_DB=1 (allow a non-local E2E_DATABASE_URL; see tests/db-guard.mjs)
// The database's sign-in tables are dropped first (the built app creates them again on first use), then the list of
// people (table users) is loaded with scripts/sync-users.mjs from a CSV in Pong's format in a new temp folder. After
// LINE, everyone picks their position on /login/verify: RN, PN and PCA verify their number by SMS and then claim their
// own name from the list on /login/claim (table user_claims; a claimed name is locked for everyone else); doctors (DR)
// pick their name on /login/doctor and type a code sent to their email (EMAIL_PROVIDER=file: the email is a JSON file
// in the outbox). There are no typed names anywhere (the access requests are gone).
// Only invented phone numbers (0812345678, 09000000xx, 0611111111) and invented names are used. Keep E2E_SCREENS_DIR
// outside the repository.
// The repair-phase tests near the end (MX's HOSxP upload, doctors' bookings with HN, the 16:00 turnover) move the app's
// clock through APP_FAKE_NOW_FILE (lib/clock.ts reads it on every call) and read holidays from the Bank of Thailand
// stub in tests/mock-line.mjs (BOT_HOLIDAYS_URL). They upload tests/fixtures/e2e-or-export.xlsx, the made-up sample
// moved to Tue 17 Nov 2026 with invented HNs (tests/e2e/make-workbook.py).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SignJWT } from "jose";
import { repoRoot } from "../../scripts/load-env.mjs";
import { assertDisposableUsers, assertLocalTestDatabase } from "../db-guard.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const pg = require("pg");

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const FILE_APP_PORT = Number(process.env.E2E_FILE_APP_PORT ?? 3101);
const DOWN_APP_PORT = Number(process.env.E2E_DOWN_APP_PORT ?? 3102);
const GATE_APP_PORT = Number(process.env.E2E_GATE_APP_PORT ?? 3103);
const LINE_PORT = Number(process.env.E2E_LINE_PORT ?? 4010);
const SMS_PORT = Number(process.env.E2E_SMS_PORT ?? 4011);
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/orskh_e2e";
// This run drops the sign-in tables and users: refuse a remote database unless ALLOW_REMOTE_TEST_DB=1 (tests/db-guard.mjs).
assertLocalTestDatabase(DB_URL, "E2E_DATABASE_URL");
const OUTBOX = process.env.E2E_OUTBOX_DIR ?? join(tmpdir(), `orskh-e2e-outbox-${APP_PORT}`);
const SCREENS = process.env.E2E_SCREENS_DIR ?? join(tmpdir(), `orskh-e2e-screens-${APP_PORT}`);
const LOG_DIR = join(tmpdir(), `orskh-e2e-logs-${APP_PORT}`);
const APP = `http://localhost:${APP_PORT}`;
const FILE_APP = `http://localhost:${FILE_APP_PORT}`;
const DOWN_APP = `http://localhost:${DOWN_APP_PORT}`;
const GATE_APP = `http://localhost:${GATE_APP_PORT}`;
const LINE = `http://127.0.0.1:${LINE_PORT}`;
const SMS = `http://127.0.0.1:${SMS_PORT}`;

const SESSION_SECRET = randomBytes(32).toString("base64url");
const OTP_PEPPER = randomBytes(24).toString("base64url");
const LINE_ID = "1234567890";
const LINE_SECRET = randomBytes(16).toString("hex");
const SMS_API_KEY = randomBytes(16).toString("hex");
const SMS_SECRET_KEY = randomBytes(24).toString("hex");
// The users list (table users, invented names, no numbers): DOC1 claims DOC1_NAME at the first login, DOC2 claims
// DOC2_NAME from a second LINE account (both nurses: doctors no longer claim by number, they sign in by email, see
// EMAIL_DOC); RETIRED's name is deactivated (it holds a claim made by hand); BREAK_GLASS is only in ALLOWED_PHONES.
const DOC1 = "0812345678";
const DOC1_NAME = "สมชาย ใจดี";
const DOC1_ROLE = "พยาบาล · ห้องผ่าตัด";
const DOC1_FIXED = "สมชาย ใจงาม"; // the name after a correction in the users table
const DOC2 = "0900000001";
const DOC2_NAME = "สมหญิง รักดี";
const DOC2_DEPT = "วิสัญญี";
const RETIRED = "0900000002";
const RETIRED_NAME = "สมศักดิ์ เกษียณ";
const BREAK_GLASS = "0611111111";
// a doctor who signs in with an email code (addresses in user_emails); NO_EMAIL_DOC has no address on file
const EMAIL_DOC = "กมล ทองดี";
const EMAIL_DOC_ROLE = "แพทย์ · สูติ-นรีเวชกรรม";
const EMAIL_DOC_ADDRESSES = ["kamon.t@example.com", "kt@example.org"];
const NO_EMAIL_DOC = "สมใจ ใจเย็น";
// NO_EMAIL_DOC also stands for a doctor whose name was claimed by number (a user_claims row via = 'phone', made by hand
// here, as before doctors had to use email): such a claim holds nothing, so doctors sign in by email only. RACE_DOC is
// given an address for one test only (a name taken between loading the page, or the emailed code, and the next step).
const PHONE_DOC = NO_EMAIL_DOC;
const PHONE_DOC_PHONE = "0900000010";
const RACE_DOC = "ณัฐพล วงศ์ใหญ่";
// MSG texts (src/lib/http.ts) of a name someone else holds: the way on is the administrator, never a typed name
const CLAIM_TAKEN = "ชื่อนี้มีคนเลือกแล้ว ถ้าเป็นชื่อคุณ ติดต่อผู้ดูแล";
const EMAIL_TAKEN = "ชื่อนี้มีคนใช้แล้ว ถ้าเป็นชื่อคุณ ติดต่อผู้ดูแล";
const ASK_ADMIN = "ไม่พบชื่อ หรือมีคนเลือกไปแล้ว? ติดต่อผู้ดูแล";
const LOCKED = "0900000008"; // locks its code with 5 wrong guesses
const USERS_CSV = [
  "\uFEFFfirst_name,last_name,type,subtype",
  "สมชาย,ใจดี,RN,OR",
  "สมหญิง,รักดี,RN,ANES",
  "สมศักดิ์,เกษียณ,RN,OR",
  "กมล,ทองดี,DR,OBGYN",
  "ชัยวัฒน์,มีสุข,DR,GENSX",
  "ณัฐพล,วงศ์ใหญ่,DR,NEPHRO",
  "สมใจ,ใจเย็น,DR,URO",
  "ปราณี,สายบุญ,RN,OR",
  "วิไล,แสงทอง,RN,ANES",
  "อรุณี,ศรีสุข,RN,OR",
  "สุดา,คำดี,PN,OR",
  "บุญมี,ใจซื่อ,PCA,OR",
].join("\r\n");

const SUB_A = "U0000000000000000000000000000000a";
const SUB_B = "U0000000000000000000000000000000b";
const SUB_C = "U0000000000000000000000000000000c";
const SUB_D = "U0000000000000000000000000000000d";
const SUB_E = "U0000000000000000000000000000000e";
const SUB_G = "U0000000000000000000000000000000g";
const SUB_H = "U0000000000000000000000000000000h";
const SUB_I = "U0000000000000000000000000000000i";
const SUB_J = "U0000000000000000000000000000000j";
const SUB_K = "U0000000000000000000000000000000k";
const SUB_L = "U0000000000000000000000000000000l";
const SUB_M = "U0000000000000000000000000000000m";
const SUB_P = "U0000000000000000000000000000000p"; // PHONE_DOC's LINE account
const SUB_Q = "U0000000000000000000000000000000q";
const SUB_R = "U0000000000000000000000000000000r";
const SUB_DOC = "U000000000000000000000000000000dc";
// AUTH_ADMIN_LINE_IDS: admins are listed by LINE user id, the session's sub
const ADMIN_SUB = "U00000000000000000000000000000ad1";
const TG_TOKEN = "123456789:AAe2eTOKENe2eTOKENe2eTOKEN_test";
const TG_CHAT = "1228757000";
const XSS_NAME = `<img src=x onerror="window.__xss=1">หมอ A`;
// the LINE name in every flow that takes screenshots: an ordinary Thai name (the XSS name is used where nothing is shot)
const LINE_NAME_A = "ต้นข้าว";
// numbers that hold no name; NURSE and WALK_IN have rows in access_requests from before (history only: access
// requests with typed names are gone, and no row there authorizes or names anyone)
const UNLISTED = "0900000003";
const NURSE = "0900000004";
const WALK_IN = "0900000005";
const CAPPED = "0900000006";
const ADMIN_ID = Number(TG_CHAT); // a private chat's id is the user's id
const STRANGER_ID = 5550001;
const WEBHOOK_PATH = "/api/telegram/webhook";
const WIDTHS = [360, 1280];
// The repair phase: the app's clock is the time in this file (none: the real time), and BOT_TOKEN is the holidays
// stub's token. The made-up workbook lists Tue 17 Nov 2026, the next workday after Mon 16 Nov (half 1 of the repair).
const NOW_FILE = join(tmpdir(), `orskh-e2e-now-${APP_PORT}.txt`);
const BOT_TOKEN = randomBytes(12).toString("hex");
const E2E_WORKBOOK = join(repoRoot, "tests", "fixtures", "e2e-or-export.xlsx");
const SAMPLE_WORKBOOK = join(repoRoot, "tests", "fixtures", "sample-or-export.xlsx");
// Invented people of the users list, each given their name by hand (README: a claim without the claim page): the
// nurses by a number, the doctors by email (doctors sign in by email only; `userId` is filled in when the claims are
// made). The admin's claim is held by the admin's LINE account, so /admin can name who saved the repair's dates.
const RP = {
  admin: { phone: "0900000021", name: "วิไล แสงทอง", sub: ADMIN_SUB },
  mx: { phone: "0900000022", name: "ปราณี สายบุญ", sub: "U00000000000000000000000000000mx1" },
  nurse: { phone: "0900000023", name: "อรุณี ศรีสุข", sub: "U00000000000000000000000000000rn1" },
  drX: { phone: null, name: "ณัฐพล วงศ์ใหญ่", sub: "U00000000000000000000000000000dx1", userId: null },
  drY: { phone: null, name: "ชัยวัฒน์ มีสุข", sub: "U00000000000000000000000000000dy1", userId: null },
};
// The bookings' HNs (invented, 7 digits): doctor X (NEPHRO: the mixed room OR 11) books one for Monday and two for
// Tuesday (one typed with a dash, matching the workbook's 7000002; one a dressing HOSxP will not list); doctor Y
// (GENSX: OR 12) books 7000015, which the workbook writes 007000015.
const HN_TODAY = "7900001";
const HN_X_MATCH = "700-0002";
const HN_X_MISSING = "7900002";
const HN_Y_MATCH = "7000015";
// The workbook's HNs (normalised), every one of them, kept or not.
const WORKBOOK_HNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 29].map((n) => `7${String(n).padStart(6, "0")}`);
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// User-Agents for the checks that depend on the device (the e2e app runs with the device gate off)
const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_IPHONE_LIFF =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0 LIFF";

const children = [];
const issuedCodes = [];
const shots = [];

/** 0812345678 -> 081-234-5678 (as the app shows it). */
const fmt = (p) => `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
/** 0812345678 -> 66812345678 (as deeSMSX takes it). */
const intl = (p) => `66${p.slice(1)}`;

function baseEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(VERCEL|SMS_|DEESMSX_|ALLOWED_|TELEGRAM_|AUTH_ADMIN)/.test(k)) delete env[k];
  }
  return env;
}

function startProcess(name, args, env) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `${name}.log`);
  const child = spawn(process.execPath, args, { cwd: repoRoot, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => chunks.push(d));
  const proc = { name, child, log: () => Buffer.concat(chunks).toString("utf8"), logFile, exit: null };
  child.on("exit", (code, signal) => (proc.exit = signal ?? `code ${code}`));
  children.push(proc);
  return proc;
}

/** Fails unless `port` can be bound on `host` (as the child will bind it), so the tests never talk to another server. */
function assertPortFree(port, host, envName) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (e) =>
      reject(new Error(`port ${port} is not free (${e.code}); is another server running? Set ${envName} to a free port`)),
    );
    srv.listen({ port, host, exclusive: true }, () => srv.close(resolve));
  });
}

function stopAll() {
  for (const p of children) {
    try {
      writeFileSync(p.logFile, p.log());
      process.kill(-p.child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

/** Waits until `url` answers; fails at once when `proc` (the server that should answer) has exited. */
async function waitFor(url, proc, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (proc?.exit) {
      writeFileSync(proc.logFile, proc.log());
      throw new Error(`${proc.name} exited (${proc.exit}) before it was ready; log: ${proc.logFile}`);
    }
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: repoRoot, env, stdio: "inherit" });
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited ${code}`))));
  });
}

/** As run(), returning what the command printed on stdout. */
function runCapture(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${args.join(" ")} exited ${code}`))));
  });
}

async function telegramMessages() {
  return (await fetch(`${LINE}/__control/telegram`)).json();
}

async function telegramCalls(method) {
  const calls = await (await fetch(`${LINE}/__control/telegram/calls`)).json();
  return method ? calls.filter((c) => c.method === method) : calls;
}

async function waitUntil(fn, what, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(100);
  }
}

/** Simulated Telegram webhook call (no Origin header, like Telegram). */
async function tgWebhook(path, update, secret) {
  const r = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret }) },
    body: JSON.stringify(update),
    redirect: "manual",
  });
  return { status: r.status, body: await r.text() };
}

let updateId = 1000;
function tapUpdate(data, fromId, message) {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      from: { id: fromId, is_bot: false, first_name: "Tester" },
      chat_instance: "e2e",
      data,
      ...(message ? { message: { message_id: message.message_id, chat: { id: Number(message.chat_id), type: "private" }, date: 0, text: "x" } } : {}),
    },
  };
}

async function waitForTelegram(count, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const msgs = await telegramMessages();
    if (msgs.length >= count || Date.now() > end) return msgs;
    await sleep(100);
  }
}

async function setIdentity(body) {
  const r = await fetch(`${LINE}/__control/identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ picture: null, error: null, ...body }),
  });
  if (!r.ok) throw new Error("mock identity update failed");
}

function outboxFiles() {
  return existsSync(OUTBOX) ? readdirSync(OUTBOX).filter((f) => f.endsWith(".json")).sort() : [];
}

/** The doctors' emails written so far (EMAIL_PROVIDER=file), oldest first. */
function emailFiles() {
  const dir = join(OUTBOX, "email");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}

/** The email written after the first `count` ones: {to, subject, text, html, code, at}. */
async function waitForEmail(count, timeoutMs = 10_000) {
  const files = await waitUntil(() => (emailFiles().length > count ? emailFiles() : null), "an email in the outbox", timeoutMs);
  const mail = JSON.parse(readFileSync(join(OUTBOX, "email", files[count]), "utf8"));
  issuedCodes.push(mail.code);
  return mail;
}

/** Every OTP the mock deeSMSX issued [{to, pin, ref, sender, token, at}]. */
async function smsIssued() {
  return (await fetch(`${SMS}/__control/sms`)).json();
}

async function smsControl(path, body) {
  const r = await fetch(`${SMS}/__control/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`mock deeSMSX ${path} failed`);
}

/** The next OTP the mock deeSMSX issued to `phone` that is not in `seen` (indexes into the issued list). */
async function waitForSms(phone, seen, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const all = await smsIssued();
    for (let i = 0; i < all.length; i++) {
      if (seen.has(i) || all[i].to !== intl(phone)) continue;
      seen.add(i);
      issuedCodes.push(all[i].pin, all[i].token);
      return all[i];
    }
    await sleep(150);
  }
  throw new Error(`no SMS to ${fmt(phone)} within ${timeoutMs} ms`);
}

/** The next local-mode SMS file {to, text, code, ref, at} for `phone` (SMS_PROVIDER=file). */
async function waitForSmsFile(phone, seen, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    for (const f of outboxFiles()) {
      if (seen.has(f)) continue;
      const m = JSON.parse(readFileSync(join(OUTBOX, f), "utf8"));
      if (m.to === phone) {
        seen.add(f);
        issuedCodes.push(m.code);
        return m;
      }
    }
    await sleep(150);
  }
  throw new Error(`no SMS file for ${fmt(phone)} within ${timeoutMs} ms`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

/** A session cookie value signed like signSession() in src/lib/tokens.ts (for checks that need no sign-in). */
/** A session cookie's token: an SMS sign-in's number, or with `uid` a doctor's email sign-in (a users.id, no number). */
function sessionToken(phone, secret = SESSION_SECRET, sub = "Ux", uid = null) {
  return new SignJWT(uid ? { uid, name: "x", picture: null } : { phone, name: "x", picture: null })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer("orskh")
    .setAudience("session")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));
}

async function newContext(browser, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, locale: "th-TH" });
  // LINE profile pictures are served locally: no network calls to LINE.
  await ctx.route("https://*.line-scdn.net/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX }),
  );
  return ctx;
}

function trackCsp(page, sink) {
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) sink.push(m.text());
  });
}

// /login has no button: outside the LIFF app it goes straight on to LINE Login (the mock here) and back.
async function lineLogin(page, next, base = APP) {
  await page.goto(next ? `${base}/login?next=${encodeURIComponent(next)}` : `${base}/login`);
  await page.waitForLoadState("networkidle");
}

async function cookie(ctx, name) {
  return (await ctx.cookies(APP)).find((c) => c.name === name);
}

async function noSideScroll(page, label) {
  const w = await page.evaluate(() => {
    const scroller = document.querySelector("main") ?? document.documentElement;
    return [Math.max(document.documentElement.scrollWidth, scroller.scrollWidth), window.innerWidth];
  });
  assert(w[0] <= w[1], `${label}: horizontal scroll ${w[0]} > ${w[1]}`);
}


/** Every visible button, link and field is at least 44 px tall (touch targets). */
async function touchTargets(page, label) {
  const frames = await page.evaluate(() =>
    // A file picker in a closed /admin section is hidden: not a target until the section opens.
    [...document.querySelectorAll("main .file-picker")]
      .filter((el) => el.checkVisibility())
      .map((el) => Math.round(el.getBoundingClientRect().height))
      .filter((h) => h < 44),
  );
  assert(frames.length === 0, `${label}: file picker under 44 px: ${JSON.stringify(frames)}`);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("main a, main button, main input, main select")]
      // A visually hidden input (the upload's file input) is tapped through its label, whose frame is measured instead.
      .filter((el) => el.checkVisibility() && !el.classList.contains("sr-only"))
      .map((el) => [el.textContent?.trim() || el.id || el.tagName, Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44),
  );
  assert(small.length === 0, `${label}: touch targets under 44 px: ${JSON.stringify(small)}`);
}

/**
 * Opens an admin section by its heading row (components/admin-section.tsx): every section is closed on every visit,
 * its body hidden and its heading's buttons inert.
 */
async function openSection(page, id) {
  const toggle = page.locator(`#${id}-toggle`);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.locator(`#${id}-body`).waitFor({ state: "visible" });
}

/** A sign-in screen never offers LINE Login: no button, no "sign in with LINE" (LINE has signed the person in already). */
async function noLineLogin(page, label) {
  assert((await page.locator('[data-testid="line-login"]').count()) === 0, `${label}: no LINE button`);
  const text = (await page.textContent("main")) ?? "";
  assert(!/LINE Login|เข้า(ใช้|สู่ระบบ)?ด้วย ?LINE|ล็อกอิน(ด้วย)? ?LINE/i.test(text), `${label}: no "sign in with LINE" wording`);
}

/** The text of an element with its no-break and repeated spaces evened out. */
async function plainText(page, selector) {
  return ((await page.textContent(selector)) ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The page at 320 (overflow check), 360 and 1280 px; screenshots <name>-<width>.png (320 too with `narrow`).
 * `atEach(width)` runs extra checks at every width.
 */
async function shoot(page, name, { full = true, narrow = false, atEach = null } = {}) {
  const size = page.viewportSize();
  for (const width of [320, ...WIDTHS]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
    await noSideScroll(page, `${name} at ${width}px`);
    if (atEach) await atEach(width);
    if (width !== 320 || narrow) {
      // The sign-in card scrolls inside <main> (the page itself never scrolls): grow the window to show all of it.
      const tall = full ? await page.evaluate(() => document.querySelector("main")?.scrollHeight ?? 0) : 0;
      const height = width === 1280 ? 900 : 780;
      if (tall > height) await page.setViewportSize({ width, height: tall });
      const file = `${name}-${width}.png`;
      await page.screenshot({ path: join(SCREENS, file) });
      shots.push(file);
      if (tall > height) await page.setViewportSize({ width, height });
    }
  }
  await page.setViewportSize(size);
}

function rawRequest(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: APP_PORT, path, method: "GET", headers }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    req.on("error", reject);
    req.end();
  });
}

async function postJson(path, body, headers = {}) {
  const r = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  return { status: r.status, body: await r.text() };
}

/** The name the board's top bar shows (account menu text, present even while the menu is closed). */
async function boardName(page) {
  await page.waitForSelector('[data-testid="user-menu"]');
  return (await page.textContent('[data-testid="account-name"]'))?.trim();
}

/**
 * The built app creates every table on first use (here: the session check of an unlisted number), then the users list
 * is loaded as in production: scripts/sync-users.mjs, from a CSV in Pong's format outside the repository.
 */
async function loadUsers(db) {
  const probe = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken("0899999999")}` });
  assert(probe.status === 307, `unlisted session -> ${probe.status}`);
  const tables = await db.query(
    "SELECT string_agg(table_name, ',' ORDER BY table_name) AS t FROM information_schema.tables WHERE table_schema = 'public'",
  );
  for (const t of ["access_requests", "line_bindings", "login_events", "otp_codes", "user_claims", "users"]) {
    assert(tables.rows[0].t?.split(",").includes(t), `the app created ${t}: ${tables.rows[0].t}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "orskh-e2e-users-"));
  try {
    const csv = join(dir, "all-users.csv");
    writeFileSync(csv, USERS_CSV);
    await run(process.execPath, ["scripts/sync-users.mjs", "--apply", csv], { ...baseEnv(), DATABASE_URL: DB_URL });
    // a second dry run sees nothing to change
    const dry = await runCapture(process.execPath, ["scripts/sync-users.mjs", csv], { ...baseEnv(), DATABASE_URL: DB_URL });
    assert(/summary: added 0, changed 0, reactivated 0, deactivated 0, unchanged 12\n/.test(dry), `second dry run: ${dry}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // a name that holds a claim and was then taken off the list (as the sync deactivates it, or by hand in SQL)
  await db.query(
    "INSERT INTO user_claims (user_id, phone, line_sub) SELECT id, $1, 'U-retired-by-hand' FROM users WHERE first_name || ' ' || last_name = $2",
    [RETIRED, RETIRED_NAME],
  );
  await db.query("UPDATE users SET active = false, updated_at = now() WHERE first_name || ' ' || last_name = $1", [RETIRED_NAME]);
  const counts = await db.query("SELECT type, count(*)::int AS n FROM users WHERE active GROUP BY type ORDER BY type");
  assert(JSON.stringify(counts.rows) === JSON.stringify([{ type: "DR", n: 4 }, { type: "PCA", n: 1 }, { type: "PN", n: 1 }, { type: "RN", n: 5 }]), `users: ${JSON.stringify(counts.rows)}`);
  const claimed = await db.query(
    "SELECT count(*)::int AS n FROM user_claims c JOIN users u ON u.id = c.user_id WHERE u.active AND c.undone_at IS NULL",
  );
  assert(claimed.rows[0].n === 0, "nobody has claimed a name yet");
}

/** The id of a users row by its full name. */
async function userId(db, fullName) {
  const r = await db.query("SELECT id::text AS id FROM users WHERE first_name || ' ' || last_name = $1", [fullName]);
  return r.rows[0]?.id;
}

/** The current claim (undone_at IS NULL) of a full name, or undefined. */
async function currentClaim(db, fullName) {
  const r = await db.query(
    `SELECT c.id::text AS id, c.phone, c.line_sub, c.line_name, c.tg_messages FROM user_claims c JOIN users u ON u.id = c.user_id
     WHERE u.first_name || ' ' || u.last_name = $1 AND c.undone_at IS NULL`,
    [fullName],
  );
  return r.rows[0];
}

/** Snapshot of users with each row's xmin (it changes whenever a row is written). */
async function usersSnapshot(db) {
  return JSON.stringify((await db.query("SELECT xmin::text AS xmin, * FROM users ORDER BY id")).rows);
}

async function main() {
  // The upload tests send a generated workbook; say how to make it before a long build rather than fail midway.
  if (!existsSync(SAMPLE_WORKBOOK)) throw new Error("tests/fixtures/sample-or-export.xlsx is missing");
  if (!existsSync(E2E_WORKBOOK)) {
    throw new Error("tests/fixtures/e2e-or-export.xlsx is missing: run python3 -I tests/e2e/make-workbook.py (needs openpyxl)");
  }
  // Both ports must be free (checked before the build, and again before the servers start): a server
  // already listening there would answer in place of this build.
  const portsFree = async () => {
    await assertPortFree(APP_PORT, undefined, "E2E_APP_PORT");
    await assertPortFree(FILE_APP_PORT, undefined, "E2E_FILE_APP_PORT");
    await assertPortFree(DOWN_APP_PORT, undefined, "E2E_DOWN_APP_PORT");
    await assertPortFree(GATE_APP_PORT, undefined, "E2E_GATE_APP_PORT");
    await assertPortFree(LINE_PORT, "127.0.0.1", "E2E_LINE_PORT");
    await assertPortFree(SMS_PORT, "127.0.0.1", "E2E_SMS_PORT");
  };
  await portsFree();
  rmSync(OUTBOX, { recursive: true, force: true });
  mkdirSync(OUTBOX, { recursive: true });
  mkdirSync(SCREENS, { recursive: true });
  // the real time until the repair-phase tests set one
  rmSync(NOW_FILE, { force: true });

  // Fresh database: drop the sign-in tables so the app's lazy schema creation is exercised too (the users list is
  // loaded once the app has created them, as in production: loadUsers() after the servers are up).
  const db = new pg.Pool({ connectionString: DB_URL, max: 2 });
  await assertDisposableUsers((sql) => db.query(sql), "E2E_DATABASE_URL"); // users holding real data: stop before the DROP
  await db.query("DROP TABLE IF EXISTS tutorial_seen, otp_codes, line_bindings, login_events, cases, mx_members, users_added, workbook_cases, workbook_uploads, repair_periods, user_claims, email_codes, user_emails, users, access_requests");

  const appEnv = {
    ...baseEnv(),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    // Canonical-host redirect is active (VERCEL_ENV=production) but VERCEL itself is unset,
    // so dev transports and the mock LINE endpoints remain allowed.
    VERCEL_ENV: "production",
    APP_URL: APP,
    LINE_CHANNEL_ID: LINE_ID,
    LINE_CHANNEL_SECRET: LINE_SECRET,
    LINE_AUTH_URL: `${LINE}/oauth2/v2.1/authorize`,
    LINE_API_URL: LINE,
    SESSION_SECRET,
    OTP_PEPPER,
    // break-glass only: everyone else claims a name from the list (any common way of writing the number)
    ALLOWED_PHONES: ` ${fmt(BREAK_GLASS)} `,
    DATABASE_URL: DB_URL,
    // provider mode against the mock (DEESMSX_SENDER unset: the shared sender deeSMS.OTP)
    SMS_PROVIDER: "deesmsx",
    DEESMSX_API_KEY: SMS_API_KEY,
    DEESMSX_SECRET_KEY: SMS_SECRET_KEY,
    DEESMSX_API_URL: `${SMS}/v1`,
    TELEGRAM_BOT_TOKEN: TG_TOKEN,
    TELEGRAM_CHAT_ID: TG_CHAT,
    TELEGRAM_API_URL: LINE,
    // doctors' email codes are written to files (one JSON per email, with the code)
    EMAIL_PROVIDER: "file",
    EMAIL_OUTBOX_DIR: join(OUTBOX, "email"),
    // holidays from the Bank of Thailand stub in mock-line (never the real API), and the clock the tests move
    BOT_API_TOKEN: BOT_TOKEN,
    BOT_HOLIDAYS_URL: `${LINE}/financial-institutions-holidays/`,
    APP_FAKE_NOW_FILE: NOW_FILE,
    // one admin (spaces and an empty entry are ignored); SUB_A, the first-login account, is not one
    AUTH_ADMIN_LINE_IDS: ` ${ADMIN_SUB} ,, `,
  };

  if (process.env.E2E_SKIP_BUILD !== "1") {
    console.log("[e2e] next build ...");
    await run(process.execPath, ["node_modules/next/dist/bin/next", "build"], { ...baseEnv(), NEXT_TELEMETRY_DISABLED: "1" });
  }

  await portsFree().catch(async (e) => {
    await db.end();
    throw e;
  });
  const line = startProcess("mock-line", ["tests/mock-line.mjs"], {
    ...baseEnv(),
    MOCK_LINE_PORT: String(LINE_PORT),
    MOCK_LINE_CLIENT_ID: LINE_ID,
    MOCK_LINE_CLIENT_SECRET: LINE_SECRET,
    MOCK_BOT_TOKEN: BOT_TOKEN,
  });
  const sms = startProcess("mock-deesmsx", ["tests/mock-deesmsx.mjs"], {
    ...baseEnv(),
    MOCK_SMS_PORT: String(SMS_PORT),
    MOCK_SMS_API_KEY: SMS_API_KEY,
    MOCK_SMS_SECRET_KEY: SMS_SECRET_KEY,
  });
  const app = startProcess("app", ["node_modules/next/dist/bin/next", "start", "-p", String(APP_PORT)], appEnv);
  let fileApp = null; // the local file mode app, started by its test
  let downApp = null; // the app with its database down, started by its test
  let gateApp = null; // the app with the device gate on (as on Vercel), started by its test
  try {
    await waitFor(`${LINE}/__control/health`, line);
    await waitFor(`${SMS}/__control/health`, sms);
    await waitFor(`${APP}/login`, app);
    // a late exit (for example EADDRINUSE after a race) would leave another server answering
    await sleep(500);
    for (const p of [line, sms, app]) if (p.exit) throw new Error(`${p.name} exited (${p.exit}); log: ${p.logFile}`);
    await loadUsers(db);
    // Every doctor has seen the doctors' tutorial already, so the board opens as before; its own test takes one back.
    await db.query("INSERT INTO tutorial_seen (user_id) SELECT id FROM users ON CONFLICT DO NOTHING");
  } catch (e) {
    await db.end();
    throw e;
  }
  console.log(`[e2e] app ${APP}, mock LINE ${LINE}, mock deeSMSX ${SMS}, db ${DB_URL.replace(/:[^:@/]+@/, ":***@")}`);

  const browser = await chromium.launch();
  const seenSms = new Set();
  const seenFiles = new Set();
  const results = [];
  let ctxA; // signed-in context reused by the logout test
  let genericMessage = "";
  let webhookSecret = ""; // read from the recorded setWebhook call
  let webhookPath = "";

  /**
   * On the position step of /login/verify (right after LINE): picks RN, PN or PCA, which opens the SMS form
   * (/login/verify?as=TYPE). Doctors (verify-type-DR) go to /login/doctor instead.
   */
  async function chooseType(page, type = "RN") {
    await page.waitForSelector('[data-testid="verify-types"]');
    await page.click(`[data-testid="verify-type-${type}"]`);
    await page.waitForSelector("#phone");
    const at = new URL(page.url());
    assert(at.pathname === "/login/verify" && at.search === `?as=${type}`, `the SMS form of ${type}: ${page.url()}`);
  }

  /** On /login/verify?as=TYPE: types the number (as `typed`), asks for the code, and returns the SMS the mock deeSMSX issued. */
  async function requestCode(page, phone, typed = phone) {
    await page.fill("#phone", typed);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="otp-info"]');
    return waitForSms(phone, seenSms);
  }

  /**
   * LINE login with a fresh account, the position `type`, then a number that holds no name, verified by code: the
   * claim page, with that position's names already open.
   */
  async function verifyToClaim(page, phone, type = "RN") {
    await lineLogin(page);
    assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
    await chooseType(page, type);
    const sms = await requestCode(page, phone);
    await page.fill("#code", sms.pin);
    await page.waitForURL(`${APP}/login/claim?type=${type}`);
    await page.waitForSelector('[data-testid="claim-names-step"]');
    await page.waitForSelector('[data-testid="claim-names"]');
  }

  /**
   * On /login/claim: the names of `type` (picked from the position list unless they are open already), then the name
   * (after typing `search`), and opens the confirm dialog.
   */
  async function pickName(page, type, fullName, search = "") {
    if (await page.locator('[data-testid="claim-types"]').count()) await page.click(`[data-testid="claim-type-${type}"]`);
    await page.waitForSelector('[data-testid="claim-names"]');
    if (search) await page.fill("#claim-search", search);
    await page.locator('[data-testid="claim-name"]', { hasText: fullName }).click();
    await page.waitForSelector('[data-testid="claim-confirm"][open]');
  }

  /** A row in access_requests as one from before the typed-name requests were removed (history only now). */
  async function oldRequest(phone, sub, status) {
    const r = await db.query(
      `INSERT INTO access_requests (phone, line_sub, line_name, first_name, last_name, position, status, decided_at, decided_by)
       VALUES ($1, $2, 'e2e', 'ขอ', 'เข้าใช้', 'RN', $3, $4::timestamptz, $5::bigint)
       RETURNING id::text AS id`,
      [phone, sub, status, status === "pending" ? null : new Date(), status === "pending" ? null : ADMIN_ID],
    );
    return r.rows[0].id;
  }

  async function requestRow(id) {
    return (await db.query("SELECT status, decided_at, decided_by::text AS decided_by FROM access_requests WHERE id = $1", [id])).rows[0];
  }

  async function t(name, fn) {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✔ ${name} (${Date.now() - start} ms)`);
    } catch (e) {
      results.push({ name, ok: false });
      console.log(`  ✖ ${name}\n      ${e.stack?.split("\n").slice(0, 3).join("\n      ")}`);
    }
  }

  try {
    await t("unauthenticated / -> /login (documents, RSC and prefetch requests), with security headers", async () => {
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      const root = await rawRequest("/", { host: `localhost:${APP_PORT}` });
      assert(root.status === 307 && root.location === "/login", `/ -> ${root.status} ${root.location}`);
      // no sign-in button: /login goes straight on to LINE Login (in the LIFF app, the LIFF SDK signs in instead)
      const login = await rawRequest("/login", { host: `localhost:${APP_PORT}` });
      assert(login.status === 307 && login.location === "/api/auth/line/start", `/login -> ${login.status} ${login.location}`);
      const loginNext = await rawRequest("/login?next=%2F%3Froom%3Dor-7", { host: `localhost:${APP_PORT}` });
      assert(loginNext.location === "/api/auth/line/start?next=%2F%3Froom%3Dor-7", `/login keeps next: ${loginNext.location}`);
      // the page that renders, where signing out lands
      const resp = await page.goto(`${APP}/login?signed_out=1`);
      assert(new URL(page.url()).pathname === "/login", `landed on ${page.url()}`);
      const h = resp.headers();
      const policy = h["content-security-policy"] ?? "";
      const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
      assert(nonce && policy.includes("'strict-dynamic'"), "CSP nonce + strict-dynamic");
      for (const d of ["frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "connect-src 'self'", "form-action 'self' https://access.line.me"]) {
        assert(policy.includes(d), `CSP has ${d}`);
      }
      assert(h["x-content-type-options"] === "nosniff", "nosniff");
      assert(h["referrer-policy"] === "strict-origin-when-cross-origin", "referrer-policy");
      assert((h["x-robots-tag"] ?? "").includes("noindex"), "x-robots-tag");
      assert((h["strict-transport-security"] ?? "").includes("max-age="), "hsts");
      assert((h["permissions-policy"] ?? "").includes("camera=()"), "permissions-policy");
      assert(h["x-frame-options"] === "DENY", "x-frame-options");
      assert(!h["x-powered-by"], "no x-powered-by");
      const html = await resp.text();
      const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert(scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)), "every script carries the nonce");
      await page.waitForLoadState("networkidle");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      assert((await page.textContent("h1")).trim() === "ออกจากระบบแล้ว", "signed-out title");
      assert((await page.locator('[data-testid="line-login"]').count()) === 0, "no LINE button");
      // a computer has no LINE menu: one link back to the board, which signs in again through LINE's page
      const reopen = page.locator('[data-testid="signed-out-reopen"]');
      assert((await reopen.count()) === 1 && (await reopen.getAttribute("href")) === "/", "signed-out: a computer's way back to the board");
      await noLineLogin(page, "/login?signed_out=1 (computer)");
      await touchTargets(page, "/login");
      await shoot(page, "login-signed-out");
      // in the LIFF app on a phone: text only, reopened from the LINE menu
      const liffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "th-TH", userAgent: UA_IPHONE_LIFF });
      const liffPage = await liffCtx.newPage();
      await liffPage.goto(`${APP}/login?signed_out=1`);
      assert((await liffPage.textContent("h1")).trim() === "ออกจากระบบแล้ว", "signed-out title (LIFF)");
      assert((await liffPage.textContent("main")).includes("เปิดใหม่ได้จากเมนูใน LINE"), "signed-out (LIFF): reopen from the LINE menu");
      assert((await liffPage.locator('[data-testid="signed-out-reopen"], main a, main button').count()) === 0, "signed-out (LIFF): no link or button");
      await liffCtx.close();

      // LINE Login from a computer opens on LINE's QR code and asks for it every time (never "continue as" the last
      // person on a shared computer); in the LINE app LINE's own sign-in stays as it is
      const startAt = async (ua) => new URL((await rawRequest("/api/auth/line/start", { host: `localhost:${APP_PORT}`, "user-agent": ua })).location);
      const desk = await startAt(UA_DESKTOP);
      assert(desk.searchParams.get("initial_amr_display") === "lineqr" && desk.searchParams.get("prompt") === "login", `computer: ${desk.search}`);
      const inLine = await startAt(UA_IPHONE_LIFF);
      assert(!inLine.searchParams.has("initial_amr_display") && !inLine.searchParams.has("prompt"), `LIFF fallback: ${inLine.search}`);

      for (const headers of [{ RSC: "1" }, { RSC: "1", "Next-Router-Prefetch": "1" }, { Purpose: "prefetch" }]) {
        const r = await rawRequest("/", { host: `localhost:${APP_PORT}`, ...headers });
        assert(r.status === 307 && r.location?.startsWith("/login"), `gated ${JSON.stringify(headers)} -> ${r.status}`);
      }
      const rsc = await rawRequest("/?_rsc=abc", { host: `localhost:${APP_PORT}`, RSC: "1" });
      assert(rsc.status === 307, "?_rsc gated");
      const api = await fetch(`${APP}/api/board`, { redirect: "manual" });
      assert(api.status === 401, `non-auth API -> ${api.status}`);
      const robots = await (await fetch(`${APP}/robots.txt`)).text();
      assert(/Disallow: \/\s*$/.test(robots), "robots.txt disallows all");
      for (const file of ["/icon.svg", "/favicon.ico", "/apple-icon.png"]) {
        const r = await fetch(`${APP}${file}`, { redirect: "manual" });
        assert(r.status === 200, `${file} is served without a session: ${r.status}`);
      }
      const deep = await rawRequest("/?room=or-7", { host: `localhost:${APP_PORT}` });
      assert(deep.location === "/login?next=%2F%3Froom%3Dor-7", `next param: ${deep.location}`);
      const preview = await rawRequest("/preview", { host: `localhost:${APP_PORT}` });
      assert(preview.status === 404, `/preview is public but 404 outside development: ${preview.status}`);
      await ctx.close();
    });

    await t("canonical host: other hosts redirect to APP_URL with the same path", async () => {
      // Locally `next start` sees every request as APP_URL's host, so Next may relativize the
      // Location; resolve it against APP_URL (on Vercel it is absolute).
      const r = await rawRequest("/login?x=1", { host: "orskh-git-branch.vercel.app" });
      assert(r.status === 308 && new URL(r.location, APP).toString() === `${APP}/login?x=1`, `${r.status} ${r.location}`);
      const r2 = await rawRequest("//evil.test/path", { host: "orskh-abc123.vercel.app" });
      assert(r2.status === 308 && !r2.location.startsWith("//"), `protocol-relative Location: ${r2.location}`);
      assert(new URL(r2.location, APP).origin === APP, `no open redirect: ${r2.location}`);
      const same = await rawRequest("/login?signed_out=1", { host: `localhost:${APP_PORT}` });
      assert(same.status === 200, `canonical host is served: ${same.status}`);
    });

    await t("first login: LINE -> position (พยาบาล) -> phone -> SMS code (deeSMSX) -> /login/claim?type=RN with the names open -> name -> board with the claimed full name", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A, picture: "https://profile.line-scdn.net/0hMockPicture" });
      ctxA = await newContext(browser);
      const page = await ctxA.newPage();
      const csp = [];
      trackCsp(page, csp);
      const verifyBodies = [];
      page.on("request", (q) => {
        if (new URL(q.url()).pathname === "/api/auth/otp/verify") verifyBodies.push(q.postDataJSON());
      });
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify" && new URL(page.url()).search === "", `at ${page.url()}`);
      assert(!(await cookie(ctxA, "line-tx"))?.value, "tx cookie cleared");
      const pending = await cookie(ctxA, "pending");
      assert(pending?.httpOnly && pending.sameSite === "Lax", "pending cookie HttpOnly+Lax");
      assert((await page.textContent('[data-testid="line-name"]')).includes(LINE_NAME_A), "LINE name shown");

      // step 1: the position. Doctors go to the email sign-in, everyone else to an SMS code; nothing to type here
      await page.waitForSelector('[data-testid="verify-types"]');
      assert((await page.textContent("h1")).trim() === "ยืนยันตัวตน", `title: ${await page.textContent("h1")}`);
      assert((await plainText(page, '[data-testid="verify-types"] h2')) === "เลือกตำแหน่งของคุณ", "position heading");
      const verifyTypes = await page.$$eval('[data-testid^="verify-type-"]', (els) =>
        els.map((e) => [e.dataset.testid, e.getAttribute("href"), e.textContent.trim()]),
      );
      assert(
        JSON.stringify(verifyTypes) ===
          JSON.stringify([
            ["verify-type-DR", "/login/doctor", "แพทย์ยืนยันตัวตนด้วยรหัสทางอีเมล"],
            ["verify-type-RN", "/login/verify?as=RN", "พยาบาลยืนยันตัวตนด้วยรหัสทาง SMS"],
            ["verify-type-PN", "/login/verify?as=PN", "ผู้ช่วยพยาบาลยืนยันตัวตนด้วยรหัสทาง SMS"],
            ["verify-type-PCA", "/login/verify?as=PCA", "พนักงานช่วยเหลือคนไข้ยืนยันตัวตนด้วยรหัสทาง SMS"],
          ]),
        `position links: ${JSON.stringify(verifyTypes)}`,
      );
      assert((await page.locator("#phone").count()) === 0 && (await page.locator("main input").count()) === 0, "no field on the position step");
      assert((await plainText(page, '[data-testid="verify-types"] [data-testid="ask-admin"]')) === ASK_ADMIN, "not on the list: ask the administrator");
      assert((await page.locator('[data-testid="doctor-email-link"]').count()) === 0, "no separate doctors' button any more");
      await noLineLogin(page, "/login/verify (position)");
      await touchTargets(page, "/login/verify (position)");
      await shoot(page, "verify-types", { narrow: true });
      // the address decides nothing a doctor could use: ?as=DR is the email sign-in, an unknown position the list again
      await page.goto(`${APP}/login/verify?as=DR`);
      assert(new URL(page.url()).pathname === "/login/doctor", `?as=DR -> ${page.url()}`);
      await page.goto(`${APP}/login/verify?as=XX`);
      await page.waitForSelector('[data-testid="verify-types"]');
      await chooseType(page, "PN");
      // "เปลี่ยน" goes back to the positions
      assert((await page.getAttribute('[data-testid="verify-change-type"]', "href")) === "/login/verify", "the way back to the positions");
      await page.click('[data-testid="verify-change-type"]');
      await chooseType(page, "RN");

      // step 2: the number, under the chosen position
      assert((await page.textContent("h1")).includes("ยืนยันเบอร์มือถือ"), `title: ${await page.textContent("h1")}`);
      assert((await page.textContent('[data-testid="verify-type"]')).trim() === "พยาบาล", "the chosen position is shown");
      assert((await page.locator('[data-testid="doctor-email-link"]').count()) === 0, "no doctors' email button under the number");
      await noLineLogin(page, "/login/verify (phone)");
      // the number field: a phone keypad, the browser's saved number, a Thai example
      const attrs = await page.$eval("#phone", (el) => ({
        type: el.type,
        inputMode: el.inputMode,
        autocomplete: el.autocomplete,
        placeholder: el.placeholder,
      }));
      assert(
        JSON.stringify(attrs) === JSON.stringify({ type: "tel", inputMode: "numeric", autocomplete: "tel-national", placeholder: "0xx-xxx-xxxx" }),
        `phone field: ${JSON.stringify(attrs)}`,
      );
      assert((await page.textContent('label[for="phone"]')).trim() === "เบอร์มือถือ", "phone label");
      assert(await page.isDisabled('button[type="submit"]'), "send button waits for a number");
      await touchTargets(page, "/login/verify (phone)");
      await shoot(page, "verify-phone");

      // pasted as on a business card ("+66 (0)", 19 characters): kept whole, normalized by the server, shown back formatted
      await page.focus("#phone");
      await page.keyboard.insertText("+66 (0) 81 234 5678");
      assert((await page.inputValue("#phone")) === "+66 (0) 81 234 5678", `pasted number kept whole: ${await page.inputValue("#phone")}`);
      assert((await page.textContent('button[type="submit"]')).trim() === "ส่งรหัสทาง SMS", "send button text");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const sms = await waitForSms(DOC1, seenSms);
      assert(sms.sender === "deeSMS.OTP", `shared sender by default: ${sms.sender}`);
      assert(/^\d{6}$/.test(sms.pin), "a 6-digit pin");
      genericMessage = (await page.textContent('[data-testid="otp-info"]')).trim();
      assert(
        genericMessage === `ส่งรหัสทาง SMS ไปที่ ${fmt(DOC1)} แล้ว · รหัสอ้างอิง ${sms.ref}`,
        `code-step notice names the number and the SMS's reference: ${genericMessage}`,
      );
      assert((await page.textContent('[data-testid="otp-ref"]')) === sms.ref, "reference from deeSMSX");
      assert((await page.textContent('[data-testid="resend"]')).includes("วินาที"), "resend countdown");
      // the number, the reference and the 5-minute limit are read with the code field
      const describedBy = await page.getAttribute("#code", "aria-describedby");
      assert(describedBy === "otp-info code-help code-error", `code field description: ${describedBy}`);
      assert((await page.evaluate(() => document.activeElement?.id)) === "code", "focus on the code field");
      const codeAttrs = await page.$eval("#code", (el) => [el.autocomplete, el.inputMode, el.getAttribute("pattern")].join(" "));
      assert(codeAttrs === "one-time-code numeric [0-9]{6}", `code field: ${codeAttrs}`);
      assert((await page.getByRole("button", { name: "เปลี่ยนเบอร์" }).count()) === 1, "change-number button");
      await touchTargets(page, "/login/verify (code)");
      await shoot(page, "verify-code");

      // paste-friendly: spaces and Thai digits are accepted; the number holds no name yet, so the claim page follows,
      // with the names of the position chosen before the number already open
      const thai = sms.pin.replace(/\d/g, (d) => String.fromCharCode(0x0e50 + Number(d)));
      await page.fill("#code", `${thai.slice(0, 3)} ${thai.slice(3)}`);
      await page.waitForURL(`${APP}/login/claim?type=RN`);
      await page.waitForSelector('[data-testid="claim-names-step"]');
      await page.waitForSelector('[data-testid="claim-names"]');
      assert(verifyBodies.length === 1 && verifyBodies[0].as === "RN", `the position goes with the code: ${JSON.stringify(verifyBodies.map((b) => b.as))}`);
      assert((await page.textContent('[data-testid="claim-type"]')).trim() === "พยาบาล", "the nurses' names, opened at once");
      assert((await page.locator('[data-testid="claim-types"]').count()) === 0, "no position list first");
      assert(!(await cookie(ctxA, "session")), "no session before a name is chosen");
      assert(!(await cookie(ctxA, "pending"))?.value, "pending cleared");
      assert((await cookie(ctxA, "access"))?.httpOnly, "access cookie for the claim step");
      assert((await page.textContent("h1")).includes("ยืนยันชื่อของคุณ"), `claim title: ${await page.textContent("h1")}`);
      assert((await page.textContent('[data-testid="line-name"]')) === LINE_NAME_A, "LINE name shown");
      assert((await page.textContent('[data-testid="request-phone"]')).trim() === fmt(DOC1), "verified number shown");
      // names come only from the list: no field but the search, no access request, the administrator for anything else
      assert((await plainText(page, '[data-testid="claim-names-step"] [data-testid="ask-admin"]')) === ASK_ADMIN, "ask the administrator");
      assert(
        (await page.$eval('[data-testid="claim-names-step"] [data-testid="ask-admin"]', (el) => el.tagName + el.querySelectorAll("a").length)) === "P0",
        "plain text, not a link",
      );
      assert((await page.locator('[data-testid="claim-request-link"], a[href="/login/request"]').count()) === 0, "no way to an access request");
      assert(JSON.stringify(await page.$$eval("main input", (els) => els.map((e) => e.id))) === '["claim-search"]', "the search is the only field");
      await noLineLogin(page, "/login/claim (names)");

      // the other positions: "เปลี่ยน" (doctors go to the email sign-in from there)
      await page.click('[data-testid="claim-change-type"]');
      await page.waitForSelector('[data-testid="claim-types"]');
      const typeLabels = await page.$$eval('[data-testid^="claim-type-"]', (els) => els.map((e) => [e.dataset.testid, e.textContent.trim()]));
      assert(
        JSON.stringify(typeLabels) ===
          JSON.stringify([
            ["claim-type-DR", "แพทย์ยืนยันตัวตนด้วยรหัสทางอีเมล"],
            ["claim-type-RN", "พยาบาล"],
            ["claim-type-PN", "ผู้ช่วยพยาบาล"],
            ["claim-type-PCA", "พนักงานช่วยเหลือคนไข้"],
          ]),
        `type buttons: ${JSON.stringify(typeLabels)}`,
      );
      assert((await page.getAttribute('[data-testid="claim-type-DR"]', "href")) === "/login/doctor", "doctors go to the email sign-in");
      assert((await plainText(page, '[data-testid="claim-types"] [data-testid="ask-admin"]')) === ASK_ADMIN, "ask the administrator");
      assert((await page.locator('[data-testid="claim-request-link"], a[href="/login/request"]').count()) === 0, "no way to an access request");
      await touchTargets(page, "/login/claim (types)");
      await shoot(page, "claim-types", { narrow: true });

      // step 2: the names of that type (active rows only), searchable by first or last name
      await page.click('[data-testid="claim-type-RN"]');
      await page.waitForSelector('[data-testid="claim-names"]');
      assert((await page.textContent('[data-testid="claim-type"]')).trim() === "พยาบาล", "chosen type shown");
      const names = await page.$$eval('[data-testid="claim-name"] .font-semibold', (els) => els.map((e) => e.textContent.trim()));
      assert(names.length === 5 && names.includes(DOC1_NAME) && names.includes(DOC2_NAME), `RN names: ${names.length}`);
      assert(!names.includes(RETIRED_NAME), "a deactivated name is not offered");
      assert(JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, "th"))), "sorted in Thai order");
      assert((await page.textContent('[data-testid="claim-count"]')).trim() === "5 รายชื่อ · เลือกได้ 5", `count: ${await page.textContent('[data-testid="claim-count"]')}`);
      // one scroller (the page): the list is not a box of its own, and the search bar stays on top while names scroll by
      const layout = await page.evaluate(() => ({
        list: getComputedStyle(document.querySelector('[data-testid="claim-names"]')).overflowY,
        bar: getComputedStyle(document.querySelector('[data-testid="claim-search-bar"]')).position,
      }));
      assert(layout.list === "visible" && layout.bar === "sticky", `list and search layout: ${JSON.stringify(layout)}`);
      await page.setViewportSize({ width: 320, height: 480 });
      const stuck = await page.evaluate(() => {
        const main = document.querySelector("main");
        main.scrollTop = main.scrollHeight;
        const bar = document.querySelector('[data-testid="claim-search-bar"]').getBoundingClientRect();
        return { scrolled: main.scrollTop > 0, top: Math.round(bar.top - main.getBoundingClientRect().top) };
      });
      // flush with the top of the scroller: no strip above the bar where names show through (Pong, 14 Nov 2026)
      assert(stuck.scrolled && Math.abs(stuck.top) <= 1, `search bar sticks at the very top when the page scrolls: ${JSON.stringify(stuck)}`);
      await page.evaluate(() => (document.querySelector("main").scrollTop = 0));
      await page.setViewportSize({ width: 390, height: 844 });
      const focusedStep = await page.evaluate(() => [document.activeElement?.tagName, document.activeElement?.textContent?.trim()].join(" "));
      assert(focusedStep === "H2 เลือกชื่อของคุณ", `focus moves to the new step's heading: ${focusedStep}`);
      await page.fill("#claim-search", "xyz");
      await page.waitForSelector('[data-testid="claim-empty"]');
      const empty = await page.textContent('[data-testid="claim-empty"]');
      assert(empty.includes("ไม่พบ “xyz” ในรายชื่อพยาบาล"), `the empty search names the list it searched: ${empty}`);
      assert((await page.locator('[data-testid="claim-other-type"]').count()) === 1, "a way to another position");
      // another position keeps what was typed
      await page.click('[data-testid="claim-other-type"]');
      await page.waitForSelector('[data-testid="claim-types"]');
      await page.click('[data-testid="claim-type-PN"]');
      await page.waitForSelector('[data-testid="claim-empty"]');
      assert((await page.inputValue("#claim-search")) === "xyz", "the search text carries over");
      await page.click('[data-testid="claim-change-type"]');
      await page.click('[data-testid="claim-type-RN"]');
      await page.waitForSelector('[data-testid="claim-empty"]');
      await page.fill("#claim-search", " ใจ ดี"); // spaces ignored
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="claim-name"]').length === 1);
      assert((await page.textContent('[data-testid="claim-name"]')).includes(DOC1_NAME), "search by last name");
      assert((await page.textContent('[data-testid="claim-name"]')).includes("ห้องผ่าตัด"), "subtype shown in Thai");
      assert((await page.textContent('[data-testid="claim-count"]')).trim() === "พบ 1 จาก 5 รายชื่อ", "search count");
      await touchTargets(page, "/login/claim (names)");
      await shoot(page, "claim-names", { narrow: true });

      // the confirm dialog: cancel first (nothing happens), then confirm
      await page.click('[data-testid="claim-name"]');
      await page.waitForSelector('[data-testid="claim-confirm"][open]');
      assert((await page.textContent('[data-testid="claim-confirm-name"]')).trim() === DOC1_NAME, "name in the dialog");
      assert((await page.textContent('[data-testid="claim-confirm-role"]')).trim() === DOC1_ROLE, "role in the dialog");
      // an administrator in TELEGRAM_CHAT_ID can undo a claim here: the dialog says so
      const note = await plainText(page, "#claim-confirm-note");
      assert(
        note ===
          `ชื่อนี้จะผูกกับเบอร์ ${fmt(DOC1)} และบัญชี LINE นี้ แล้วผู้อื่นจะเลือกชื่อนี้ไม่ได้อีก ผู้ดูแลจะได้รับแจ้งทันที หากไม่ใช่ชื่อของคุณ ผู้ดูแลจะยกเลิก และเบอร์นี้กับบัญชี LINE นี้จะเลือกชื่อใหม่ไม่ได้ 24 ชั่วโมง`,
        `the dialog says the name is locked to this number and LINE account, and what an undo means: ${note}`,
      );
      assert((await page.evaluate(() => document.activeElement?.textContent?.trim())) === "ยกเลิก", "focus on cancel");
      await shoot(page, "claim-confirm", { narrow: true, full: false });
      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-testid="claim-confirm"]:not([open])', { state: "attached" });
      assert((await db.query("SELECT count(*)::int AS n FROM user_claims WHERE undone_at IS NULL AND phone = $1", [DOC1])).rows[0].n === 0, "cancel claims nothing");
      const usersBeforeClaim = await usersSnapshot(db);
      await page.click('[data-testid="claim-name"]');
      await page.waitForSelector('[data-testid="claim-confirm"][open]');
      await page.click('[data-testid="claim-confirm-yes"]');
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === DOC1_NAME, `full name from the table: ${await boardName(page)}`);
      const header = await page.textContent("header");
      assert(!header.includes(LINE_NAME_A), "the LINE display name is not shown on the board");
      assert((await page.textContent('[data-testid="account-phone"]')).trim() === fmt(DOC1), "formatted number in the account menu");
      assert((await page.textContent('[data-testid="account-role"]')).trim() === DOC1_ROLE, "role in the account menu");
      const phoneStyle = await page.$eval('[data-testid="account-phone"]', (el) => getComputedStyle(el).whiteSpace);
      assert(phoneStyle === "nowrap", `the number is never broken across lines: ${phoneStyle}`);
      assert((await page.getAttribute('[data-testid="user-menu"] img', "src")) === "https://profile.line-scdn.net/0hMockPicture", "LINE picture");
      const s = await cookie(ctxA, "session");
      assert(s?.httpOnly && s.sameSite === "Lax" && s.path === "/", "session cookie flags");
      // signed in from a computer's browser (the test browser's User-Agent): the cookie ends with the browser, and the
      // session inside it after 12 hours (in the LINE app it keeps 30 days)
      assert(s.expires === -1, `a computer's session cookie ends with the browser: expires ${s.expires}`);
      const sessionExp = JSON.parse(Buffer.from(s.value.split(".")[1], "base64url").toString()).exp;
      const sessionLeft = sessionExp - Date.now() / 1000;
      assert(sessionLeft > 11 * 3600 && sessionLeft <= 12 * 3600 + 5, `a computer's session lasts 12 h: ${Math.round(sessionLeft)} s`);
      assert(!(await cookie(ctxA, "access"))?.value, "access cookie cleared");
      await page.waitForLoadState("networkidle");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      const cur = await currentClaim(db, DOC1_NAME);
      assert(cur?.phone === DOC1 && cur.line_sub === SUB_A && cur.line_name === LINE_NAME_A, "the claim holds the number and the LINE account");
      const cl = await db.query("SELECT id::text AS id FROM user_claims WHERE line_sub = $1", [SUB_A]);
      assert(cl.rows.length === 1 && cl.rows[0].id === cur.id, "the claim is recorded once");
      assert((await usersSnapshot(db)) === usersBeforeClaim, "the claim did not write users");
      const b = await db.query("SELECT phone FROM line_bindings WHERE line_sub = $1", [SUB_A]);
      assert(b.rows[0]?.phone === DOC1, "binding stored with the canonical number");
      for (const event of ["otp_verified_unlisted", "claim"]) {
        const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = $3", [SUB_A, DOC1, event]);
        assert(ev.rowCount === 1, `${event} event logged`);
      }
      const row = await db.query("SELECT code_hash, provider_token, ref, used_at FROM otp_codes WHERE line_sub = $1", [SUB_A]);
      assert(row.rows.length === 1 && row.rows[0].code_hash === null && row.rows[0].used_at, "provider mode stores no code hash; used");
      assert(row.rows[0].provider_token.startsWith("v1.") && !row.rows[0].provider_token.includes(sms.token), "provider token sealed at rest");
      assert(row.rows[0].ref === sms.ref, "reference stored");
      // Telegram: the claim, with an undo button (sent after the response)
      const tg = await waitForTelegram(1);
      assert(tg.length === 1, `one Telegram message: ${tg.length}`);
      assert(tg[0].token === TG_TOKEN && tg[0].chat_id === TG_CHAT && tg[0].parse_mode === "HTML", "to the configured chat");
      const lines = tg[0].text.split("\n");
      assert(lines[0] === `🪪 ยืนยันชื่อ: ${DOC1_NAME} (${DOC1_ROLE})`, lines[0]);
      assert(lines[1] === `เบอร์ ${fmt(DOC1)} · LINE: ${LINE_NAME_A}`, lines[1]);
      assert(/^เวลา \d{1,2} \S+ 25\d\d \d{2}:\d{2} น\.$/.test(lines[2]) && lines.length === 3, lines[2]);
      const kb = JSON.stringify(tg[0].reply_markup?.inline_keyboard);
      assert(kb === JSON.stringify([[{ text: "↩️ ยกเลิกการยืนยัน", callback_data: `oc:${cl.rows[0].id}:u` }]]), `undo button: ${kb}`);
      const refs = await waitUntil(async () => (await db.query("SELECT tg_messages FROM user_claims WHERE id = $1", [cur.id])).rows[0].tg_messages[0], "stored message id");
      assert(refs.message_id === tg[0].message_id, "message id stored for the undo edit");
      // the webhook (for the undo button) was registered before the message, with a derived secret
      const set = await telegramCalls("setWebhook");
      assert(set.length === 1, `one setWebhook: ${set.length}`);
      assert((await telegramCalls("getWebhookInfo")).length >= 1, "getWebhookInfo called first");
      const hook = new URL(set[0].body.url);
      assert(hook.origin === APP && hook.pathname === WEBHOOK_PATH && /^\?v=[0-9a-f]{12}$/.test(hook.search), `webhook url ${hook}`);
      assert(JSON.stringify(set[0].body.allowed_updates) === '["callback_query"]', "only callback queries");
      webhookSecret = set[0].body.secret_token;
      webhookPath = `${hook.pathname}${hook.search}`;
      assert(/^[A-Za-z0-9_-]{43}$/.test(webhookSecret), "secret is URL-safe");
      // the code was single use
      const again = await page.request.post(`${APP}/api/auth/otp/verify`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { phone: DOC1, code: sms.pin },
      });
      assert(again.status() === 401, "pending cookie gone after login");
      // the access cookie is spent: a second claim from this browser is refused
      const twice = await page.request.post(`${APP}/api/auth/claim`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { userId: Number(await userId(db, DOC2_NAME)) },
      });
      assert(twice.status() === 401, `second claim -> ${twice.status()}`);
    });

    await t("board top bar and account menu at 360 and 1280 px; a corrected name shows without signing out", async () => {
      assert(ctxA, "signed-in context from the first-login test");
      const page = await ctxA.newPage();
      const csp = [];
      trackCsp(page, csp);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
        const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        assert(w[0] <= w[1], `no horizontal scroll at ${width}px: ${w[0]} > ${w[1]}`);
        const btn = await page.locator('[data-testid="user-menu"]').boundingBox();
        assert(btn && btn.height >= 44 && btn.width >= 44, `account button is a 44px target at ${width}px`);
        if (width === 1280) {
          assert(await page.locator('[data-testid="user-name"]').isVisible(), "name beside the avatar on a desktop");
          assert((await page.textContent('[data-testid="user-name"]')).trim() === DOC1_NAME, "desktop name");
          // a computer's side panel lists the open rooms until one is picked, and the room's ปิด goes back to it (a
          // day the suite is closed has no rooms to list)
          const overview = page.locator('[data-testid="room-overview"]');
          if (await overview.count()) {
            assert(await overview.isVisible(), "the open rooms beside the plan on a desktop");
            const first = overview.locator('button[data-testid^="overview-or-"]').first();
            const roomId = (await first.getAttribute("data-testid")).replace("overview-", "");
            // one badge per room (Pong, 18 Nov 2026, style A): "OR n" in a darker part, then the department's name
            const pill = first.locator(`[data-testid="room-pill-${roomId}"]`);
            const number = roomId.replace("or-", "");
            assert((await pill.locator(".room-pill-no").innerText()).replace(/\s+/g, " ").trim() === `OR ${number}`, `the badge starts with OR ${number}`);
            assert((await pill.locator(".room-pill-name").count()) >= 1 && (await pill.locator(".room-pill-name").first().innerText()).trim().length > 0, "the badge names the department");
            assert((await pill.getAttribute("title")).startsWith(`OR ${number} · `), "the badge's title holds the whole name");
            await first.click();
            await page.waitForURL((u) => new URL(u).searchParams.get("room") === roomId);
            await page.locator('[data-testid="room-close"]').click();
            await overview.waitFor({ state: "visible" });
            await page.waitForURL((u) => new URL(u).searchParams.get("room") === null);
          } else {
            console.log("[e2e] note: the board's day is closed, so the open-room list was not checked");
          }
        } else {
          assert(!(await page.locator('[data-testid="room-overview"]').isVisible()), "no room list on a phone");
        }
        await page.click('[data-testid="user-menu"]');
        const menu = page.locator('[data-testid="account-menu"]');
        await menu.waitFor({ state: "visible" });
        const box = await menu.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width, `menu inside the viewport at ${width}px`);
        const num = await page.locator('[data-testid="account-phone"]').boundingBox();
        assert(num && num.x >= box.x && num.x + num.width <= box.x + box.width + 0.5, `the number fits in the menu at ${width}px`);
        const out = await page.locator('[data-testid="logout"]').boundingBox();
        assert(out.height >= 44, "sign-out button is 44px tall");
        const file = `board-menu-${width}.png`;
        await page.screenshot({ path: join(SCREENS, file) });
        shots.push(file);
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      }
      // a corrected name in the table shows on the next request, with the same session
      const fix = (last) =>
        db.query(
          "UPDATE users SET last_name = $2, updated_at = now() WHERE id = (SELECT user_id FROM user_claims WHERE phone = $1 AND undone_at IS NULL)",
          [DOC1, last],
        );
      await fix(DOC1_FIXED.split(" ")[1]);
      await page.reload();
      assert((await boardName(page)) === DOC1_FIXED, `corrected name: ${await boardName(page)}`);
      await fix(DOC1_NAME.split(" ")[1]);
      // a signed-in visit to /login must not follow a next= that leaves the site or normalizes to "//host"
      const session = await cookie(ctxA, "session");
      for (const next of ["/.//evil.test", "/..//evil.test", "/%2e//evil.test", "/a/..//evil.test", "//evil.test", "https://evil.test", "/\\evil.test"]) {
        const r = await fetch(`${APP}/login?next=${encodeURIComponent(next)}`, {
          redirect: "manual",
          headers: { cookie: `session=${session.value}` },
        });
        const loc = r.headers.get("location") ?? "";
        assert(r.status === 307 && new URL(loc, APP).origin === APP && !loc.startsWith("//"), `next=${next} -> ${r.status} ${loc}`);
      }
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      await page.close();
    });

    await t("second login with the same LINE account skips the code (binding) and keeps a safe next=", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const visited = [];
      page.on("framenavigated", (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
      const before = (await smsIssued()).length;
      await lineLogin(page, "/?room=or-7");
      const at = new URL(page.url());
      assert(at.pathname === "/" && at.search === "?room=or-7", `next kept: ${page.url()}`);
      assert(!visited.includes("/login/verify"), "verify page not shown");
      assert((await smsIssued()).length === before, "no SMS sent");
      assert((await boardName(page)) === DOC1_NAME, "full name again");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_binding'", [SUB_A]);
      assert(ev.rowCount === 1, "login_binding event logged");
      assert((await telegramMessages()).length === 1, "no Telegram alert when the code step is skipped");
      await ctx.close();
    });

    await t("a second LINE account with another number: a claimed name is disabled and refused (ask the administrator); claims its own name", async () => {
      await setIdentity({ sub: SUB_M, name: "หมอหญิง" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const before = (await telegramMessages()).length;
      await verifyToClaim(page, DOC2, "RN");
      const taken = page.locator('[data-testid="claim-name"][data-claimed="true"]');
      assert((await taken.count()) === 1 && (await taken.textContent()).includes(DOC1_NAME), "the claimed name is marked");
      assert(await taken.isDisabled(), "and cannot be chosen");
      assert((await taken.textContent()).includes("มีผู้เลือกแล้ว"), "taken badge");
      assert((await page.textContent('[data-testid="claim-count"]')).trim() === "5 รายชื่อ · เลือกได้ 4", "count of free names");
      await taken.click({ force: true });
      await sleep(300);
      assert((await page.locator('[data-testid="claim-confirm"][open]').count()) === 0, "a taken name opens no dialog");
      await shoot(page, "claim-names-taken", { narrow: true });
      // the API agrees, and leaks no number or LINE id
      const list = await page.request.get(`${APP}/api/auth/claim/list?type=RN`);
      const body = await list.text();
      assert(list.status() === 200 && !body.includes(DOC1) && !body.includes(SUB_A), "list without numbers or LINE ids");
      assert(JSON.parse(body).names.find((n) => `${n.first_name} ${n.last_name}` === DOC1_NAME)?.claimed === true, "taken in the API");
      const headers = { origin: APP, "content-type": "application/json" };
      const doc1Id = Number(await userId(db, DOC1_NAME));
      const r = await page.request.post(`${APP}/api/auth/claim`, { headers, data: { userId: doc1Id } });
      const rBody = await r.json();
      assert(r.status() === 409 && rBody.reason === "taken" && rBody.error === CLAIM_TAKEN && !rBody.redirect, `claim a taken name -> ${r.status()} ${JSON.stringify(rBody)}`);
      assert((await currentClaim(db, DOC1_NAME))?.line_sub === SUB_A, "the first claim keeps the name");
      for (const badId of ["1; DROP TABLE users", 2147483648]) {
        const bad = await page.request.post(`${APP}/api/auth/claim`, { headers, data: { userId: badId } });
        assert(bad.status() === 400, `bad id ${badId} -> ${bad.status()}`);
      }
      // the phone's Back button goes from the names to the positions (not off the page), Forward comes back: the names
      // opened from the address have the positions under them, and so do names opened by hand
      await page.goBack();
      await page.waitForSelector('[data-testid="claim-types"]');
      assert(new URL(page.url()).pathname === "/login/claim", `Back from the names opened by the address: ${page.url()}`);
      await page.goForward();
      await page.waitForSelector('[data-testid="claim-names"]');
      assert((await page.textContent('[data-testid="claim-type"]')).trim() === "พยาบาล", "Forward reopens them");
      await page.click('[data-testid="claim-change-type"]');
      await page.waitForSelector('[data-testid="claim-types"]');
      await page.click('[data-testid="claim-type-RN"]');
      await page.waitForSelector('[data-testid="claim-names"]');
      await page.goBack();
      await page.waitForSelector('[data-testid="claim-types"]');
      assert(new URL(page.url()).pathname === "/login/claim", `Back stays on the claim page: ${page.url()}`);
      await page.goForward();
      await page.waitForSelector('[data-testid="claim-names"]');
      assert((await page.textContent('[data-testid="claim-type"]')).trim() === "พยาบาล", "Forward reopens the names");
      // the address keeps ?type=RN, yet a reload (or a Back or Forward that loads the page again) shows the step of its
      // entry: a position chosen by hand, and the positions under names opened from the address
      const showsPN = () =>
        document.querySelector('[data-testid="claim-type"]')?.textContent?.trim() === "ผู้ช่วยพยาบาล" &&
        [...document.querySelectorAll('[data-testid="claim-name"]')].some((b) => b.textContent.includes("สุดา คำดี"));
      await page.click('[data-testid="claim-change-type"]');
      await page.waitForSelector('[data-testid="claim-types"]');
      await page.click('[data-testid="claim-type-PN"]');
      await page.waitForFunction(showsPN);
      await page.reload();
      await page.waitForFunction(showsPN);
      await page.goBack();
      await page.waitForSelector('[data-testid="claim-types"]');
      await page.reload();
      await page.waitForSelector('[data-testid="claim-types"]');
      await sleep(400);
      assert((await page.locator('[data-testid="claim-names"]').count()) === 0, "a reload of the positions stays at the positions");
      await page.goForward();
      await page.waitForFunction(showsPN);
      await page.goBack();
      await page.waitForSelector('[data-testid="claim-types"]');
      await page.click('[data-testid="claim-type-RN"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="claim-type"]')?.textContent?.trim() === "พยาบาล");
      await page.waitForSelector('[data-testid="claim-name"]');
      // a name taken while its dialog is open: the message is shown above the list, with focus; the way on is the
      // administrator (plain text, no link)
      const kamol = "ปราณี สายบุญ";
      await page.locator('[data-testid="claim-name"]', { hasText: kamol }).click();
      await page.waitForSelector('[data-testid="claim-confirm"][open]');
      await db.query(
        "INSERT INTO user_claims (user_id, phone, line_sub) SELECT id, '0900000099', 'U-kamol-by-hand' FROM users WHERE first_name || ' ' || last_name = $1",
        [kamol],
      );
      await page.click('[data-testid="claim-confirm-yes"]');
      await page.waitForSelector('[data-testid="claim-error"]');
      await page.waitForFunction(() => document.activeElement?.dataset?.testid === "claim-error");
      assert((await plainText(page, '[data-testid="claim-error"]')) === CLAIM_TAKEN, `taken message: ${await plainText(page, '[data-testid="claim-error"]')}`);
      assert((await page.locator('[data-testid="claim-error"] a, [data-testid="claim-error-request"]').count()) === 0, "no link in the message");
      await page.waitForFunction((n) => [...document.querySelectorAll('[data-testid="claim-name"][data-claimed="true"]')].some((b) => b.textContent.includes(n)), kamol);
      assert((await currentClaim(db, kamol))?.line_sub === "U-kamol-by-hand", "the name stays with whoever took it first");
      await shoot(page, "claim-taken-race", { narrow: true });
      // released by hand, as README shows (no 24 h block)
      await db.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE phone = '0900000099' AND undone_at IS NULL");
      await pickName(page, "RN", DOC2_NAME, "สมหญิง");
      await page.click('[data-testid="claim-confirm-yes"]');
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === DOC2_NAME, `second account's name: ${await boardName(page)}`);
      const msgs = await waitForTelegram(before + 1);
      assert(msgs.length === before + 1 && msgs[before].text.startsWith(`🪪 ยืนยันชื่อ: ${DOC2_NAME} (พยาบาล · ${DOC2_DEPT})`), "claim message");
      const held = await db.query(
        "SELECT count(*)::int AS n FROM user_claims c JOIN users u ON u.id = c.user_id WHERE c.undone_at IS NULL AND u.active",
      );
      assert(held.rows[0].n === 2, "two names held");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("open redirect: next= pointing elsewhere is dropped by /api/auth/line/start", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
      for (const next of ["//evil.test/x", "https://evil.test/", "/\\evil.test", "/login/verify", "/api/auth/logout"]) {
        const ctx = await newContext(browser);
        const page = await ctx.newPage();
        await page.goto(`${APP}/api/auth/line/start?next=${encodeURIComponent(next)}`);
        await page.waitForLoadState("networkidle");
        const at = new URL(page.url());
        assert(at.origin === APP && at.pathname === "/" && at.search === "", `next=${next} -> ${page.url()}`);
        await ctx.close();
      }
    });

    await t("5 wrong codes lock the code (correct code is refused afterwards); a hostile LINE name is shown as text", async () => {
      await setIdentity({ sub: SUB_B, name: XSS_NAME });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      await lineLogin(page);
      // on the position step and on the number step
      for (const step of ["position", "phone"]) {
        if (step === "phone") await chooseType(page, "PCA");
        const who = await page.textContent('[data-testid="line-name"]');
        assert(who.includes(XSS_NAME), `literal name shown (${step}): ${who}`);
        assert((await page.locator('img[src="x"]').count()) === 0, `no injected <img> (${step})`);
        assert((await page.evaluate(() => window.__xss)) === undefined, `no script executed (${step})`);
      }
      // a landline is refused before anything is sent
      await page.fill("#phone", "02-123-4567");
      await page.click('button[type="submit"]');
      await page.waitForSelector("#phone-error");
      assert((await page.textContent("#phone-error")).includes("ใส่เบอร์มือถือ 10"), "invalid number message");
      assert((await page.getAttribute("#phone", "aria-invalid")) === "true", "the number is marked invalid");
      await page.waitForFunction(() => document.activeElement?.id === "phone", null, { timeout: 2000 });
      await page.keyboard.press("End");
      await page.keyboard.type("8");
      assert((await page.getAttribute("#phone", "aria-invalid")) === null, "editing the number clears the invalid mark");
      const tgBefore = (await telegramMessages()).length;
      const sms = await requestCode(page, LOCKED);
      const wrong = sms.pin === "000000" ? "111111" : "000000";
      for (let i = 1; i <= 5; i++) {
        await page.fill("#code", wrong);
        const expected = i < 5 ? `เหลืออีก ${5 - i} ครั้ง` : "ใส่รหัสผิดหลายครั้ง";
        // the server keeps the count with its unit by U+00A0
        await page.waitForFunction(
          (txt) => document.querySelector('[data-testid="otp-error"]')?.textContent?.replace(/ /g, " ").includes(txt),
          expected,
          { timeout: 5000 },
        );
        await page.waitForFunction(() => !document.querySelector("#code")?.value);
      }
      assert(await page.isDisabled("#code"), "code input disabled once locked");
      // the disabled field cannot hold focus: it goes to the error while the resend countdown runs (not to <body>)
      await page.waitForFunction(() => ["code-error", "resend"].includes(document.activeElement?.id || document.activeElement?.dataset?.testid), null, { timeout: 2000 });
      assert((await telegramMessages()).length === tgBefore, "no Telegram alert for a locked code");
      const r = await page.request.post(`${APP}/api/auth/otp/verify`, {
        headers: { origin: APP, "content-type": "application/json" },
        data: { phone: LOCKED, code: sms.pin },
      });
      const body = await r.json();
      assert(r.status() === 400 && body.reason === "locked", `locked: ${JSON.stringify(body)}`);
      assert(!(await cookie(ctx, "session")), "no session");
      const a = await db.query("SELECT attempts FROM otp_codes WHERE line_sub = $1", [SUB_B]);
      assert(a.rows[0].attempts === 5, `attempts=${a.rows[0].attempts}`);
      // "เปลี่ยนเบอร์" by keyboard: the button goes away with the code step, so focus must land on the number field
      // (with the number selected for retyping), not drop to <body>.
      await page.getByRole("button", { name: "เปลี่ยนเบอร์" }).focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector("#phone");
      const focused = await page.evaluate(() => document.activeElement?.id);
      assert(focused === "phone", `focus after change-number: ${focused || "body"}`);
      await page.keyboard.type("9");
      assert((await page.inputValue("#phone")) === "9", `number selected for retyping: ${await page.inputValue("#phone")}`);
      await ctx.close();
    });

    await t("unlisted number: same answer, a real SMS code, the code opens /login/claim?type=PN (no session); no typed names, no doctors by number", async () => {
      await setIdentity({ sub: SUB_C, name: "คนนอก" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const csp = [];
      trackCsp(page, csp);
      const tgBefore = (await telegramMessages()).length;
      await lineLogin(page);
      await chooseType(page, "PN");
      assert((await page.textContent('[data-testid="verify-type"]')).trim() === "ผู้ช่วยพยาบาล", "the chosen position");
      const sms = await requestCode(page, UNLISTED);
      const msg = (await page.textContent('[data-testid="otp-info"]')).trim();
      const shape = (m) => m.replace(/\d{3}-\d{3}-\d{4}/, "N").replace(/รหัสอ้างอิง \S+$/, "R");
      assert(shape(msg) === shape(genericMessage), `the same answer for listed and unlisted numbers: ${msg}`);
      assert(msg.includes(fmt(UNLISTED)) && msg.endsWith(sms.ref), "names this number and its reference");
      assert(/^\d{6}$/.test(sms.pin), "a real code was sent");
      // a wrong code gets exactly the same answer as for a listed number
      await page.fill("#code", sms.pin === "000000" ? "111111" : "000000");
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="otp-error"]')?.textContent?.replace(/\u00a0/g, " ").includes("เหลืออีก 4 ครั้ง"),
      );
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/login/claim?type=PN`);
      await page.waitForSelector('[data-testid="claim-names"]');
      assert((await page.textContent('[data-testid="claim-type"]')).trim() === "ผู้ช่วยพยาบาล", "the assistants' names, opened at once");
      const names = await page.$$eval('[data-testid="claim-name"] .font-semibold', (els) => els.map((e) => e.textContent.trim()));
      assert(JSON.stringify(names) === JSON.stringify(["สุดา คำดี"]), `PN names: ${JSON.stringify(names)}`);
      assert(!(await cookie(ctx, "session")), "no session");
      assert(!(await cookie(ctx, "pending"))?.value, "pending cleared");
      const access = await cookie(ctx, "access");
      assert(access?.httpOnly && access.sameSite === "Lax" && access.path === "/", "access cookie HttpOnly+Lax");
      assert(access.expires - Date.now() / 1000 > 11 * 3600 && access.expires - Date.now() / 1000 <= 12 * 3600 + 5, "access cookie ~12 h");
      assert((await page.textContent('[data-testid="request-phone"]')).trim() === fmt(UNLISTED), "verified number shown");
      assert((await page.textContent('[data-testid="line-name"]')) === "คนนอก", "LINE name shown");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'otp_verified_unlisted'", [SUB_C, UNLISTED]);
      assert(ev.rowCount === 1, "otp_verified_unlisted event logged");
      assert((await telegramMessages()).length === tgBefore, "no Telegram message before a name is claimed");

      // no typed names anywhere: the old request page goes on to the positions, and holds no form
      await page.goto(`${APP}/login/request`);
      assert(new URL(page.url()).pathname === "/login/claim" && new URL(page.url()).search === "", `/login/request -> ${page.url()}`);
      await page.waitForSelector('[data-testid="claim-types"]');
      assert((await page.locator("main input, main select, main textarea, #firstName, #lastName, #position").count()) === 0, "no field to type a name into");
      assert((await page.locator('[data-testid="request-form"]').count()) === 0, "no request form");
      // a doctor's position from the address is not a position for numbers: the list again (DR goes to the email sign-in)
      await page.goto(`${APP}/login/claim?type=DR`);
      await page.waitForSelector('[data-testid="claim-types"]');
      assert((await page.getAttribute('[data-testid="claim-type-DR"]', "href")) === "/login/doctor", "DR leads to the email sign-in");
      const headers = { origin: APP, "content-type": "application/json" };
      const drList = await page.request.get(`${APP}/api/auth/claim/list?type=DR`);
      const drListBody = await drList.json();
      assert(drList.status() === 400 && drListBody.reason === "doctor_email" && drListBody.redirect === "/login/doctor", `doctors' names by number: ${JSON.stringify(drListBody)}`);
      // and a doctor's name cannot be claimed with a number, free or not
      for (const name of [RACE_DOC, EMAIL_DOC]) {
        const dr = await page.request.post(`${APP}/api/auth/claim`, { headers, data: { userId: Number(await userId(db, name)) } });
        assert(dr.status() === 409 && (await dr.json()).reason === "unavailable", `claim a doctor by number -> ${dr.status()}`);
      }
      assert((await db.query("SELECT count(*)::int AS n FROM user_claims WHERE phone = $1", [UNLISTED])).rows[0].n === 0, "nothing claimed");
      for (const [method, path] of [["POST", "/api/auth/access/request"], ["POST", "/api/auth/access/complete"], ["GET", "/api/auth/access/status"]]) {
        const r = await page.request.fetch(`${APP}${path}`, {
          method,
          headers,
          ...(method === "POST" ? { data: { firstName: "คน", lastName: "นอก", position: "PN" } } : {}),
          maxRedirects: 0,
        });
        assert(r.status() === 404, `${method} ${path} (removed) -> ${r.status()}`);
      }
      assert((await db.query("SELECT count(*)::int AS n FROM access_requests")).rows[0].n === 0, "no access request stored");

      // verified the wrong number? a way back to the start (LINE again, then the position and another number)
      const other = page.locator('[data-testid="claim-types"] [data-testid="other-phone"]');
      assert((await other.textContent()).trim() === "ใช้เบอร์อื่น", "use another number link");
      await other.click();
      await page.waitForURL(`${APP}/login/verify`);
      await page.waitForSelector('[data-testid="verify-types"]');
      // still signed out everywhere else; /login offers the way back to the name step
      await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/login", "protected pages still redirect");
      assert((await page.getAttribute('[data-testid="claim-resume-link"]', "href")) === "/login/claim", "resume link on /login");
      assert((await page.locator('[data-testid="request-status-link"]').count()) === 0, "no request status link");
      await noLineLogin(page, "/login (resume)");
      await shoot(page, "login-resume");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      await ctx.close();
    });

    await t("deactivated user holding a claim: no session, the code leads to /login/claim; reactivated: the claim page offers the sign-in", async () => {
      const gated = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(RETIRED)}` });
      assert(gated.status === 307 && gated.location?.startsWith("/login"), `session of a deactivated number -> ${gated.status}`);
      await setIdentity({ sub: SUB_G, name: "หมอเกษียณ" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const before = (await telegramMessages()).length;
      await lineLogin(page);
      await chooseType(page, "RN");
      const sms = await requestCode(page, RETIRED);
      // a position that is not one for numbers (sent by hand): the claim page opens on the position list
      let sentAs = null;
      let verified = null;
      await page.route("**/api/auth/otp/verify", async (route) => {
        const body = route.request().postDataJSON();
        sentAs = body.as;
        const response = await route.fetch({ postData: JSON.stringify({ ...body, as: "DR" }) });
        verified = await response.json();
        await route.fulfill({ response });
      });
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/login/claim`);
      assert(sentAs === "RN", `the page sends the chosen position: ${sentAs}`);
      assert(verified.ok === true && verified.redirect === "/login/claim", `as=DR -> ${JSON.stringify(verified)}`);
      await page.waitForSelector('[data-testid="claim-types"]');
      await page.unroute("**/api/auth/otp/verify");
      assert(!(await cookie(ctx, "session")), "no session");
      await page.click('[data-testid="claim-type-RN"]');
      await page.waitForSelector('[data-testid="claim-names"]');
      const names = await page.$$eval('[data-testid="claim-name"] .font-semibold', (els) => els.map((e) => e.textContent.trim()));
      assert(!names.includes(RETIRED_NAME), "the deactivated name is not offered");
      const accessCookie = `access=${(await cookie(ctx, "access")).value}`;
      // back on the list (the claim page reads the table, not the 60 s cache): the number holds its name again, so the
      // claim page says so and offers the sign-in
      await db.query("UPDATE users SET active = true, updated_at = now() WHERE first_name || ' ' || last_name = $1", [RETIRED_NAME]);
      await page.reload();
      await page.waitForSelector('[data-testid="claim-signin"]');
      assert((await plainText(page, '[data-testid="claim-signin"] h2')) === "เบอร์นี้มีชื่อในระบบแล้ว", "the number holds a name");
      const signin = page.locator('[data-testid="claim-signin"] a');
      assert((await signin.textContent()).trim() === "เข้าสู่ระบบ" && (await signin.getAttribute("href")) === "/login", "sign-in link");
      assert((await page.locator('[data-testid="claim-types"], [data-testid="claim-names-step"]').count()) === 0, "no names offered");
      await noLineLogin(page, "/login/claim (signed in elsewhere)");
      // /login has nothing to resume for it (LINE signs it in), and the old request page goes on to the claim page
      const login = await rawRequest("/login", { host: `localhost:${APP_PORT}`, cookie: accessCookie });
      assert(login.status === 307 && login.location === "/api/auth/line/start", `/login for a listed number: ${login.status} ${login.location}`);
      const request = await rawRequest("/login/request", { host: `localhost:${APP_PORT}`, cookie: accessCookie });
      assert(request.status === 307 && request.location === "/login/claim", `/login/request: ${request.status} ${request.location}`);
      await db.query("UPDATE users SET active = false, updated_at = now() WHERE first_name || ' ' || last_name = $1", [RETIRED_NAME]);
      // off the list again: back to choosing. The reload keeps the step of its history entry (the names of พยาบาล,
      // picked above), and the deactivated name is not among them
      await page.reload();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="claim-type"]')?.textContent?.trim() === "พยาบาล" &&
          document.querySelectorAll('[data-testid="claim-name"]').length > 0,
      );
      const again = await page.$$eval('[data-testid="claim-name"] .font-semibold', (els) => els.map((e) => e.textContent.trim()));
      assert(!again.includes(RETIRED_NAME), "the deactivated name is not offered again");
      assert((await page.locator('[data-testid="claim-signin"]').count()) === 0, "no sign-in offered");
      assert((await telegramMessages()).length === before, "no Telegram message");
      await ctx.close();
    });

    await t("access requests are gone: an approved one from before authorizes nothing (no LINE fast path, the SMS code leads to the names); Telegram 'ox:' taps are invalid", async () => {
      // rows from before, as an approval in Telegram left them: an approved request with the LINE account bound to its
      // number, and one still pending
      const approved = await oldRequest(NURSE, SUB_D, "approved");
      const pendingId = await oldRequest(WALK_IN, SUB_E, "pending");
      await db.query("INSERT INTO line_bindings (line_sub, phone, display_name, verified_at, last_login_at) VALUES ($1, $2, 'มาลี', now(), now())", [SUB_D, NURSE]);
      const session = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(NURSE)}` });
      assert(session.status === 307 && session.location?.startsWith("/login"), `session of an approved number -> ${session.status} ${session.location}`);
      await setIdentity({ sub: SUB_D, name: "มาลี" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const tgBefore = (await telegramMessages()).length;
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `no fast path for an approved request: ${page.url()}`);
      await chooseType(page, "RN");
      const sms = await requestCode(page, NURSE);
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/login/claim?type=RN`);
      await page.waitForSelector('[data-testid="claim-names"]');
      assert(!(await cookie(ctx, "session")), "no session: the number has to pick its name from the list");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'otp_verified_unlisted'", [SUB_D, NURSE]);
      assert(ev.rowCount === 1, "verified as a number that holds no name");
      assert((await requestRow(approved)).status === "approved", "the old row is kept as it was");
      assert((await telegramMessages()).length === tgBefore, "no Telegram message (no sign-in alert, no request)");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();

      // Telegram: wrong or missing secret refused (nothing registered again: this instance registered it at the first claim)
      assert(webhookSecret && webhookPath, "the webhook was registered at the first claim");
      const setBefore = (await telegramCalls("setWebhook")).length;
      const approve = tapUpdate(`ox:${pendingId}:a`, ADMIN_ID, { chat_id: TG_CHAT, message_id: 9001 });
      for (const secret of [undefined, "", "wrong-secret", `${webhookSecret}x`]) {
        const r = await tgWebhook(webhookPath, approve, secret);
        assert(r.status === 401 && !r.body.includes("ox:"), `secret ${secret} -> ${r.status} ${r.body}`);
      }
      await sleep(300);
      assert((await telegramCalls("setWebhook")).length === setBefore, "refused calls cause no new setWebhook");
      // someone who is not an administrator: refused
      const answers = (await telegramCalls("answerCallbackQuery")).length;
      const edits = (await telegramCalls("editMessageText")).length;
      const stranger = await tgWebhook(webhookPath, tapUpdate(`ox:${pendingId}:a`, STRANGER_ID), webhookSecret);
      assert(stranger.status === 200 && stranger.body === '{"ok":true}', `stranger -> ${stranger.status} ${stranger.body}`);
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === answers + 1, "refusal answer");
      assert((await telegramCalls("answerCallbackQuery"))[answers].body.text === "คุณไม่มีสิทธิ์ดำเนินการนี้", "refusal text");
      // the approve and reject buttons of the former requests, tapped by the administrator: invalid, nothing changes
      for (const [i, data] of [`ox:${pendingId}:a`, `ox:${pendingId}:r`, `ox:${approved}:r`].entries()) {
        const r = await tgWebhook(webhookPath, tapUpdate(data, ADMIN_ID, { chat_id: TG_CHAT, message_id: 9001 }), webhookSecret);
        assert(r.status === 200 && r.body === '{"ok":true}', `${data} -> ${r.status} ${r.body}`);
        await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === answers + 2 + i, `answer to ${data}`);
        const text = (await telegramCalls("answerCallbackQuery"))[answers + 1 + i].body.text;
        assert(text === "คำสั่งไม่ถูกต้อง", `${data} answered as invalid: ${text}`);
      }
      const still = await requestRow(pendingId);
      assert(still.status === "pending" && still.decided_at === null && still.decided_by === null, `the pending row is untouched: ${JSON.stringify(still)}`);
      assert((await requestRow(approved)).status === "approved", "the approved row is untouched");
      await sleep(300);
      assert((await telegramCalls("editMessageText")).length === edits, "no message edited");
      assert((await smsIssued()).filter((m) => m.to === intl(WALK_IN)).length === 0, "nobody is told by SMS");
    });

    await t("break-glass ALLOWED_PHONES: signs in without a table row and shows the LINE name (as text), never an old request's name", async () => {
      // an approved request from before for the same number names nobody: the board and the alert show the LINE name
      await oldRequest(BREAK_GLASS, SUB_H, "approved");
      await setIdentity({ sub: SUB_H, name: "ผู้ดูแล <b>ฉุกเฉิน</b>" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const tgBefore = (await telegramMessages()).length;
      await lineLogin(page);
      await chooseType(page, "RN");
      // written the international way: the same number
      const sms = await requestCode(page, BREAK_GLASS, `+66 ${BREAK_GLASS.slice(1, 3)} ${BREAK_GLASS.slice(3, 6)} ${BREAK_GLASS.slice(6)}`);
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === "ผู้ดูแล <b>ฉุกเฉิน</b>", `LINE name for a number without a row: ${await boardName(page)}`);
      assert((await page.innerHTML('[data-testid="account-name"]')).includes("&lt;b&gt;"), "the LINE name is text, not markup");
      assert((await page.textContent('[data-testid="account-phone"]')).trim() === fmt(BREAK_GLASS), "formatted number");
      assert((await db.query("SELECT 1 FROM user_claims WHERE phone = $1", [BREAK_GLASS])).rowCount === 0, "holds no name");
      assert((await page.locator('[data-testid="account-role"]').count()) === 0, "no role without a name");
      const alert = await waitUntil(
        async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.includes(`📱 เบอร์: ${fmt(BREAK_GLASS)}`)),
        "verified alert",
      );
      assert(alert.text.startsWith("🆕") && alert.text.includes("\n🩺 ไม่พบในรายชื่อเจ้าหน้าที่\n"), `alert: ${alert.text}`);
      assert(!alert.text.includes("อนุมัติจากคำขอ") && !alert.text.includes("ขอ เข้าใช้"), "no request named in the alert");
      assert(alert.text.includes("&lt;b&gt;ฉุกเฉิน&lt;/b&gt;") && !alert.text.includes("<b>ฉุกเฉิน"), "LINE name escaped in the alert");
      await ctx.close();
    });

    await t("deeSMSX failures: no quota used, a clear Thai message, Telegram alerts; an outage at verify keeps the code", async () => {
      await setIdentity({ sub: SUB_I, name: "หมอสอง" });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const tgBefore = (await telegramMessages()).length;
      await lineLogin(page);
      await chooseType(page, "RN"); // a reload below keeps the position (?as=RN)
      const sendAndExpect = async (mode, message) => {
        await smsControl("fail", { mode });
        await page.fill("#phone", DOC2);
        await page.click('button[type="submit"]');
        await page.waitForFunction(
          (m) => document.querySelector("#phone-error")?.textContent?.replace(/ /g, " ").includes(m),
          message.replace(/ /g, " "),
          { timeout: 15_000 },
        );
        assert(await page.isVisible("#phone"), `still on the number step after ${mode}`);
      };
      const invalidMark = () => page.getAttribute("#phone", "aria-invalid");
      await sendAndExpect("102", "ส่ง SMS ไม่ได้ตอนนี้ ลองใหม่ภายหลัง");
      assert((await invalidMark()) === null, "no credit: the number is not marked invalid");
      await sendAndExpect("9", "ระบบยังไม่พร้อม ติดต่อผู้ดูแล");
      assert((await invalidMark()) === null, "settings: the number is not marked invalid");
      await sendAndExpect("99", "ส่ง SMS ไปเบอร์นี้ไม่ได้ ตรวจเบอร์อีกครั้ง");
      assert((await invalidMark()) === "true", "deeSMSX refused the number: marked invalid");
      const rows = await db.query("SELECT count(*)::int AS n FROM otp_codes WHERE line_sub = $1", [SUB_I]);
      assert(rows.rows[0].n === 0, `refused sends leave no row (no quota, no cooldown): ${rows.rows[0].n}`);
      const failedEv = await db.query("SELECT count(*)::int AS n FROM login_events WHERE line_sub = $1 AND event = 'otp_send_failed'", [SUB_I]);
      assert(failedEv.rows[0].n === 3, `otp_send_failed logged: ${failedEv.rows[0].n}`);
      // A gateway's HTML page: deeSMSX may have sent the SMS. The send counts (the row stays, unusable), the user
      // waits out the cooldown on the number step.
      await sendAndExpect("html", "ส่งรหัสไม่สำเร็จ รอ 1");
      assert((await invalidMark()) === null, "maybe sent: the number is not marked invalid");
      const kept = await db.query("SELECT code_hash, provider_token, expires_at <= created_at AS dead FROM otp_codes WHERE line_sub = $1", [SUB_I]);
      assert(kept.rows.length === 1 && kept.rows[0].dead && !kept.rows[0].code_hash && !kept.rows[0].provider_token, `maybe-sent row kept, unusable: ${JSON.stringify(kept.rows)}`);
      const uncertainEv = await db.query("SELECT count(*)::int AS n FROM login_events WHERE line_sub = $1 AND event = 'otp_send_uncertain'", [SUB_I]);
      assert(uncertainEv.rows[0].n === 1, `otp_send_uncertain logged: ${uncertainEv.rows[0].n}`);
      assert(await page.isDisabled('button[type="submit"]'), "the send button waits out the cooldown");
      assert((await page.textContent('button[type="submit"]')).includes("ส่งรหัสได้ใน"), `countdown on the button: ${await page.textContent('button[type="submit"]')}`);
      // Another number is not held back by that countdown.
      await page.fill("#phone", "0900000009");
      assert(!(await page.isDisabled('button[type="submit"]')), "another number may be tried");
      // Reloaded (no countdown in the page): the server's cooldown refuses it, and as no usable code exists for this
      // number the page stays on the number step instead of asking for a code that was never sent.
      const issuedBefore = (await smsIssued()).length;
      await page.reload();
      await page.fill("#phone", DOC2);
      await page.click('button[type="submit"]');
      await page.waitForSelector("#phone-error");
      assert((await page.textContent("#phone-error")).includes("ขอรหัสบ่อยเกินไป"), "cooldown message");
      assert(await page.isVisible("#phone"), "still on the number step: no code is pending");
      assert((await smsIssued()).length === issuedBefore, "deeSMSX is not asked during the cooldown");
      await db.query("DELETE FROM otp_codes WHERE line_sub = $1", [SUB_I]); // as if the minute had passed
      await page.reload();
      const alerts = await waitUntil(async () => {
        const m = (await telegramMessages()).slice(tgBefore).map((x) => x.text);
        return m.length >= 2 ? m : null;
      }, "SMS problem alerts");
      assert(alerts.some((x) => x.startsWith("💳 <b>เครดิต SMS หมด ส่งรหัสไม่ได้</b>") && x.includes("(รหัส 102)")), `no-credit alert: ${alerts.join(" | ")}`);
      assert(alerts.some((x) => x.startsWith("🛠 <b>ตั้งค่า SMS ไม่ถูกต้อง ส่งรหัสไม่ได้</b>") && x.includes("(รหัส 9)")), `settings alert: ${alerts.join(" | ")}`);

      // low credit: the send works and the administrators are told once
      await smsControl("credit", { balance: 50 });
      await page.fill("#phone", DOC2);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const sms = await waitForSms(DOC2, seenSms);
      await smsControl("credit", { balance: 5000 });
      const low = await waitUntil(async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.startsWith("💳 <b>เครดิต SMS ใกล้หมด</b>")), "low credit alert");
      assert(low.text.includes("เหลือ 49 เครดิต"), `low credit: ${low.text}`);

      // deeSMSX down while checking: "try again", the typed code stays, the attempt is not counted
      await smsControl("fail", { mode: "101" });
      await page.fill("#code", sms.pin);
      await page.waitForSelector('[data-testid="otp-error"]');
      assert((await page.textContent('[data-testid="otp-error"]')).includes("เกิดข้อผิดพลาด"), "outage message");
      assert((await page.inputValue("#code")) === sms.pin, "the code is kept for another try");
      const att = await db.query("SELECT attempts FROM otp_codes WHERE line_sub = $1", [SUB_I]);
      assert(att.rows[0].attempts === 0, `attempt refunded: ${att.rows[0].attempts}`);
      await page.click('form button[type="submit"]');
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === DOC2_NAME, "signed in on the second try");
      const verified = await waitUntil(
        async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.startsWith("⚠️") || m.text.startsWith("🆕")),
        "verified alert",
      );
      assert(verified.text.includes(`\n🩺 พยาบาล: ${DOC2_NAME} (${DOC2_DEPT})\n`), `alert names the claimed name: ${verified.text}`);
      await ctx.close();
    });

    await t("tampered state -> friendly error page, no session; cancelled login -> error page", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
      const ctx = await newContext(browser);
      const page = await ctx.newPage();
      const start = await page.request.get(`${APP}/api/auth/line/start`, { maxRedirects: 0 });
      assert(start.status() === 302, "start redirects");
      const authorize = start.headers()["location"];
      const auth = new URL(authorize);
      for (const k of ["response_type", "client_id", "redirect_uri", "state", "scope", "nonce", "code_challenge", "code_challenge_method", "ui_locales"]) {
        assert(auth.searchParams.get(k), `authorize has ${k}`);
      }
      assert(auth.searchParams.get("code_challenge_method") === "S256" && auth.searchParams.get("ui_locales") === "th", "S256 + th");
      assert(auth.searchParams.get("redirect_uri") === `${APP}/api/auth/line/callback`, "callback URL");
      const back = await page.request.get(authorize, { maxRedirects: 0 });
      const callback = new URL(back.headers()["location"]);
      callback.searchParams.set("state", `x${callback.searchParams.get("state")}`);
      await page.goto(callback.toString());
      assert(page.url().includes("/login/error?code=state"), `at ${page.url()}`);
      const text = await page.textContent('[data-testid="login-error"]');
      assert(text.includes("ลิงก์นี้ใช้ไม่ได้แล้ว") && !/error|stack|exception/i.test(text), "friendly Thai message");
      assert(!(await cookie(ctx, "session")), "no session");
      await touchTargets(page, "/login/error");
      await shoot(page, "login-error");

      await setIdentity({ sub: SUB_A, error: "access_denied" });
      await lineLogin(page);
      assert(page.url().includes("/login/error?code=cancelled"), `cancel -> ${page.url()}`);
      await noLineLogin(page, "/login/error (cancelled)");
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
      await ctx.close();
    });

    await t("logout clears the session; protected pages redirect again", async () => {
      assert(ctxA, "signed-in context from the first-login test");
      const page = await ctxA.newPage();
      await page.goto(`${APP}/`);
      assert(new URL(page.url()).pathname === "/", "still signed in");
      await page.click('[data-testid="user-menu"]');
      await page.click('[data-testid="logout"]');
      // Sign-out lands on /login?signed_out=1, which says so instead of signing straight back in.
      await page.waitForURL(`${APP}/login?signed_out=1`);
      assert((await page.textContent("h1")).trim() === "ออกจากระบบแล้ว", "signed-out page");
      assert(!(await cookie(ctxA, "session"))?.value, "session cookie cleared");
      // (not followed: /login would go straight on to LINE Login and sign back in)
      const after = await page.request.get(`${APP}/`, { maxRedirects: 0 });
      assert(after.status() === 307 && after.headers().location === "/login", `redirected after logout: ${after.status()} ${after.headers().location}`);
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'logout'", [SUB_A, DOC1]);
      assert(ev.rowCount === 1, "logout event logged");
      await ctxA.close();
    });

    await t("CSRF: POST without/with foreign Origin is rejected; non-JSON rejected", async () => {
      for (const path of ["/api/auth/otp/send", "/api/auth/otp/verify", "/api/auth/logout", "/api/auth/claim", "/api/auth/email/send", "/api/auth/email/verify", "/"]) {
        const none = await postJson(path, { phone: DOC1 });
        assert(none.status === 403, `${path} without Origin -> ${none.status}`);
        const evil = await postJson(path, { phone: DOC1 }, { origin: "https://evil.test" });
        assert(evil.status === 403, `${path} foreign Origin -> ${evil.status}`);
      }
      const ref = await postJson("/api/auth/logout", {}, { referer: "https://evil.test/x" });
      assert(ref.status === 403, "foreign Referer rejected");
      const text = await fetch(`${APP}/api/auth/otp/send`, {
        method: "POST",
        headers: { origin: APP, "content-type": "text/plain" },
        body: JSON.stringify({ phone: DOC1 }),
      });
      assert(text.status === 415, `text/plain -> ${text.status}`);
      const noPending = await postJson("/api/auth/otp/send", { phone: DOC1 }, { origin: APP });
      assert(noPending.status === 401, `no pending cookie -> ${noPending.status}`);
      for (const path of ["/api/auth/claim", "/api/auth/email/send", "/api/auth/email/verify"]) {
        const noAccess = await postJson(path, {}, { origin: APP });
        assert(noAccess.status === 401, `${path} without its cookie -> ${noAccess.status}`);
      }
      // the Telegram webhook takes no Origin (server to server) but needs the secret header
      const hook = await postJson(WEBHOOK_PATH, { update_id: 1 });
      assert(hook.status === 401, `webhook without Origin and secret -> ${hook.status}`);
    });

    await t("forged, unlisted or pre-SMS session tokens are rejected; the break-glass ALLOWED_PHONES still works", async () => {
      for (const phone of [DOC1, BREAK_GLASS]) {
        const ok = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${await sessionToken(phone)}` });
        assert(ok.status === 200, `valid token for ${fmt(phone)} -> ${ok.status}`);
      }
      const legacy = await new SignJWT({ email: "someone@example.com", name: "x", picture: null })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("Ux")
        .setIssuer("orskh")
        .setAudience("session")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(SESSION_SECRET));
      for (const token of [
        await sessionToken("0899999999"),
        await sessionToken(fmt(DOC1)), // not the canonical form the app signs
        await sessionToken(DOC1, "wrong-secret-wrong-secret-wrong-secret"),
        legacy,
      ]) {
        const r = await rawRequest("/", { host: `localhost:${APP_PORT}`, cookie: `session=${token}` });
        assert(r.status === 307 && r.location?.startsWith("/login"), `rejected -> ${r.status}`);
      }
    });

    await t("admin: the button and menu link only for a sub in AUTH_ADMIN_LINE_IDS; /admin is 404 for everyone else", async () => {
      const headers = (token) => ({ host: `localhost:${APP_PORT}`, cookie: `session=${token}` });
      const anon = await rawRequest("/admin", { host: `localhost:${APP_PORT}` });
      assert(anon.status === 307 && anon.location === "/login?next=%2Fadmin", `signed out: ${anon.status} ${anon.location}`);
      // signed in with an authorized number but a sub that is not an admin: same page as a mistyped address
      for (const token of [await sessionToken(DOC1), await sessionToken(DOC1, SESSION_SECRET, SUB_A)]) {
        const r = await rawRequest("/admin", headers(token));
        assert(r.status === 404, `non-admin /admin -> ${r.status}`);
        // not even the loading screen: nothing of the admin page reaches a non-admin
        const body = await (await fetch(`${APP}/admin`, { headers: { cookie: `session=${token}` }, redirect: "manual" })).text();
        assert(!body.includes("จัดการระบบ") && !body.includes("รายชื่อทั้งหมด"), "no admin page or loading screen for a non-admin");
        const html = await (await fetch(`${APP}/`, { headers: { cookie: `session=${token}` } })).text();
        assert(!html.includes('href="/admin"'), "no admin link on a non-admin's board");
        // the test notices are for admins only: checked on a day with its upload, in the 16:00 test below
      }
      // an admin sub with a number that is not authorized gets no session at all
      const unlisted = await rawRequest("/admin", headers(await sessionToken("0899999999", SESSION_SECRET, ADMIN_SUB)));
      assert(unlisted.status === 307 && unlisted.location?.startsWith("/login"), `admin sub, unlisted number -> ${unlisted.status}`);
      // an admin sub with an authorized number opens the page
      const admin = await fetch(`${APP}/admin`, { headers: { cookie: `session=${await sessionToken(DOC2, SESSION_SECRET, ADMIN_SUB)}` }, redirect: "manual" });
      const adminHtml = await admin.text();
      // the page is named for all it holds (the repair's dates, MX, everyone's names), not one list alone
      assert(admin.status === 200 && adminHtml.includes("จัดการระบบ") && adminHtml.includes("รายชื่อทั้งหมด"), `admin /admin -> ${admin.status}`);

      const ctx = await newContext(browser);
      await ctx.addCookies([{ name: "session", value: await sessionToken(DOC2, SESSION_SECRET, ADMIN_SUB), url: APP, httpOnly: true, sameSite: "Lax" }]);
      const page = await ctx.newPage();
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await boardName(page)) === DOC2_NAME, `admin's name from the table: ${await boardName(page)}`);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 780 });
        await noSideScroll(page, `admin board at ${width}px`);
        const button = page.locator('[data-testid="admin-button"]');
        // below 390px the header button would cut the year off the date; the account menu's link stands in
        assert((await button.isVisible()) === (width >= 390), `admin button visible at ${width}px: ${await button.isVisible()}`);
        assert((await button.getAttribute("href")) === "/admin", "admin button opens /admin");
        // named for the whole page (the repair's dates, MX and the surgeon list), not the surgeon list alone
        assert((await button.getAttribute("aria-label")) === "จัดการระบบ", `admin button's name: ${await button.getAttribute("aria-label")}`);
        await page.click('[data-testid="user-menu"]');
        const menu = page.locator('[data-testid="account-menu"]');
        await menu.waitFor({ state: "visible" });
        const link = page.locator('[data-testid="account-admin-link"]');
        assert((await link.isVisible()) && (await link.getAttribute("href")) === "/admin", "admin link in the account menu");
        assert(((await link.textContent()) ?? "").trim() === "จัดการระบบ", `the menu link's words: ${await link.textContent()}`);
        assert(((await link.boundingBox())?.height ?? 0) >= 44, "admin link is a 44px target");
        const file = `board-admin-menu-${width}.png`;
        await page.screenshot({ path: join(SCREENS, file) });
        shots.push(file);
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
      }
      // Test mode (Pong, 15 Nov 2026): the admin page links to the board with every kind of notice in the strip at once
      assert(adminHtml.includes('href="/?notices=all"'), "the admin page links to the test notices");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${APP}/?notices=all`, { waitUntil: "networkidle" });
      const kinds = await page.$$eval('[data-testid="notice-strip"] .notice-badge', (els) => els.map((el) => el.dataset.noticeId));
      // since 16 Nov 2026 the only kind is ยังไม่มีตาราง HOSxP (Pong: no วันหยุด, โหลดไม่สำเร็จ or ไม่ตรง badges)
      assert(JSON.stringify(kinds) === JSON.stringify(["no-upload"]), `every notice: ${JSON.stringify(kinds)}`);
      await noSideScroll(page, "the test notices at 390px");
      for (const [file, open] of [["board-test-notices.png", null], ["board-test-notices-open.png", "no-upload"]]) {
        if (open) {
          await page.click(`[data-notice-id="${open}"]`);
          await page.waitForSelector('[data-testid="notice-bubble"]');
          await page.waitForTimeout(400);
        }
        await page.screenshot({ path: join(SCREENS, file) });
        shots.push(file);
      }
      await ctx.close();
    });

    await t("the sign-in steps without their cookie go back to /login; the old /login/request goes on to /login/claim", async () => {
      for (const path of ["/login/verify", "/login/verify?as=RN", "/login/verify?as=DR", "/login/claim", "/login/claim?type=RN", "/login/doctor"]) {
        const r = await rawRequest(path, { host: `localhost:${APP_PORT}` });
        assert(r.status === 307 && r.location === "/login", `${path}: ${r.status} ${r.location}`);
      }
      const request = await rawRequest("/login/request", { host: `localhost:${APP_PORT}` });
      assert(request.status === 307 && request.location === "/login/claim", `/login/request: ${request.status} ${request.location}`);
      const list = await fetch(`${APP}/api/auth/claim/list?type=RN`);
      assert(list.status === 401, `claim list without access cookie -> ${list.status}`);
      const status = await fetch(`${APP}/api/auth/access/status`, { redirect: "manual" });
      assert(status.status === 404, `the removed request status -> ${status.status}`);
    });

    await t("local file mode (SMS_PROVIDER=file): the app makes the code, writes the SMS to a file; SMS_DAILY_CAP stops sending", async () => {
      // the same build, a second server: local mode, and a daily cap two sends above what was sent so far
      const sent = (await db.query("SELECT count(*)::int AS n FROM otp_codes WHERE created_at > now() - interval '24 hours'")).rows[0].n;
      const cap = sent + 2;
      // Telegram only to a group: alerts still go out, but nobody could tap undo (no person's id in TELEGRAM_CHAT_ID).
      // Claims work all the same (they used to be off here): the confirm step says to ask the administrator instead.
      const fileEnv = {
        ...appEnv,
        APP_URL: FILE_APP,
        SMS_PROVIDER: "file",
        SMS_OUTBOX_DIR: OUTBOX,
        SMS_DAILY_CAP: String(cap),
        TELEGRAM_CHAT_ID: "-1001234567890",
      };
      for (const k of ["DEESMSX_API_KEY", "DEESMSX_SECRET_KEY", "DEESMSX_API_URL"]) delete fileEnv[k];
      fileApp = startProcess("app-file", ["node_modules/next/dist/bin/next", "start", "-p", String(FILE_APP_PORT)], fileEnv);
      await waitFor(`${FILE_APP}/login`, fileApp);
      const smsBefore = (await smsIssued()).length;
      const tgBefore = (await telegramMessages()).length;

      // 1: a full sign-in with the code from the file
      await setIdentity({ sub: SUB_J, name: "หมอสาม" });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      await lineLogin(page, undefined, FILE_APP);
      assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
      await chooseType(page, "RN");
      await page.fill("#phone", fmt(DOC1));
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const file = await waitForSmsFile(DOC1, seenFiles);
      assert(/^\d{6}$/.test(file.code) && /^[A-Z2-9]{4}$/.test(file.ref) && !Number.isNaN(Date.parse(file.at)), `file: ${JSON.stringify({ ref: file.ref, at: file.at })}`);
      assert(file.text === `รหัส ORSKH ของคุณคือ ${file.code} ใช้ได้ 5 นาที ห้ามบอกผู้อื่น`, `SMS text: ${file.text}`);
      assert(!/https?:|www\.|\.com|\.app/i.test(file.text) && file.text.length <= 70, "one SMS, no link");
      assert((await page.textContent('[data-testid="otp-ref"]')) === file.ref, "the file's reference is on screen");
      const row = await db.query("SELECT code_hash, provider_token FROM otp_codes WHERE line_sub = $1", [SUB_J]);
      assert(row.rows[0].code_hash && !row.rows[0].code_hash.includes(file.code) && row.rows[0].provider_token === null, "local mode stores an HMAC only");
      await page.fill("#code", file.code);
      await page.waitForURL(`${FILE_APP}/`);
      assert((await boardName(page)) === DOC1_NAME, `signed in by file mode: ${await boardName(page)}`);
      await ctx.close();

      // 2: the second send reaches the cap exactly; the number holds no name and claims one (no undo administrator here)
      await setIdentity({ sub: SUB_K, name: "คนที่สอง" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page, undefined, FILE_APP);
      await chooseType(page, "PCA");
      await page.fill("#phone", UNLISTED);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="otp-info"]');
      const unlistedFile = await waitForSmsFile(UNLISTED, seenFiles);
      await page.fill("#code", unlistedFile.code);
      await page.waitForURL(`${FILE_APP}/login/claim?type=PCA`);
      await page.waitForSelector('[data-testid="claim-names"]');
      assert((await page.textContent('[data-testid="claim-type"]')).trim() === "พนักงานช่วยเหลือคนไข้", "the PCA names, opened at once");
      const pca = "บุญมี ใจซื่อ";
      await pickName(page, "PCA", pca);
      const note = await plainText(page, "#claim-confirm-note");
      assert(
        note === `ชื่อนี้จะผูกกับเบอร์ ${fmt(UNLISTED)} และบัญชี LINE นี้ แล้วผู้อื่นจะเลือกชื่อนี้ไม่ได้อีก หากเลือกผิด กรุณาติดต่อผู้ดูแล`,
        `without an administrator to undo, the dialog says to ask one: ${note}`,
      );
      assert(!note.includes("24 ชั่วโมง"), "no undo promised");
      await shoot(page, "claim-confirm-no-undo", { narrow: true, full: false });
      await page.click('[data-testid="claim-confirm-yes"]');
      await page.waitForURL(`${FILE_APP}/`);
      assert((await boardName(page)) === pca, `claimed on the file-mode server: ${await boardName(page)}`);
      const pcaClaim = await currentClaim(db, pca);
      assert(pcaClaim?.phone === UNLISTED && pcaClaim.line_sub === SUB_K, "the claim holds the number and the LINE account");
      // Telegram is set up (a group), so the claim is announced there all the same
      const announced = await waitUntil(
        async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.startsWith(`🪪 ยืนยันชื่อ: ${pca}`)),
        "claim message to the group",
      );
      assert(announced.chat_id === "-1001234567890", `to the group: ${announced.chat_id}`);
      assert(!announced.reply_markup, `no undo button nobody could tap: ${JSON.stringify(announced.reply_markup)}`);
      await ctx.close();

      // 3: over the cap: nobody gets a code, a Thai message, the administrators are told
      await setIdentity({ sub: SUB_L, name: "คนที่สาม" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page, undefined, FILE_APP);
      await chooseType(page, "RN");
      const files = outboxFiles().length;
      await page.fill("#phone", CAPPED);
      await page.click('button[type="submit"]');
      await page.waitForSelector("#phone-error");
      const err = (await page.textContent("#phone-error")).trim();
      assert(err === "วันนี้ส่ง SMS ครบจำนวนแล้ว ติดต่อผู้ดูแล", `cap message: ${err}`);
      assert((await page.getAttribute("#phone", "aria-invalid")) === null, "the cap does not mark a valid number invalid");
      await sleep(500);
      assert(outboxFiles().length === files, "nothing sent over the cap");
      const capAlert = await waitUntil(
        async () => (await telegramMessages()).slice(tgBefore).find((m) => m.text.startsWith("🛑 <b>ส่ง SMS ครบเพดานของวันแล้ว หยุดส่งรหัส</b>")),
        "cap alert",
      );
      assert(capAlert.text.includes(`ส่งครบ ${cap.toLocaleString("en-US")} ครั้ง`), `cap alert: ${capAlert.text}`);
      const capEv = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'otp_daily_cap'", [SUB_L, CAPPED]);
      assert(capEv.rowCount === 1, "otp_daily_cap logged");
      assert((await db.query("SELECT 1 FROM otp_codes WHERE line_sub = $1", [SUB_L])).rowCount === 0, "no row over the cap");
      assert((await smsIssued()).length === smsBefore, "file mode never calls deeSMSX");
      await ctx.close();
    });

    await t("Telegram undo: the claim is released, the user is signed out, and the number cannot claim again for 24 h", async () => {
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/", `binding fast path: ${page.url()}`);
      assert((await boardName(page)) === DOC1_NAME, "signed in with the claimed name");
      const claim = (await db.query("SELECT id::text AS id, tg_messages FROM user_claims WHERE phone = $1 AND undone_at IS NULL", [DOC1])).rows[0];
      const usersBeforeUndo = await usersSnapshot(db);
      const msg = (await telegramMessages()).find((m) => m.message_id === claim.tg_messages[0].message_id);
      assert(msg?.text.startsWith(`🪪 ยืนยันชื่อ: ${DOC1_NAME}`), "the claim message");
      const answers = (await telegramCalls("answerCallbackQuery")).length;
      const edits = (await telegramCalls("editMessageText")).length;
      // someone who is not an administrator: refused, nothing changes
      const stranger = await tgWebhook(webhookPath, tapUpdate(`oc:${claim.id}:u`, STRANGER_ID, msg), webhookSecret);
      assert(stranger.status === 200, `stranger -> ${stranger.status}`);
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === answers + 1, "refusal answer");
      assert((await db.query("SELECT undone_at FROM user_claims WHERE id = $1", [claim.id])).rows[0]?.undone_at === null, "still claimed");
      // the administrator undoes it
      const r = await tgWebhook(webhookPath, tapUpdate(`oc:${claim.id}:u`, ADMIN_ID, msg), webhookSecret);
      assert(r.status === 200 && r.body === '{"ok":true}', `undo -> ${r.status} ${r.body}`);
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === answers + 2, "undo answer");
      const answer = (await telegramCalls("answerCallbackQuery"))[answers + 1].body.text;
      assert(answer === "ยกเลิกการยืนยันชื่อแล้ว ผู้ใช้นี้จะออกจากระบบภายใน 1 นาที", `undo answer: ${answer}`);
      const edit = await waitUntil(async () => (await telegramCalls("editMessageText"))[edits], "edited claim message");
      assert(edit.body.message_id === msg.message_id && edit.body.text.startsWith(`${msg.text}\n\n↩️ ยกเลิกแล้ว โดย `), `edited: ${edit.body.text}`);
      assert(edit.body.reply_markup === undefined, "undo button removed");
      assert((await currentClaim(db, DOC1_NAME)) === undefined, "the name is free again");
      const undone = await db.query("SELECT undone_at, undone_by::text AS by, undo_reason FROM user_claims WHERE id = $1", [claim.id]);
      assert(undone.rows[0].undone_at && undone.rows[0].by === String(ADMIN_ID) && undone.rows[0].undo_reason === "admin", "undo recorded with who and why");
      assert((await usersSnapshot(db)) === usersBeforeUndo, "the undo did not write users");
      assert((await db.query("SELECT 1 FROM line_bindings WHERE phone = $1", [DOC1])).rowCount === 0, "bindings of the number removed");
      assert((await db.query("SELECT 1 FROM login_events WHERE phone = $1 AND event = 'claim_undone'", [DOC1])).rowCount === 1, "claim_undone logged");
      // a second tap: already done
      await tgWebhook(webhookPath, tapUpdate(`oc:${claim.id}:u`, ADMIN_ID, msg), webhookSecret);
      await waitUntil(async () => (await telegramCalls("answerCallbackQuery")).length === answers + 3, "second answer");
      assert((await telegramCalls("answerCallbackQuery"))[answers + 2].body.text === "ดำเนินการไปแล้ว", "already done");
      // the open session is refused at once on this instance (the cache is told)
      const refused = await page.request.get(page.url(), { maxRedirects: 0 });
      const to = refused.headers().location ?? "";
      assert(refused.status() === 307 && to.startsWith("/login"), `session refused after the undo: ${refused.status()} ${to}`);
      await ctx.close();

      // signing in again: the code works, but the claim page is blocked for 24 h (the API too); the way on is the
      // administrator (no request button). The first login's code to this number and LINE account may be less than a
      // minute old in a fast run: as if the minute had passed.
      await db.query("UPDATE otp_codes SET created_at = created_at - interval '1 minute' WHERE line_sub = $1 AND phone = $2", [SUB_A, DOC1]);
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `binding gone: ${page.url()}`);
      await chooseType(page, "RN");
      const sms = await requestCode(page, DOC1);
      await page.fill("#code", sms.pin);
      await page.waitForURL(`${APP}/login/claim?type=RN`);
      await page.waitForSelector('[data-testid="claim-blocked"]');
      // the undone claim was this LINE account's: another number would end here too, so none is offered
      const blocked = await plainText(page, '[data-testid="claim-blocked"] p');
      assert(
        blocked === "ผู้ดูแลยกเลิกชื่อของ LINE นี้แล้ว เลือกใหม่ได้หลัง 24 ชั่วโมง หรือติดต่อผู้ดูแล",
        `blocked text: ${blocked}`,
      );
      assert((await page.locator('[data-testid="claim-types"], [data-testid="claim-names-step"]').count()) === 0, "no names offered");
      assert((await page.locator('[data-testid="claim-blocked"] a[href="/login/request"]').count()) === 0, "no access request button");
      assert((await page.locator('[data-testid="claim-blocked"] [data-testid="other-phone"]').count()) === 0, "no other number offered");
      await touchTargets(page, "/login/claim (blocked)");
      await shoot(page, "claim-blocked");
      const headers = { origin: APP, "content-type": "application/json" };
      for (const name of [DOC1_NAME, "กมล ทองดี"]) {
        const c = await page.request.post(`${APP}/api/auth/claim`, { headers, data: { userId: Number(await userId(db, name)) } });
        const cBody = await c.json();
        assert(
          c.status() === 403 && cBody.reason === "blocked" && cBody.by === "line" && cBody.error.replace(/\s+/g, " ") === blocked,
          `claim after an undo -> ${c.status()} ${JSON.stringify(cBody)}`,
        );
      }
      assert((await db.query("SELECT count(*)::int AS n FROM user_claims WHERE phone = $1 AND undone_at IS NULL", [DOC1])).rows[0].n === 0, "nothing claimed");
      assert((await db.query("SELECT 1 FROM login_events WHERE phone = $1 AND event = 'claim_refused'", [DOC1])).rowCount === 2, "refusals logged");
      await ctx.close();

      // the same number verified by another LINE account: the block is only the number's, so another number is offered
      await db.query("UPDATE otp_codes SET created_at = created_at - interval '61 minutes'"); // as if an hour had passed (SMS limits)
      await setIdentity({ sub: SUB_R, name: "อีกบัญชี" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `another LINE account: ${page.url()}`);
      await chooseType(page, "RN");
      const smsOther = await requestCode(page, DOC1);
      await page.fill("#code", smsOther.pin);
      await page.waitForURL(`${APP}/login/claim?type=RN`);
      await page.waitForSelector('[data-testid="claim-blocked"]');
      const byNumber = await plainText(page, '[data-testid="claim-blocked"] p');
      assert(
        byNumber === "ผู้ดูแลยกเลิกชื่อของเบอร์นี้แล้ว เลือกใหม่ได้หลัง 24 ชั่วโมง หรือติดต่อผู้ดูแล",
        `blocked text (number): ${byNumber}`,
      );
      const otherPhone = page.locator('[data-testid="claim-blocked"] [data-testid="other-phone"]');
      assert((await otherPhone.count()) === 1 && (await otherPhone.textContent()).trim() === "ใช้เบอร์อื่น", "another number offered");
      await shoot(page, "claim-blocked-number");
      const byNumberClaim = await page.request.post(`${APP}/api/auth/claim`, { headers, data: { userId: Number(await userId(db, DOC1_NAME)) } });
      const byNumberBody = await byNumberClaim.json();
      assert(
        byNumberClaim.status() === 403 && byNumberBody.reason === "blocked" && byNumberBody.by === "phone" && byNumberBody.error.replace(/\s+/g, " ") === byNumber,
        `claim after an undo, another LINE account -> ${byNumberClaim.status()} ${JSON.stringify(byNumberBody)}`,
      );
      await ctx.close();
      await setIdentity({ sub: SUB_A, name: LINE_NAME_A });
    });

    await t("doctor: LINE -> position แพทย์ -> name -> code by email -> board; a Telegram notice without a button; next time LINE alone", async () => {
      await db.query(
        "INSERT INTO user_emails (user_id, email) SELECT u.id, e FROM users u, unnest($2::text[]) e WHERE u.first_name || ' ' || u.last_name = $1",
        [EMAIL_DOC, EMAIL_DOC_ADDRESSES],
      );
      await setIdentity({ sub: SUB_DOC, name: "หมอกมล" });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const csp = [];
      trackCsp(page, csp);
      const before = (await telegramMessages()).length;
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `at ${page.url()}`);
      // doctors pick their position like everyone else, and are never offered the SMS form
      await page.waitForSelector('[data-testid="verify-types"]');
      await page.click('[data-testid="verify-type-DR"]');
      await page.waitForURL(`${APP}/login/doctor`);
      await page.waitForSelector('[data-testid="doctor-pick-step"]');
      assert((await page.locator("#phone").count()) === 0, "no number field for a doctor");
      assert((await page.textContent("h1")).includes("แพทย์ ยืนยันตัวตนทางอีเมล"), `title: ${await page.textContent("h1")}`);
      const names = await page.$$eval('[data-testid="doctor-name"] .font-semibold', (els) => els.map((e) => e.textContent.trim()));
      assert(names.length === 4 && names.includes(EMAIL_DOC) && !names.includes(DOC1_NAME), `doctors only: ${JSON.stringify(names)}`);
      const html = await page.content();
      assert(!EMAIL_DOC_ADDRESSES.some((a) => html.includes(a)), "no address leaves the server with the list");
      const none = page.locator('[data-testid="doctor-name"]', { hasText: NO_EMAIL_DOC });
      assert((await none.isDisabled()) && (await none.getAttribute("data-no-email")) === "true", "a doctor without an address cannot be picked");
      assert((await page.locator('[data-testid="doctor-name"][data-claimed="true"]').count()) === 0, "no doctor's name is held yet");
      assert((await page.textContent("#doctor-count")).trim() === "4 รายชื่อ · เลือกได้ 1", `count: ${await page.textContent("#doctor-count")}`);
      const smsLink = page.locator('[data-testid="doctor-sms-link"]');
      assert((await smsLink.getAttribute("href")) === "/login/verify", "the way back to the positions");
      assert((await smsLink.textContent()).trim() === "ไม่ใช่แพทย์? เลือกตำแหน่งอื่น", `back link: ${await smsLink.textContent()}`);
      assert((await plainText(page, '[data-testid="doctor-pick-step"] [data-testid="ask-admin"]')) === ASK_ADMIN, "ask the administrator");
      await noLineLogin(page, "/login/doctor (names)");
      await touchTargets(page, "/login/doctor (names)");
      await shoot(page, "doctor-names", { narrow: true });
      // and back: the positions again, then แพทย์
      await smsLink.click();
      await page.waitForSelector('[data-testid="verify-types"]');
      await page.click('[data-testid="verify-type-DR"]');
      await page.waitForSelector('[data-testid="doctor-pick-step"]');

      await page.fill('[data-testid="doctor-search"]', "กมล");
      await page.locator('[data-testid="doctor-name"]', { hasText: EMAIL_DOC }).click();
      await page.waitForSelector('[data-testid="doctor-send-step"]');
      assert((await page.textContent('[data-testid="doctor-selected"]')).trim() === EMAIL_DOC, "the chosen name");
      await shoot(page, "doctor-send", { narrow: true });
      const mailsBefore = emailFiles().length;
      await page.click('[data-testid="doctor-send"]');
      await page.waitForSelector('[data-testid="doctor-code-step"]');
      const sentTo = await page.textContent('[data-testid="doctor-sent-to"]');
      assert(sentTo.includes("ka•••@example.com") && sentTo.includes("k•••@example.org"), `masked addresses: ${sentTo}`);
      assert(!EMAIL_DOC_ADDRESSES.some((a) => sentTo.includes(a)), "only masked addresses are shown");
      assert((await page.evaluate(() => document.activeElement?.id)) === "email-code", "focus on the code field");
      const mail = await waitForEmail(mailsBefore);
      assert(JSON.stringify(mail.to) === JSON.stringify(EMAIL_DOC_ADDRESSES), `one email to every address: ${JSON.stringify(mail.to)}`);
      assert(/^\d{6}$/.test(mail.code) && mail.subject === `รหัสเข้าสู่ระบบ ORSKH: ${mail.code}`, `subject: ${mail.subject}`);
      assert(mail.text.includes(EMAIL_DOC) && !/https?:/.test(mail.text), "the email names the doctor and has no link");
      await touchTargets(page, "/login/doctor (code)");
      await shoot(page, "doctor-code", { narrow: true });

      // a wrong code first, then the one from the email (Thai digits too)
      await page.fill("#email-code", mail.code === "000000" ? "111111" : "000000");
      await page.waitForSelector('[data-testid="doctor-error"]');
      assert((await page.textContent('[data-testid="doctor-error"]')).replace(/\u00a0/g, " ").includes("เหลืออีก 4"), "attempts left");
      await page.fill("#email-code", mail.code.replace(/\d/g, (d) => String.fromCharCode(0x0e50 + Number(d))));
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === EMAIL_DOC, `the doctor's name: ${await boardName(page)}`);
      assert((await page.locator('[data-testid="account-phone"]').count()) === 0, "no number in the account menu");
      assert((await page.textContent('[data-testid="account-role"]')).trim() === EMAIL_DOC_ROLE, "role in the account menu");
      const session = await cookie(ctx, "session");
      const payload = JSON.parse(Buffer.from(session.value.split(".")[1], "base64url").toString("utf8"));
      assert(payload.uid === (await userId(db, EMAIL_DOC)) && payload.phone === undefined, `session carries the user id: ${JSON.stringify(payload)}`);
      assert(!(await cookie(ctx, "pending"))?.value, "pending cleared");
      const claim = await currentClaim(db, EMAIL_DOC);
      assert(claim?.phone === null && claim.line_sub === SUB_DOC, `an email claim without a number: ${JSON.stringify(claim)}`);
      const via = await db.query("SELECT via, email_verified_at IS NOT NULL AS verified FROM user_claims WHERE id = $1", [claim.id]);
      assert(via.rows[0].via === "email" && via.rows[0].verified, "via email, verified now");
      const msgs = await waitForTelegram(before + 1);
      assert(msgs[before].text.startsWith(`📧 แพทย์ยืนยันตัวตนทางอีเมล: ${EMAIL_DOC} (${EMAIL_DOC_ROLE})`), `notice: ${msgs[before].text}`);
      assert(!msgs[before].reply_markup, "no undo button");
      await page.waitForLoadState("networkidle");
      assert(csp.length === 0, `CSP violations: ${csp.join(" | ")}`);
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();

      // the next sign-in of this LINE account needs no code
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/", `email binding fast path: ${page.url()}`);
      assert((await boardName(page)) === EMAIL_DOC, "signed in as the doctor");
      const ev = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'login_email_binding'", [SUB_DOC]);
      assert(ev.rowCount === 1, "login_email_binding logged");
      await ctx.close();
    });

    await t("doctors sign in by email only: a doctor's name held by number signs nobody in and locks nothing; an email claim locks the name for every other LINE account (no code is emailed)", async () => {
      const phoneDocId = await userId(db, PHONE_DOC);
      const raceId = await userId(db, RACE_DOC);
      const emailDocId = await userId(db, EMAIL_DOC);
      // a claim of a doctor's name by number, made by hand (as the doctors who claimed by SMS before the email sign-in)
      await db.query("INSERT INTO user_claims (user_id, phone, line_sub, line_name, via) VALUES ($1, $2, $3, 'หมอสมใจ', 'phone')", [phoneDocId, PHONE_DOC_PHONE, SUB_P]);
      await db.query("INSERT INTO line_bindings (line_sub, phone, display_name, verified_at, last_login_at) VALUES ($1, $2, 'หมอสมใจ', now(), now())", [SUB_P, PHONE_DOC_PHONE]);

      // 1: that LINE account gets no fast path (a fresh binding to the number), and an SMS code for the number, under a
      // nurses' position, signs nobody in either: the number is treated as holding no name
      await setIdentity({ sub: SUB_P, name: "หมอสมใจ" });
      let ctx = await newContext(browser);
      let page = await ctx.newPage();
      let mails = emailFiles().length;
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `no LINE fast path for a doctor's name held by number: ${page.url()}`);
      assert(!(await cookie(ctx, "session")), "no session");
      await chooseType(page, "RN");
      const phoneSms = await requestCode(page, PHONE_DOC_PHONE);
      await page.fill("#code", phoneSms.pin);
      await page.waitForURL(`${APP}/login/claim?type=RN`);
      await page.waitForSelector('[data-testid="claim-names"]');
      assert(!(await cookie(ctx, "session")), "the SMS code gives no session for a doctor's name");
      const unlisted = await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND phone = $2 AND event = 'otp_verified_unlisted'", [SUB_P, PHONE_DOC_PHONE]);
      assert(unlisted.rowCount === 1, "verified as a number that holds no name");
      const headers = { origin: APP, "content-type": "application/json" };
      const byNumber = await page.request.post(`${APP}/api/auth/claim`, { headers, data: { userId: Number(phoneDocId) } });
      const byNumberBody = await byNumber.json();
      assert(byNumber.status() === 409 && byNumberBody.reason === "unavailable", `the doctor's own name by number -> ${byNumber.status()} ${JSON.stringify(byNumberBody)}`);
      assert(!(await cookie(ctx, "session")), "still no session");
      const left = await db.query("SELECT via, phone FROM user_claims WHERE user_id = $1 AND undone_at IS NULL", [phoneDocId]);
      assert(JSON.stringify(left.rows) === JSON.stringify([{ via: "phone", phone: PHONE_DOC_PHONE }]), `the claim made by hand is left as it was: ${JSON.stringify(left.rows)}`);
      await ctx.close();

      // 2: any other LINE account: the name held by email is taken and no code is emailed for it; the name held by
      // number is not taken (here it has no address, so it still cannot be picked)
      await setIdentity({ sub: SUB_Q, name: "หมออีกคน" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await lineLogin(page);
      await page.waitForSelector('[data-testid="verify-types"]');
      await page.click('[data-testid="verify-type-DR"]');
      await page.waitForSelector('[data-testid="doctor-pick-step"]');
      const held = page.locator('[data-testid="doctor-name"]', { hasText: EMAIL_DOC });
      assert((await held.getAttribute("data-claimed")) === "true", `${EMAIL_DOC} is marked as held`);
      assert(await held.isDisabled(), `${EMAIL_DOC} cannot be picked`);
      assert((await held.textContent()).includes("มีผู้เลือกแล้ว"), `${EMAIL_DOC}: taken badge`);
      const byPhone = page.locator('[data-testid="doctor-name"]', { hasText: PHONE_DOC });
      assert((await byPhone.getAttribute("data-claimed")) === null && (await byPhone.getAttribute("data-no-email")) === "true", "held by number: not taken, only no address");
      assert((await page.locator('[data-testid="doctor-name"][data-claimed="true"]').count()) === 1, "only the name held by email is marked");
      assert((await page.textContent("#doctor-count")).trim() === "4 รายชื่อ · เลือกได้ 0", `count: ${await page.textContent("#doctor-count")}`);
      await held.click({ force: true });
      await sleep(300);
      assert((await page.locator('[data-testid="doctor-send-step"]').count()) === 0, "a held name opens nothing");
      const html = await page.content();
      assert(!html.includes(SUB_DOC) && !html.includes(SUB_P) && !html.includes(PHONE_DOC_PHONE), "who holds a name never leaves the server");
      await touchTargets(page, "/login/doctor (taken)");
      await shoot(page, "doctor-names-taken", { narrow: true });
      const refused = await page.request.post(`${APP}/api/auth/email/send`, { headers, data: { userId: Number(emailDocId) } });
      const refusedBody = await refused.json();
      assert(refused.status() === 409 && refusedBody.reason === "taken" && refusedBody.error === EMAIL_TAKEN, `send for a held name -> ${refused.status()} ${JSON.stringify(refusedBody)}`);
      await sleep(300);
      assert(emailFiles().length === mails, "no email written for a held name");
      assert((await db.query("SELECT count(*)::int AS n FROM email_codes WHERE line_sub = $1", [SUB_Q])).rows[0].n === 0, "no code stored");
      assert((await db.query("SELECT 1 FROM login_events WHERE line_sub = $1 AND event = 'email_refused'", [SUB_Q])).rowCount === 1, "email_refused logged");
      assert((await currentClaim(db, EMAIL_DOC))?.line_sub === SUB_DOC, "the email claim is untouched");

      // a name taken by email between loading the page and sending the code: refused, and the page marks it as taken
      const takeByHand = () =>
        db.query("INSERT INTO user_claims (user_id, phone, line_sub, via, email_verified_at) VALUES ($1, NULL, 'U-nat-by-hand', 'email', now())", [raceId]);
      const releaseByHand = () => db.query("UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE line_sub = 'U-nat-by-hand' AND undone_at IS NULL");
      const racePicked = async () => {
        const b = page.locator('[data-testid="doctor-name"]', { hasText: RACE_DOC });
        return { claimed: await b.getAttribute("data-claimed"), disabled: await b.isDisabled() };
      };
      await db.query("INSERT INTO user_emails (user_id, email) VALUES ($1, 'nat.w@example.com')", [raceId]);
      await page.reload();
      await page.waitForSelector('[data-testid="doctor-pick-step"]');
      assert((await page.textContent("#doctor-count")).trim() === "4 รายชื่อ · เลือกได้ 1", "a free doctor with an address");
      await page.locator('[data-testid="doctor-name"]', { hasText: RACE_DOC }).click();
      await page.waitForSelector('[data-testid="doctor-send-step"]');
      await takeByHand();
      await page.click('[data-testid="doctor-send"]');
      await page.waitForSelector('[data-testid="doctor-pick-step"] [data-testid="doctor-error"]');
      assert((await plainText(page, '[data-testid="doctor-error"]')) === EMAIL_TAKEN, `taken before the code: ${await plainText(page, '[data-testid="doctor-error"]')}`);
      assert(JSON.stringify(await racePicked()) === '{"claimed":"true","disabled":true}', `marked as taken: ${JSON.stringify(await racePicked())}`);
      assert((await page.textContent("#doctor-count")).trim() === "4 รายชื่อ · เลือกได้ 0", "nothing left to pick");
      assert(emailFiles().length === mails, "no email for it");
      await releaseByHand();

      // ... and between the emailed code and typing it in: refused, the first holder keeps it (no takeover), and the
      // page is back at the names with the name marked as taken
      await page.reload();
      await page.waitForSelector('[data-testid="doctor-pick-step"]');
      await page.locator('[data-testid="doctor-name"]', { hasText: RACE_DOC }).click();
      await page.waitForSelector('[data-testid="doctor-send-step"]');
      await page.click('[data-testid="doctor-send"]');
      await page.waitForSelector('[data-testid="doctor-code-step"]');
      const raceMail = await waitForEmail(mails);
      mails += 1;
      assert(JSON.stringify(raceMail.to) === '["nat.w@example.com"]', `to the doctor's address: ${JSON.stringify(raceMail.to)}`);
      await takeByHand();
      await page.fill("#email-code", raceMail.code);
      await page.waitForSelector('[data-testid="doctor-pick-step"] [data-testid="doctor-error"]');
      assert((await plainText(page, '[data-testid="doctor-error"]')) === EMAIL_TAKEN, `taken after the code: ${await plainText(page, '[data-testid="doctor-error"]')}`);
      assert(JSON.stringify(await racePicked()) === '{"claimed":"true","disabled":true}', `marked as taken: ${JSON.stringify(await racePicked())}`);
      assert(!(await cookie(ctx, "session")), "no session");
      assert((await currentClaim(db, RACE_DOC))?.line_sub === "U-nat-by-hand", "the first holder keeps the name");
      assert((await db.query("SELECT 1 FROM user_claims WHERE line_sub = $1", [SUB_Q])).rowCount === 0, "nothing claimed by this account");
      // released by hand (the repair phase below claims this name again)
      await releaseByHand();
      await db.query("DELETE FROM user_emails WHERE user_id = $1", [raceId]);
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();

      // 3: the doctor, from the LINE account of the claim by number: the email code replaces that claim (the number's
      // LINE bindings go), and the name is held by email from then on
      await db.query("INSERT INTO user_emails (user_id, email) VALUES ($1, 'somjai.j@example.com')", [phoneDocId]);
      await setIdentity({ sub: SUB_P, name: "หมอสมใจ" });
      ctx = await newContext(browser);
      page = await ctx.newPage();
      await lineLogin(page);
      assert(new URL(page.url()).pathname === "/login/verify", `no fast path: ${page.url()}`);
      await page.click('[data-testid="verify-type-DR"]');
      await page.waitForSelector('[data-testid="doctor-pick-step"]');
      const own = page.locator('[data-testid="doctor-name"]', { hasText: PHONE_DOC });
      assert((await own.getAttribute("data-claimed")) === null && !(await own.isDisabled()), "the name held by number is free to prove by email");
      assert((await page.locator('[data-testid="doctor-name"]', { hasText: EMAIL_DOC }).getAttribute("data-claimed")) === "true", "the name held by email still is not");
      await own.click();
      await page.waitForSelector('[data-testid="doctor-send-step"]');
      await page.click('[data-testid="doctor-send"]');
      await page.waitForSelector('[data-testid="doctor-code-step"]');
      const ownMail = await waitForEmail(mails);
      assert(JSON.stringify(ownMail.to) === '["somjai.j@example.com"]', `to the doctor's address: ${JSON.stringify(ownMail.to)}`);
      await page.fill("#email-code", ownMail.code);
      await page.waitForURL(`${APP}/`);
      assert((await boardName(page)) === PHONE_DOC, `signed in by email: ${await boardName(page)}`);
      assert((await page.locator('[data-testid="account-phone"]').count()) === 0, "no number");
      const claims = (await db.query("SELECT phone, via, line_sub, undo_reason, undone_at IS NULL AS current FROM user_claims WHERE user_id = $1 ORDER BY id", [phoneDocId])).rows;
      assert(
        JSON.stringify(claims) ===
          JSON.stringify([
            { phone: PHONE_DOC_PHONE, via: "phone", line_sub: SUB_P, undo_reason: "replaced", current: false },
            { phone: null, via: "email", line_sub: SUB_P, undo_reason: null, current: true },
          ]),
        `the claim by number became an email claim: ${JSON.stringify(claims)}`,
      );
      assert((await db.query("SELECT 1 FROM line_bindings WHERE phone = $1", [PHONE_DOC_PHONE])).rowCount === 0, "the number's binding is gone");
      await ctx.close();
    });

    // ---- The repair phase: MX's HOSxP upload, doctors' bookings with HN, the 16:00 turnover, on the fake clock ----

    /** Moves the app's clock: lib/clock.ts reads NOW_FILE on every call (an ISO time with its offset). */
    const setNow = (iso) => writeFileSync(NOW_FILE, iso);
    const sessionOf = (person) => sessionToken(person.phone, SESSION_SECRET, person.sub, person.userId ?? null);
    /** A browser signed in as `person`: a phone, 390 x 844 at 2x. */
    async function contextAs(person) {
      const ctx = await newContext(browser);
      await ctx.addCookies([{ name: "session", value: await sessionOf(person), url: APP, httpOnly: true, sameSite: "Lax" }]);
      return ctx;
    }
    /** The page's HTML for `person`, with React's payload: everything the browser is sent, every prop included. */
    async function htmlAs(person, path = "/") {
      const r = await fetch(`${APP}${path}`, { headers: { cookie: `session=${await sessionOf(person)}` }, redirect: "manual" });
      return { status: r.status, html: await r.text() };
    }
    /** An element's text with its spaces evened out. */
    const textOf = async (page, selector) => ((await page.textContent(selector)) ?? "").replace(/\s+/g, " ").trim();
    /**
     * A screenshot for the owner at the phone's size. `tall` grows the window to show all of <main>; `upTo` then ends
     * the picture at the bottom of that element.
     */
    async function ownerShot(page, file, { tall = false, upTo = null } = {}) {
      const size = page.viewportSize();
      const extra = tall ? await page.evaluate(() => {
        const main = document.querySelector("main");
        return main ? main.scrollHeight - main.clientHeight : 0;
      }) : 0;
      if (extra > 0) await page.setViewportSize({ width: size.width, height: size.height + extra });
      // Let the short entrance animations (a status line fading in, a bubble popping up) end, so the shot shows their
      // final look; the booking button's glow loops for ever and is left running.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => null)),
        ),
      );
      const box = upTo ? await page.locator(upTo).boundingBox() : null;
      const clip = box ? { x: 0, y: 0, width: size.width, height: Math.ceil(box.y + box.height + 16) } : undefined;
      await page.screenshot({ path: join(SCREENS, file), clip });
      shots.push(file);
      if (extra > 0) await page.setViewportSize(size);
    }
    /** The rows of a room's sheet: [source, flag, has an HN]. */
    const sheetRows = (page) =>
      page.$$eval(".case-row", (rows) => rows.map((r) => [r.dataset.source, r.dataset.flag ?? null, r.querySelector('[data-testid="row-hn"]')?.textContent.trim() ?? null]));
    /** Each row's icon: who does the dressing (the dressing room), else where the row comes from. */
    const rowIcons = (page) =>
      page.$$eval('.case-row [data-testid="row-icon"]', (els) => els.map((e) => e.dataset.doneBy ?? e.dataset.source));
    /**
     * A one-finger swipe over an element, by Chromium's own touch input (so the page gets real touch events): from its
     * centre, `dx` pixels sideways and `dy` down.
     */
    const swipe = async (page, selector, dx, dy = 0) => {
      const box = await page.locator(selector).boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * step) / 6, y: y + (dy * step) / 6 }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
      await page.waitForTimeout(250);
    };
    /**
     * Picks a day in a Thai date field (components/thai-date-field.tsx): opens its calendar, pages to the day's month
     * and taps the day, then waits for the field to hold it.
     */
    const pickDate = async (page, testId, iso) => {
      const calendar = page.locator(`[data-testid="${testId}-calendar"]`);
      if (!(await calendar.isVisible())) await page.click(`[data-testid="${testId}"]`);
      await calendar.waitFor();
      for (let step = 0; ; step += 1) {
        assert(step < 60, `${testId}: ${iso} not reached in the calendar`);
        const day = calendar.locator(`[data-date="${iso}"]`);
        if (await day.count()) {
          await day.click();
          break;
        }
        const first = await calendar.locator("[data-date]").first().getAttribute("data-date");
        await calendar.getByRole("button", { name: iso < first ? "เดือนก่อนหน้า" : "เดือนถัดไป" }).click();
      }
      await page.waitForFunction(([id, want]) => document.querySelector(`[data-testid="${id}"]`)?.dataset.value === want, [testId, iso]);
    };
    const dateValue = (page, testId) => page.getAttribute(`[data-testid="${testId}"]`, "data-value");
    // An old binary .xls starts with the OLE signature D0 CF 11 E0.
    const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
    const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    await t("repair phase: the board's day follows the app's clock and the Bank of Thailand holidays (16:00 turnover, a holiday stepped over)", async () => {
      for (const [key, person] of Object.entries(RP)) {
        const r = person.phone
          ? await db.query(
              "INSERT INTO user_claims (user_id, phone, line_sub, line_name) SELECT id, $2, $3, $4 FROM users WHERE first_name || ' ' || last_name = $1 AND active RETURNING user_id::text AS uid",
              [person.name, person.phone, person.sub, `e2e-${key}`],
            )
          : await db.query(
              `INSERT INTO user_claims (user_id, phone, line_sub, line_name, via, email_verified_at)
               SELECT id, NULL, $2, $3, 'email', now() FROM users WHERE first_name || ' ' || last_name = $1 AND active AND type = 'DR' RETURNING user_id::text AS uid`,
              [person.name, person.sub, `e2e-${key}`],
            );
        assert(r.rowCount === 1, `a claim by hand for ${key}`);
        if (!person.phone) person.userId = r.rows[0].uid;
      }
      const ctx = await contextAs(RP.nurse);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const [at, eyebrow, date, label] of [
        ["2026-11-16T10:00:00+07:00", "ตารางผ่าตัดวันนี้", "2026-11-16", "16 พ.ย. 2569"], // a workday before 16:00: today
        ["2026-11-16T16:00:00+07:00", "ตารางผ่าตัดถัดไป", "2026-11-17", "17 พ.ย. 2569"], // from 16:00: the next workday
        ["2026-11-14T09:00:00+07:00", "ตารางผ่าตัดถัดไป", "2026-11-16", "16 พ.ย. 2569"], // a Saturday: Monday
        ["2026-12-04T16:30:00+07:00", "ตารางผ่าตัดถัดไป", "2026-12-08", "8 ธ.ค. 2569"], // Friday 16:30: the weekend and Mon 7 Dec (a BOT holiday) skipped
      ]) {
        setNow(at);
        await page.goto(`${APP}/`, { waitUntil: "networkidle" });
        assert((await textOf(page, '[data-testid="board-eyebrow"]')) === eyebrow, `${at}: eyebrow ${await textOf(page, '[data-testid="board-eyebrow"]')}`);
        assert((await page.getAttribute("header time", "datetime")) === date, `${at}: the board's date ${await page.getAttribute("header time", "datetime")}`);
        // every one of these days is in the repair's first half, and nothing has been uploaded
        assert((await textOf(page, '[data-testid="no-upload-alert"]')) === `ยังไม่มีตาราง HOSxP ของ ${label}`, `${at}: no-upload alert`);
        assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "1", `${at}: the first half's repair zone`);
        assert((await page.locator('[data-testid="repair-note"]').count()) === 0, `${at}: no repair note above the plan`);
        assert((await page.locator('[data-testid="upload-button"], [data-testid="account-upload-link"]').count()) === 0, "no upload link for a nurse");
      }
      // After the repair (it ends 17 Mar 2027) the board's rows still come only from MX's uploads, so a day without
      // one still says so: an empty room must not look like a day with no cases.
      setNow("2027-03-22T10:00:00+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await page.getAttribute("header time", "datetime")) === "2027-03-22", "Monday 22 Mar 2027");
      // No weekly schedule after it either (Pong, 18 Nov 2026: "forget normal day OR schedule"): the second half's rooms stay.
      assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "2", "the second half's rooms after the repair");
      assert((await textOf(page, '[data-testid="no-upload-alert"]')) === "ยังไม่มีตาราง HOSxP ของ 22 มี.ค. 2570", "no-upload alert after the repair");
      const calls = await (await fetch(`${LINE}/__control/bot/calls`)).json();
      assert(calls.some((c) => c.year === "2026") && calls.every((c) => c.authorized), `holidays from the BOT stub with its token: ${JSON.stringify(calls)}`);
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("the board refreshes itself: at 16:00 with no reload, after more than 5 minutes hidden, and at once when Back brings it back late", async () => {
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const eyebrow = () => textOf(page, '[data-testid="board-eyebrow"]');
      const boardDate = () => page.getAttribute("header time", "datetime");
      const shows = (text, date, what, timeoutMs) =>
        waitUntil(async () => (await eyebrow()) === text && (await boardDate()) === date, what, timeoutMs).catch(async (e) => {
          throw new Error(`${e.message}: ${await eyebrow()} ${await boardDate()}`);
        });

      // 16:00 with the page left open: the board's own timer (components/board-refresh.tsx) refreshes it, with no
      // reload (the marker on window survives) and nothing done by the test but moving the server's clock.
      setNow("2026-11-16T15:59:52+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      await shows("ตารางผ่าตัดวันนี้", "2026-11-16", "Monday's board before 16:00", 2_000);
      await page.evaluate(() => {
        window.__sameDocument = true;
      });
      setNow("2026-11-16T16:00:05+07:00");
      await shows("ตารางผ่าตัดถัดไป", "2026-11-17", "Tuesday's board by itself after 16:00", 20_000);
      assert(await page.evaluate(() => window.__sameDocument === true), "refreshed in place, not reloaded");

      // Hidden for more than 5 minutes (the page's clock moved on by 6), then shown: refreshed at once, though the
      // next turnover (midnight) is hours away. The server's clock has moved a day meanwhile.
      await page.evaluate(() => {
        let hidden = false;
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
        const realNow = Date.now.bind(Date);
        let skew = 0;
        Date.now = () => realNow() + skew;
        window.__setHidden = (h) => {
          hidden = h;
          document.dispatchEvent(new Event("visibilitychange"));
        };
        window.__skip = (ms) => {
          skew += ms;
        };
      });
      await page.evaluate(() => window.__setHidden(true));
      await page.evaluate(() => window.__skip(6 * 60_000));
      setNow("2026-11-17T16:00:05+07:00");
      await page.evaluate(() => window.__setHidden(false));
      await shows("ตารางผ่าตัดถัดไป", "2026-11-18", "Wednesday's board when the tab comes back", 5_000);
      assert(await page.evaluate(() => window.__sameDocument === true), "refreshed in place after the tab came back");

      // Back: the router brings the board back from its cache with the props it had. Its wait counts from when it was
      // first seen, so a board whose turnover passed while another page was open refreshes at once, not a full delay
      // later.
      setNow("2026-11-16T15:59:50+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      const seen = Date.now();
      await shows("ตารางผ่าตัดวันนี้", "2026-11-16", "Monday's board at 15:59:50", 2_000);
      await page.click('[data-testid="admin-button"]');
      await page.waitForURL(`${APP}/admin`);
      await page.waitForSelector("h1");
      setNow("2026-11-16T16:00:05+07:00");
      // The board's deadline was 11 s after it was seen (10 s to 16:00 and a second's margin).
      await sleep(Math.max(0, seen + 12_000 - Date.now()));
      await page.goBack();
      await page.waitForURL(`${APP}/`);
      await shows("ตารางผ่าตัดถัดไป", "2026-11-17", "the board brought back by Back refreshed at once", 4_000);
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("admin: the repair's dates on /admin: a wrong order is refused, a save moves the board to the other half at once, and back", async () => {
      setNow("2026-11-16T10:00:00+07:00");
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      // Every section is closed to start with (Pong, 16 Nov 2026: "make them collapsed by default and disable any button
      // when on collapsed"): its body hidden, and the buttons in its heading (เพิ่ม MX, the test notices) greyed out and inert.
      const sections = await page.$$eval("main section[data-open]", (els) =>
        els.map((el) => [el.querySelector("h2")?.textContent?.trim(), el.dataset.open, el.querySelector("[id$='-body']")?.checkVisibility() ?? null]),
      );
      assert(
        JSON.stringify(sections) ===
          JSON.stringify(
            ["ช่วงปิดซ่อมห้องผ่าตัด", "ผู้จัดการตาราง (MX)", "รายชื่อทั้งหมด", "ตารางตัวอย่าง", "ตารางย้อนหลังจาก HOSxP", "โหมดทดสอบ"].map((title) => [
              title,
              "false",
              false,
            ]),
          ),
        `every section closed: ${JSON.stringify(sections)}`,
      );
      const inertActions = await page.$$eval("[data-testid$='-actions']", (els) =>
        els.map((el) => [el.dataset.testid, el.inert, [...el.querySelectorAll("a, button")].length]),
      );
      assert(
        JSON.stringify(inertActions) === JSON.stringify([["mx-actions", true, 1], ["staff-actions", true, 1], ["test-mode-actions", true, 1]]),
        `the headings' buttons are inert while closed: ${JSON.stringify(inertActions)}`,
      );
      assert(!(await page.isVisible('[data-testid="repair-save"]')), "nothing of a closed section's body shows");
      await noSideScroll(page, "/admin closed at 390px");
      await ownerShot(page, "admin-closed.png", { tall: true });
      await openSection(page, "repair-periods");
      assert((await page.getAttribute("#repair-periods-toggle", "aria-expanded")) === "true", "opened by its heading");
      const dates = async () =>
        Promise.all(["1-from", "1-to", "2-from", "2-to"].map((k) => dateValue(page, `repair-half-${k}`)));
      assert(JSON.stringify(await dates()) === JSON.stringify(["2026-01-01", "2027-01-26", "2027-01-27", "2027-03-17"]), `the planned dates: ${await dates()}`);
      assert((await textOf(page, '[data-testid="repair-half-1"]')).includes("กำลังปิดซ่อม"), "half 1 is running today");
      assert(!(await textOf(page, '[data-testid="repair-half-2"]')).includes("กำลังปิดซ่อม"), "half 2 is not");
      assert((await textOf(page, '[data-testid="repair-changed"]')) === "ใช้วันที่ตามแผนเดิม ยังไม่มีผู้แก้ไข", "nobody has saved yet");
      assert(await page.isDisabled('[data-testid="repair-save"]'), "nothing to save yet");

      // the second half must start after the first ends: refused here (the server checks again)
      // the dates are written out and picked in Thai (Pong, 15 Nov 2026)
      // the first half runs from 1 Jan 2026 (Pong, 18 Nov 2026: "apply first half schedule retrospectively from Jan 1, 2026")
      assert((await textOf(page, '[data-testid="repair-half-1-from"]')).includes("วันพฤหัสบดีที่ 1 มกราคม 2569"), "the first day in Thai");
      await pickDate(page, "repair-half-2-from", "2027-01-20");
      // a date changed and not saved: the heading says so, and closing the section keeps it
      assert(await page.isVisible('[data-testid="repair-unsaved"]'), "ยังไม่บันทึก in the heading");
      await page.click("#repair-periods-toggle");
      await page.locator("#repair-periods-body").waitFor({ state: "hidden" });
      assert(await page.isVisible('[data-testid="repair-unsaved"]'), "ยังไม่บันทึก while closed");
      await openSection(page, "repair-periods");
      assert((await dateValue(page, "repair-half-2-from")) === "2027-01-20", "the draft is kept while closed");
      await page.click('[data-testid="repair-save"]');
      await page.waitForSelector('[aria-labelledby="repair-periods-title"] [role="alert"]');
      assert((await textOf(page, '[aria-labelledby="repair-periods-title"] [role="alert"]')) === "ช่วงที่ 2 ต้องเริ่มหลังช่วงที่ 1 จบ", "order message");
      // the refusal is said quietly beside บันทึก, inside the card (Pong, 15 Nov 2026)
      await ownerShot(page, "admin-repair-error.png", { tall: true, upTo: 'section[aria-labelledby="repair-periods-title"]' });
      const stored = async () =>
        (await db.query("SELECT half, from_date::text AS f, to_date::text AS t, updated_by FROM repair_periods ORDER BY half")).rows;
      assert((await stored()).every((r) => r.updated_by === null), "nothing saved");

      // Monday 16 Nov moved into the second half: the board follows at once
      const save = async (h1from, h1to, h2from, h2to) => {
        for (const [k, v] of [["1-from", h1from], ["1-to", h1to], ["2-from", h2from], ["2-to", h2to]]) {
          if ((await dateValue(page, `repair-half-${k}`)) !== v) await pickDate(page, `repair-half-${k}`, v);
        }
        await page.click('[data-testid="repair-save"]');
        await waitUntil(async () => {
          const rows = await stored();
          return rows[0].f === h1from && rows[0].t === h1to && rows[1].f === h2from && rows[1].t === h2to;
        }, "saved dates");
        await page.waitForSelector('[aria-labelledby="repair-periods-title"] [role="status"]');
      };
      await save("2026-11-01", "2026-11-10", "2026-11-11", "2027-03-17");
      await ownerShot(page, "admin-repair-saved.png", { tall: true, upTo: 'section[aria-labelledby="repair-periods-title"]' });
      assert((await stored()).every((r) => r.updated_by === ADMIN_SUB), "saved by the admin's LINE id");
      assert(/^แก้ไขล่าสุด .+ โดย วิไล แสงทอง$/.test(await textOf(page, '[data-testid="repair-changed"]')), `who saved: ${await textOf(page, '[data-testid="repair-changed"]')}`);
      assert((await page.locator('[data-testid="repair-unsaved"]').count()) === 0, "nothing unsaved after a save");
      const nurse = await contextAs(RP.nurse);
      const board = await nurse.newPage();
      await board.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await board.getAttribute('[data-testid="repair-zone"]', "data-half")) === "2", "the second half's repair zone");
      // iPhone pulls Thai vowels and tone marks off their letters in SVG text with letter-spacing.
      const tagSpacing = await board.evaluate(() => getComputedStyle(document.querySelector(".fp-zone-text")).letterSpacing);
      assert(tagSpacing === "normal" || tagSpacing === "0px", `no letter-spacing on the zone tag: ${tagSpacing}`);
      assert((await board.getAttribute("#or-1 .fp-floor", "role")) === "button", "OR 1 operates in the second half");
      assert((await board.getAttribute("#or-12 .fp-floor", "aria-label"))?.endsWith("ปิด"), "OR 12 is closed in the second half");
      // As on the repair plan images: RR 2 stays open as a mint RR, RR 1 is closed, and the dark zone lies under the rooms.
      assert((await board.getAttribute("#r-2", "class"))?.includes("is-rr"), "RR 2 is a recovery room in the second half");
      assert((await textOf(board, "#r-2 text")) === "RR", "RR 2 is labelled RR");
      assert((await board.getAttribute("#r-1", "class"))?.includes("is-closed"), "RR 1 is closed in the second half");
      assert((await textOf(board, "#r-1 text")) === "ปิด", "RR 1 says ปิด");
      assert(
        await board.evaluate(() => {
          const fill = document.querySelector('[data-testid="repair-zone-fill"]');
          const rooms = document.querySelector("#fp-rooms");
          return Boolean(fill && rooms && fill.compareDocumentPosition(rooms) & Node.DOCUMENT_POSITION_FOLLOWING);
        }),
        "the zone's stripes are drawn under the rooms",
      );

      // and back to the planned dates
      await save("2026-01-01", "2027-01-26", "2027-01-27", "2027-03-17");
      await board.reload({ waitUntil: "networkidle" });
      assert((await board.getAttribute('[data-testid="repair-zone"]', "data-half")) === "1", "first half again");
      assert((await board.getAttribute("#or-1 .fp-floor", "aria-label"))?.endsWith("ปิด"), "OR 1 closed again");
      assert((await board.getAttribute("#or-12 .fp-floor", "role")) === "button", "OR 12 operates again");
      assert((await board.getAttribute("#r-2", "class"))?.includes("is-closed"), "RR 2 is closed in the first half");
      assert((await board.locator('[data-testid="repair-zone"]').count()) === 1, "the repair zone is drawn");
      await nurse.close();
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("admin: MX is granted and taken back on /admin; /upload and the upload link are for MX and admins only", async () => {
      setNow("2026-11-16T10:00:00+07:00");
      for (const person of [RP.mx, RP.nurse, RP.drX]) {
        const r = await htmlAs(person, "/upload");
        assert(r.status === 404, `/upload before MX -> ${r.status}`);
      }
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      // เพิ่ม MX shows in the closed section's heading, greyed out: a tap on it only opens the section
      const addButton = page.locator('[data-testid="mx-add"]');
      assert(await addButton.evaluate((el) => Boolean(el.closest("[inert]"))), "เพิ่ม MX is inert while the section is closed");
      assert(Number(await addButton.evaluate((el) => getComputedStyle(el.closest("[inert]")).opacity)) < 0.6, "and greyed out");
      const addBox = await addButton.boundingBox();
      await page.mouse.click(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
      await page.locator("#mx-body").waitFor({ state: "visible" });
      assert((await page.locator("dialog[open]").count()) === 0, "the tap opened the section, not the picker");
      assert(await addButton.evaluate((el) => !el.closest("[inert]")), "เพิ่ม MX works once the section is open");
      const add = async (search, name) => {
        await page.click('[data-testid="mx-add"]');
        await page.fill('[data-testid="mx-search"]', search);
        await page.locator('[data-testid="mx-users"] button', { hasText: name }).click();
        assert((await textOf(page, '[data-testid="mx-confirm"]')) === `เพิ่ม ${name}`, "two steps: pick, then confirm");
        await page.click('[data-testid="mx-confirm"]');
        await page.locator('[data-testid="mx-list"] li', { hasText: name }).waitFor();
      };
      const members = async () =>
        (await db.query("SELECT u.first_name || ' ' || u.last_name AS name, m.added_by FROM mx_members m JOIN users u ON u.id = m.user_id ORDER BY 1")).rows;
      // only RN of the OR unit are offered (Pong, 17 Nov 2026)
      await page.click('[data-testid="mx-add"]');
      const offered = await page.$$eval('[data-testid="mx-users"] button .font-semibold', (els) => els.map((el) => el.textContent.trim()));
      const rnOr = (await db.query("SELECT first_name || ' ' || last_name AS name FROM users WHERE active AND type = 'RN' AND subtype = 'OR'")).rows.map((r) => r.name);
      assert(offered.length === rnOr.length && offered.every((name) => rnOr.includes(name)), `the picker offers RN-OR only: ${offered.length} of ${rnOr.length}`);
      const roles = await page.$$eval('[data-testid="mx-users"] button .text-muted', (els) => [...new Set(els.map((el) => el.textContent.trim()))]);
      assert(JSON.stringify(roles) === JSON.stringify(["พยาบาล · ห้องผ่าตัด"]), `roles offered: ${roles}`);
      await ownerShot(page, "admin-mx-picker.png");
      await page.locator("dialog[open]").getByRole("button", { name: "ยกเลิก" }).click();
      await page.waitForSelector("dialog[open]", { state: "detached" });
      await add("ปราณี", RP.mx.name);
      await add("อรุณี", RP.nurse.name);
      assert(JSON.stringify(await members()) === JSON.stringify([{ name: RP.mx.name, added_by: ADMIN_SUB }, { name: RP.nurse.name, added_by: ADMIN_SUB }].sort((a, b) => (a.name < b.name ? -1 : 1))), `members: ${JSON.stringify(await members())}`);
      // taken back, after a confirmation
      await page.click(`[aria-label="ถอดสิทธิ์ผู้จัดการตารางของ ${RP.nurse.name}"]`);
      await page.click('dialog[open] button.btn-danger');
      await page.locator('[data-testid="mx-list"] li', { hasText: RP.nurse.name }).waitFor({ state: "detached" });
      assert(JSON.stringify((await members()).map((m) => m.name)) === JSON.stringify([RP.mx.name]), "one member left");
      // a member is greyed out in the picker
      await page.click('[data-testid="mx-add"]');
      await page.fill('[data-testid="mx-search"]', "ปราณี");
      const taken = page.locator('[data-testid="mx-users"] button', { hasText: RP.mx.name });
      assert((await taken.isDisabled()) && (await taken.textContent()).includes("เป็น MX แล้ว"), "already MX");
      await page.locator("dialog[open]").getByRole("button", { name: "ยกเลิก" }).click();
      await page.waitForSelector("dialog[open]", { state: "detached" });

      await page.setViewportSize({ width: 360, height: 780 });
      await noSideScroll(page, "/admin at 360px");
      await page.setViewportSize({ width: 390, height: 844 });
      await touchTargets(page, "/admin");
      await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
      // the two repair-phase sections (the surgeon list below them reads Neon's HTTP driver, which this database lacks)
      await ownerShot(page, "admin-repair.png", { tall: true, upTo: 'section[aria-labelledby="mx-title"]' });

      // MX: the upload page and the links to it; the nurse is back to none
      const mx = await htmlAs(RP.mx, "/upload");
      assert(mx.status === 200 && mx.html.includes("อัปโหลดตารางผ่าตัด"), `/upload for MX -> ${mx.status}`);
      assert((await htmlAs(RP.nurse, "/upload")).status === 404, "/upload for the nurse after the revoke");
      assert((await htmlAs(RP.mx)).html.includes('href="/upload"'), "an upload link on MX's board");
      for (const person of [RP.nurse, RP.drX]) assert(!(await htmlAs(person)).html.includes('href="/upload"'), "no upload link for others");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("admin: every name on the staff list on /admin, by type (DR, RN, PN, PCA), then specialty or unit, and by name", async () => {
      setNow("2026-11-16T10:00:00+07:00");
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      assert((await textOf(page, "#staff-title")) === "รายชื่อทั้งหมด", "the section's title");
      // The active users of the table, as the list orders them: doctors, nurses, assistants, aides, each in Thai order.
      const order = ["DR", "RN", "PN", "PCA"];
      const active = (await db.query("SELECT first_name || ' ' || last_name AS name, type, subtype FROM users WHERE active")).rows.sort(
        (a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name, "th"),
      );
      assert(active.length >= 10 && order.every((type) => active.some((u) => u.type === type)), `every type on the list: ${active.length}`);
      assert((await textOf(page, '[data-testid="staff-summary"]')) === `ผู้ใช้ที่ใช้งานอยู่ ${active.length} คน`, "the count in the closed heading");
      assert(!(await page.isVisible('[data-testid="staff-list"]')), "the list starts closed");
      await openSection(page, "staff");
      const rows = () => page.$$eval('[data-testid="staff-list"] li', (els) => els.map((el) => [el.querySelector("p")?.textContent?.trim(), el.dataset.type]));
      const count = () => textOf(page, '[data-testid="staff-count"]');
      assert(JSON.stringify(await rows()) === JSON.stringify(active.map((u) => [u.name, u.type])), `everyone, by type then name: ${JSON.stringify(await rows())}`);
      assert((await count()) === `ทั้งหมด ${active.length} คน`, `count: ${await count()}`);
      const typeCounts = await page.$$eval('[data-testid="staff-types"] button', (els) => els.map((el) => [el.dataset.testid, el.getAttribute("aria-pressed"), el.textContent.replace(/\s+/g, " ").trim()]));
      assert(
        JSON.stringify(typeCounts) ===
          JSON.stringify([
            ["staff-type-all", "true", `ทั้งหมด${active.length} คน`],
            ...[["DR", "แพทย์"], ["RN", "พยาบาล"], ["PN", "ผู้ช่วยพยาบาล"], ["PCA", "พนักงานช่วยเหลือคนไข้"]].map(([type, name]) => [
              `staff-type-${type}`,
              "false",
              `${type}${name}${active.filter((u) => u.type === type).length} คน`,
            ]),
          ]),
        `the type buttons with their counts: ${JSON.stringify(typeCounts)}`,
      );
      assert(!(await page.isVisible('[data-testid="staff-subtype"]')), "no specialty or unit to pick under all types");

      // DR: only doctors, then one specialty
      await page.click('[data-testid="staff-type-DR"]');
      assert((await page.getAttribute('[data-testid="staff-type-DR"]', "aria-pressed")) === "true", "DR picked");
      const doctors = active.filter((u) => u.type === "DR");
      assert(JSON.stringify(await rows()) === JSON.stringify(doctors.map((u) => [u.name, "DR"])), `doctors only: ${JSON.stringify(await rows())}`);
      assert((await count()) === `แสดง ${doctors.length} จาก ${active.length} คน · แพทย์`, `count: ${await count()}`);
      assert((await textOf(page, '[data-testid="staff-subtype"] option:first-child')) === `ทุกสาขา (${doctors.length})`, "every specialty");
      assert((await textOf(page, `[data-testid="staff-subtype"] option[value="OBGYN"]`)) === `สูติ-นรีเวชกรรม (${doctors.filter((u) => u.subtype === "OBGYN").length})`, "OBGYN in Thai with its count");
      await page.selectOption('[data-testid="staff-subtype"]', "OBGYN");
      assert(JSON.stringify(await rows()) === JSON.stringify(doctors.filter((u) => u.subtype === "OBGYN").map((u) => [u.name, "DR"])), "OBGYN only");
      assert((await textOf(page, '[data-testid="staff-list"] li')).includes("OBGYNแพทย์ · สูติ-นรีเวชกรรม"), `a doctor's line: ${await textOf(page, '[data-testid="staff-list"] li')}`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.selectOption('[data-testid="staff-subtype"]', "");
      await ownerShot(page, "admin-staff-doctors.png", { tall: true, upTo: '[data-testid="staff-section"]' });

      // RN, then a unit; another type starts from every unit again
      await page.click('[data-testid="staff-type-RN"]');
      assert((await page.inputValue('[data-testid="staff-subtype"]')) === "", "a new type starts with every unit");
      assert((await textOf(page, '[data-testid="staff-subtype"] option:first-child')).startsWith("ทุกหน่วย"), "units for nurses");
      await page.selectOption('[data-testid="staff-subtype"]', "ANES");
      const anes = active.filter((u) => u.type === "RN" && u.subtype === "ANES");
      assert(JSON.stringify(await rows()) === JSON.stringify(anes.map((u) => [u.name, "RN"])), `RN ANES: ${JSON.stringify(await rows())}`);
      assert((await textOf(page, '[data-testid="staff-list"] li')).includes("พยาบาล · วิสัญญี"), "a nurse's unit in Thai");

      // by name, across every type; nothing found says so
      await page.click('[data-testid="staff-type-all"]');
      assert(!(await page.isVisible('[data-testid="staff-subtype"]')), "no unit picker under all types");
      await page.fill('[data-testid="staff-search"]', "  วิไล  ");
      assert(JSON.stringify((await rows()).map(([name]) => name)) === JSON.stringify([RP.admin.name]), `search: ${JSON.stringify(await rows())}`);
      await page.fill('[data-testid="staff-search"]', "xyz");
      assert((await page.locator('[data-testid="staff-list"]').count()) === 0, "no rows");
      assert((await textOf(page, "#staff-body")).includes("ไม่พบชื่อนี้ ลองคำอื่นหรือตำแหน่งอื่น"), "nothing found");
      await page.fill('[data-testid="staff-search"]', "");

      // read only: no button on any row; fits a small phone; 44px targets
      assert((await page.locator('[data-testid="staff-list"] button').count()) === 0, "no buttons on the rows");
      await page.setViewportSize({ width: 360, height: 780 });
      await noSideScroll(page, "/admin with the staff list at 360px");
      await page.setViewportSize({ width: 390, height: 844 });
      await touchTargets(page, "/admin with the staff list open");
      await page.evaluate(() => document.querySelector("main")?.scrollTo(0, 0));
      await ownerShot(page, "admin-staff-list.png", { tall: true, upTo: '[data-testid="staff-section"]' });
      // a tap on the chevron closes it again (turned over while open, it must not take the tap)
      const chevron = await page.locator('[data-testid="staff-section"] .section-head > div > svg').boundingBox();
      await page.mouse.click(chevron.x + chevron.width / 2, chevron.y + chevron.height / 2);
      await page.locator("#staff-body").waitFor({ state: "hidden" });
      assert((await page.getAttribute("#staff-toggle", "aria-expanded")) === "false", "closed by its chevron");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("admin: เพิ่มชื่อ on the all-names list adds a name with its type and specialty or unit; a name already listed is refused; the sync keeps it", async () => {
      setNow("2026-11-16T10:00:00+07:00");
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      const addButton = page.locator('[data-testid="staff-add"]');
      assert(await addButton.evaluate((el) => Boolean(el.closest("[inert]"))), "เพิ่มชื่อ is inert while the section is closed");
      await openSection(page, "staff");
      await addButton.click();
      await page.waitForSelector("dialog[open] #staff-add-title");
      assert((await page.inputValue('[data-testid="staff-add-subtype"]')) === "OR", "a nurse starts in the OR unit");
      // a doctor: the specialty must be picked
      await page.click('[data-testid="staff-add-type-DR"]');
      await page.fill('[data-testid="staff-add-first"]', "  ทดลอง ");
      await page.fill('[data-testid="staff-add-last"]', "เพิ่มชื่อ");
      await page.click('[data-testid="staff-add-confirm"]');
      assert((await textOf(page, "dialog[open] [role=alert]")) === "เลือกสาขา", "a specialty is needed");
      await page.selectOption('[data-testid="staff-add-subtype"]', "ENT");
      await ownerShot(page, "admin-staff-add.png");
      await page.click('[data-testid="staff-add-confirm"]');
      await page.waitForSelector("dialog[open]", { state: "detached" });
      const row = (await db.query(
        "SELECT u.type, u.subtype, u.active, a.added_by FROM users u JOIN users_added a ON a.user_id = u.id WHERE u.first_name = 'ทดลอง' AND u.last_name = 'เพิ่มชื่อ'",
      )).rows;
      assert(JSON.stringify(row) === JSON.stringify([{ type: "DR", subtype: "ENT", active: true, added_by: ADMIN_SUB }]), `saved: ${JSON.stringify(row)}`);
      // the new name shows by itself in the list, and the heading says so
      await page.locator('[data-testid="staff-list"] li', { hasText: "ทดลอง เพิ่มชื่อ" }).waitFor();
      assert((await page.inputValue('[data-testid="staff-search"]')) === "ทดลอง เพิ่มชื่อ", "searched for the new name");
      assert((await textOf(page, '[data-testid="staff-summary"]')).includes("เพิ่ม ทดลอง เพิ่มชื่อ แล้ว"), "the heading says it was added");
      // the same name again is refused; nothing changes
      await addButton.click();
      await page.fill('[data-testid="staff-add-first"]', "ทดลอง");
      await page.fill('[data-testid="staff-add-last"]', "เพิ่มชื่อ");
      await page.click('[data-testid="staff-add-confirm"]');
      await page.locator("dialog[open] [role=alert]", { hasText: "มี ทดลอง เพิ่มชื่อ ในรายชื่ออยู่แล้ว" }).waitFor();
      await page.locator("dialog[open]").getByRole("button", { name: "ยกเลิก" }).click();
      assert((await db.query("SELECT count(*)::int AS n FROM users WHERE first_name = 'ทดลอง'")).rows[0].n === 1, "one row");
      // a non-admin's call of the action is refused (the page itself is a 404 for them)
      assert((await htmlAs(RP.nurse, "/admin")).status === 404, "/admin for a nurse");
      await page.setViewportSize({ width: 360, height: 780 });
      await noSideScroll(page, "/admin after adding a name at 360px");
      await page.setViewportSize({ width: 390, height: 844 });
      // leave the list as the later tests expect it: the added name goes inactive again
      await db.query("UPDATE users SET active = false WHERE first_name = 'ทดลอง' AND last_name = 'เพิ่มชื่อ'");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("doctor: books with a Thai calendar, a 7-digit HN and the room of their choice, OR X or ห้องทำแผล with the scrub question; 15:00 closes the next workday; before an upload the board lists the bookings, the HN for its doctor only", async () => {
      setNow("2026-11-16T10:00:00+07:00");
      const dialog = '[data-testid="add-case-dialog"]';
      const scrubDialog = '[data-testid="scrub-dialog"]';
      const alertText = () => textOf(page, '[data-testid="case-save-status"]');
      const choiceOf = (page) => page.getAttribute('[data-testid="case-room"]', "data-choice");
      const fillCase = async (page, { date, hn, operation, note = null }) => {
        if ((await dateValue(page, "case-date")) !== date) await pickDate(page, "case-date", date);
        await page.fill(`${dialog} input[data-testid="case-hn"]`, hn);
        await page.fill('[data-testid="case-operation"]', operation);
        if (note !== null) await page.fill('[data-testid="case-note"]', note);
        // OR X, the department's room, is picked to start with, whatever the name (Pong, 15 Nov 2026: the surgeon decides)
        assert((await choiceOf(page)) === "dept", `${operation}: OR X picked to start with`);
      };
      const saveCase = async (page, { date, operation, room, dressing = false, shot = null }) => {
        // the room the choice gives that day, shown before saving
        assert((await page.getAttribute('[data-testid="case-room"]', "data-room-id")) === room, `${operation}: in ${room}, not ${await page.getAttribute('[data-testid="case-room"]', "data-room-id")}`);
        // the dressing room says its scrub answer; the department's room says nothing (Pong, 15 Nov 2026: "remove ห้องของสาขาคุณ...")
        if (dressing) assert((await textOf(page, '[data-testid="case-room-why"]')).startsWith("scrub ทำให้แทนไหม ?"), `${operation}: the scrub answer`);
        else assert((await page.locator('[data-testid="case-room-why"]').count()) === 0, `${operation}: nothing under OR X`);
        if (shot) await shot();
        await page.click('[data-testid="case-submit"]');
        const day = { "2026-11-16": "วันจันทร์ที่ 16", "2026-11-17": "วันอังคารที่ 17" }[date];
        // simply the room and the day, for the dressing room too (Pong, 15 Nov 2026)
        const expected = `จอง OR ${room.slice(3)} ${day} พ.ย. 2569 แล้ว`;
        await page.waitForFunction(
          (want) => document.querySelector('[data-testid="add-case-dialog"] .inline-status-success')?.textContent?.trim() === want,
          expected,
        );
        assert((await choiceOf(page)) === "dept", "the next patient starts on OR X again");
      };
      const book = async (page, item) => {
        await fillCase(page, item);
        await saveCase(page, item);
      };
      const pickDressing = async (page) => {
        await page.click('label:has([data-testid="case-room-dressing"])');
        await page.waitForSelector(`${scrubDialog}[open]`);
      };
      const ctx = await contextAs(RP.drX);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await textOf(page, '[data-testid="add-case-button"]')) === "จองห้อง", "the booking button");
      // The button floats over the plan's corner: the plan must stop above it, with the no-upload note above the plan
      // too, on a tall phone and a short one (Pong saw it cover OR 10, 15 Nov 2026).
      for (const [width, height] of [[390, 844], [360, 640]]) {
        await page.setViewportSize({ width, height });
        const r = await page.evaluate(() => {
          const svg = document.querySelector('svg[aria-label="แปลนห้องผ่าตัด"]').getBoundingClientRect();
          const button = document.querySelector('[data-testid="add-case-button"]').getBoundingClientRect();
          // The drawing is top-aligned in its box (xMidYMin meet) at the plan's own aspect ratio.
          return {
            planBottom: svg.top + Math.min(svg.height, (svg.width * 1706) / 1207),
            buttonTop: button.top,
            buttonCentre: button.left + button.width / 2,
            glow: getComputedStyle(document.querySelector('[data-testid="add-case-button"]')).animationName,
          };
        });
        assert(await page.isVisible('[data-testid="no-upload-alert"]'), `${width}x${height}: the no-upload note shows`);
        assert(r.buttonTop >= r.planBottom - 0.5, `${width}x${height}: the booking button clears the plan (${r.buttonTop} < ${r.planBottom})`);
        // centred, and glowing to draw the eye (Pong, 15 Nov 2026)
        assert(Math.abs(r.buttonCentre - width / 2) < 1, `${width}x${height}: the booking button is centred (${r.buttonCentre})`);
        assert(r.glow === "book-glow", `${width}x${height}: the booking button glows (${r.glow})`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await ownerShot(page, "board-doctor.png");

      // Friday 13 Nov at 10:00: Monday is the first day that can be booked (Pong: before 15:00, the next workday).
      setNow("2026-11-13T10:00:00+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      await page.click('[data-testid="add-case-button"]');
      await page.waitForSelector(`${dialog}[open]`);
      assert((await textOf(page, "#add-case-title")) === "จองห้องผ่าตัด", "dialog title");
      // the department on a line of its own, under the surgeon's name
      assert((await textOf(page, '[data-testid="case-dept"]')) === "อายุรกรรมโรคไต", "the department line");
      // two rooms to pick from, each named with the room it is that day: the nephrologist's department has no room of its
      // own during the repair, so OR X is the mixed-department room OR 11; the dressing room is OR 10
      assert((await choiceOf(page)) === "dept", "OR X picked to start with");
      // the department above the room number (Pong, 15 Nov 2026)
      const orX = await textOf(page, 'label:has([data-testid="case-room-dept"])');
      assert(orX.endsWith("OR 11") && orX.length > "OR 11".length, `OR X: the department, then the room: ${orX}`);
      // no ในเวลา/นอกเวลา choice (Pong, 15 Nov 2026)
      assert((await page.$$(`${dialog} input[name="shift"]`)).length === 0, "no ในเวลา/นอกเวลา choice");
      assert((await textOf(page, 'label:has([data-testid="case-room-dressing"])')) === "ห้องทำแผลOR 10", `the dressing room: ${await textOf(page, 'label:has([data-testid="case-room-dressing"])')}`);
      assert((await dateValue(page, "case-date")) === "2026-11-16", "the form starts on Monday");
      assert((await textOf(page, '[data-testid="case-date"]')).includes("วันจันทร์ที่ 16 พฤศจิกายน 2569"), "the day written out in Thai");
      // the 15:00 rule in Pong's words, always, then the earliest day (Pong, 15 Nov 2026), a little larger than before
      assert(
        (await textOf(page, '[data-testid="case-date-hint"]')) === "หลังเวลา 15.00 น. ระบบจะปิดรับการจอง ของวันทำการถัดไป จองได้ตั้งแต่ วันจันทร์ที่ 16 พ.ย. 2569",
        `the rule and the earliest day said: ${await textOf(page, '[data-testid="case-date-hint"]')}`,
      );
      const hintSize = await page.locator('[data-testid="case-date-hint"]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      assert(hintSize === 13, `the hint at 13px: ${hintSize}`);
      await ownerShot(page, "booking-form.png");
      // the calendar: Thai month and Buddhist year, today and the weekend closed
      await page.click('[data-testid="case-date"]');
      const calendar = page.locator('[data-testid="case-date-calendar"]');
      await calendar.waitFor();
      assert((await calendar.textContent()).includes("พฤศจิกายน 2569"), "the month in Thai with the Buddhist year");
      for (const [iso, open] of [["2026-11-13", false], ["2026-11-14", false], ["2026-11-15", false], ["2026-11-16", true], ["2026-11-17", true]]) {
        assert((await calendar.locator(`[data-date="${iso}"]`).isDisabled()) === !open, `${iso} ${open ? "can" : "cannot"} be picked`);
      }
      await ownerShot(page, "booking-calendar.png");
      await page.keyboard.press("Escape");
      await calendar.waitFor({ state: "detached" });
      assert(await page.isVisible(`${dialog}[open]`), "Escape closes the calendar, not the form");

      // nothing typed: the HN first, its boxes marked; then the operation, which is required
      await page.click('[data-testid="case-submit"]');
      await page.waitForSelector('[data-testid="case-save-status"]');
      assert((await alertText()) === "ใส่ HN ของผู้ป่วย", `no HN: ${await alertText()}`);
      assert((await page.getAttribute(`${dialog} input[data-testid="case-hn"]`, "aria-invalid")) === "true", "the HN box is marked");
      assert(await page.evaluate(() => document.activeElement?.dataset.testid === "case-hn"), "the HN box has the focus");
      await ownerShot(page, "booking-error-hn.png");
      await page.fill(`${dialog} input[data-testid="case-hn"]`, "123456");
      await page.click('[data-testid="case-submit"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="case-save-status"]')?.textContent?.trim() === "HN ต้องเป็นตัวเลข 7 หลัก");
      // an eighth digit typed, or a pasted longer number, is quietly left out: never cut short, and no warning
      // (Pong, 15 Nov 2026)
      await page.fill(`${dialog} input[data-testid="case-hn"]`, "1234567");
      await page.locator(`${dialog} input[data-testid="case-hn"]`).evaluate((input) => {
        input.focus();
        input.setSelectionRange(7, 7);
      });
      await page.keyboard.type("8");
      assert((await page.inputValue(`${dialog} input[data-testid="case-hn"]`)) === "1234567", "an eighth digit is left out");
      await page.locator(`${dialog} input[data-testid="case-hn"]`).evaluate((input) => input.select());
      await page.keyboard.insertText("12345678");
      assert((await page.inputValue(`${dialog} input[data-testid="case-hn"]`)) === "1234567", "the HN kept as it was");
      assert((await page.locator(`${dialog} [role="alert"]`).count()) === 0, "nothing is said about it");
      assert((await page.getAttribute(`${dialog} input[data-testid="case-hn"]`, "aria-invalid")) === null, "and the boxes are not marked");
      // a whole HN put in at once (a keyboard's clipboard suggestion) replaces the one in the full boxes
      await page.keyboard.insertText("7654321");
      assert((await page.inputValue(`${dialog} input[data-testid="case-hn"]`)) === "7654321", "a whole new HN replaces the old");
      await page.click('[data-testid="case-submit"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="case-save-status"]')?.textContent?.trim() === "ใส่ชื่อการผ่าตัด");
      assert((await page.getAttribute('[data-testid="case-operation"]', "aria-invalid")) === "true", "the operation box is marked");
      await ownerShot(page, "booking-error-operation.png");

      // the note (หมายเหตุ; Pong, 17 Nov 2026): optional, last, saying everyone sees it; saved cleaned, line breaks kept
      assert((await page.inputValue('[data-testid="case-note"]')) === "", "no note to start with");
      assert((await textOf(page, 'label[for="case-note"]')) === "หมายเหตุ (ถ้ามี)", "the note's label");
      assert((await textOf(page, '[data-testid="case-note-hint"]')) === "ทุกคนที่เปิดตารางเห็นข้อความนี้ ไม่ต้องใส่ชื่อหรือ HN ผู้ป่วย", "the note's hint");
      assert((await page.getAttribute('[data-testid="case-note"]', "maxlength")) === "500", "at most 500 characters");
      assert((await page.getAttribute('[data-testid="case-note"]', "aria-describedby")) === "case-note-hint", "the hint describes the box");
      const NOTE_TYPED = "ขอ C-arm  \n\n\n\n  เตรียมเลือด   PRC 2 unit ";
      const NOTE_SAVED = "ขอ C-arm\n\nเตรียมเลือด PRC 2 unit";
      await book(page, {
        date: "2026-11-16",
        hn: HN_TODAY,
        operation: "Perm cath insertion",
        note: NOTE_TYPED,
        room: "or-11",
        shot: async () => {
          await page.locator('[data-testid="case-note"]').scrollIntoViewIfNeeded();
          await ownerShot(page, "booking-note.png");
        },
      });
      assert((await page.inputValue('[data-testid="case-note"]')) === "", "the note is cleared for the next patient");
      assert((await db.query("SELECT note FROM cases WHERE hn = $1", [HN_TODAY])).rows[0]?.note === NOTE_SAVED, "the note as saved");
      // the doctor's own list shows it under the operation, line breaks kept
      assert(
        JSON.stringify(await page.$$eval('[data-testid="my-case-note"]', (els) => els.map((e) => e.textContent))) === JSON.stringify([`หมายเหตุ: ${NOTE_SAVED}`]),
        `the note in the doctor's list: ${JSON.stringify(await page.$$eval('[data-testid="my-case-note"]', (els) => els.map((e) => e.textContent)))}`,
      );
      // the doctor picks the dressing room: the scrub question opens over the form (Pong, 15 Nov 2026)
      const dressingCase = { date: "2026-11-17", hn: HN_X_MISSING, operation: "Dresing wound back" };
      await fillCase(page, dressingCase);
      await pickDressing(page);
      assert((await page.locator("dialog[open]").count()) === 2, "the question lies over the booking form, which stays open");
      assert((await textOf(page, "#scrub-title")) === "scrub ทำให้แทนไหม ?", `the question: ${await textOf(page, "#scrub-title")}`);
      assert((await textOf(page, "#scrub-room")) === "ห้องทำแผล OR 10 · วันอังคารที่ 17 พ.ย. 2569", `the room it is about: ${await textOf(page, "#scrub-room")}`);
      assert(JSON.stringify(await page.$$eval(`${scrubDialog} [data-testid^="scrub-"]`, (els) => els.map((e) => e.textContent.trim()))) === JSON.stringify(["ใช่ ฝากทำ", "ไม่ แพทย์ทำเอง", "ย้อนกลับ"]), "the two answers and the way back");
      const onTop = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="scrub-yes"]').getBoundingClientRect();
        return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("dialog")?.dataset.testid;
      });
      assert(onTop === "scrub-dialog", `the question is on top: ${onTop}`);
      await ownerShot(page, "booking-scrub-question.png");
      // Escape, or ย้อนกลับ, without an answer: the department's room again
      await page.keyboard.press("Escape");
      await page.waitForSelector(`${scrubDialog}:not([open])`, { state: "attached" });
      assert(await page.isVisible(`${dialog}[open]`), "Escape closes the question, not the form");
      assert((await choiceOf(page)) === "dept", "no answer: back on OR X");
      await pickDressing(page);
      await page.click('[data-testid="scrub-back"]');
      await page.waitForSelector(`${scrubDialog}:not([open])`, { state: "attached" });
      assert((await choiceOf(page)) === "dept", "ย้อนกลับ: back on OR X");
      // an answer keeps the dressing room, and can be changed
      await pickDressing(page);
      await page.click('[data-testid="scrub-no"]');
      await page.waitForSelector(`${scrubDialog}:not([open])`, { state: "attached" });
      assert((await choiceOf(page)) === "dressing", "answered: the dressing room");
      assert((await textOf(page, '[data-testid="case-room-why"]')) === "scrub ทำให้แทนไหม ? ไม่ แพทย์ทำเอง", `the answer said: ${await textOf(page, '[data-testid="case-room-why"]')}`);
      await page.click('[data-testid="case-scrub-change"]');
      await page.waitForSelector(`${scrubDialog}[open]`);
      assert((await page.getAttribute('[data-testid="scrub-no"]', "aria-pressed")) === "true", "the answer given is marked");
      await page.keyboard.press("Escape");
      await page.waitForSelector(`${scrubDialog}:not([open])`, { state: "attached" });
      assert((await choiceOf(page)) === "dressing", "looking again without a new answer keeps the old one");
      await page.click('[data-testid="case-scrub-change"]');
      await page.waitForSelector(`${scrubDialog}[open]`);
      await page.click('[data-testid="scrub-yes"]');
      await page.waitForSelector(`${scrubDialog}:not([open])`, { state: "attached" });
      await saveCase(page, { ...dressingCase, room: "or-10", dressing: true, shot: () => ownerShot(page, "booking-dressing.png") });
      await book(page, {
        date: "2026-11-17",
        hn: HN_X_MATCH,
        operation: "ORIF Lt distal radius",
        room: "or-11",
        shot: () => ownerShot(page, "booking-filled.png"),
      });
      // the booking's answer, said quietly beside จองห้อง
      await ownerShot(page, "booking-saved.png");
      const mine = await page.$$eval('[data-testid="my-case-hn"]', (els) => els.map((e) => e.textContent.trim()));
      assert(JSON.stringify(mine) === JSON.stringify([`HN ${HN_TODAY}`, `HN ${HN_X_MISSING}`, "HN 7000002"]), `the doctor's bookings: ${JSON.stringify(mine)}`);
      // the dressing room and its answer in the doctor's own list
      assert((await textOf(page, '[data-testid="my-case-scrub"]')) === "ฝาก scrub ทำ", "the scrub answer in the doctor's list");
      const rows = await db.query(
        "SELECT c.op_date::text AS d, c.room_id, c.hn, coalesce(c.operation, '') AS op, c.dressing, c.scrub_does FROM cases c JOIN users u ON u.id = c.surgeon_id WHERE u.first_name || ' ' || u.last_name = $1 ORDER BY c.id",
        [RP.drX.name],
      );
      assert(
        JSON.stringify(rows.rows) ===
          JSON.stringify([
            { d: "2026-11-16", room_id: "or-11", hn: HN_TODAY, op: "Perm cath insertion", dressing: false, scrub_does: null },
            { d: "2026-11-17", room_id: "or-10", hn: HN_X_MISSING, op: "Dresing wound back", dressing: true, scrub_does: true },
            { d: "2026-11-17", room_id: "or-11", hn: "7000002", op: "ORIF Lt distal radius", dressing: false, scrub_does: null },
          ]),
        `stored bookings: ${JSON.stringify(rows.rows)}`,
      );
      // 15:00 closes the next workday (Pong): on Monday at 14:59 Tuesday can be booked; once 15:00 passes with the form
      // open, the server refuses Tuesday and the calendar moves on to Wednesday.
      setNow("2026-11-16T14:59:30+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      await page.click('[data-testid="add-case-button"]');
      await page.waitForSelector(`${dialog}[open]`);
      assert((await dateValue(page, "case-date")) === "2026-11-17", "Monday 14:59: Tuesday first");
      await page.fill(`${dialog} input[data-testid="case-hn"]`, "7900003");
      await page.fill('[data-testid="case-operation"]', "AV fistula Lt arm");
      setNow("2026-11-16T15:00:30+07:00");
      await page.click('[data-testid="case-submit"]');
      const rule = "หลังเวลา 15.00 น. ระบบจะปิดรับการจอง ของวันทำการถัดไป";
      const cutOff = `${rule} · จองได้ตั้งแต่ วันพุธที่ 18 พ.ย. 2569`;
      await page.waitForFunction((want) => document.querySelector('[data-testid="case-save-status"]')?.textContent?.trim() === want, cutOff);
      assert((await dateValue(page, "case-date")) === "2026-11-18", `moved on to Wednesday: ${await dateValue(page, "case-date")}`);
      assert((await textOf(page, '[data-testid="case-date-hint"]')) === `${rule} จองได้ตั้งแต่ วันพุธที่ 18 พ.ย. 2569`, "the hint says why");
      await ownerShot(page, "booking-cutoff.png");
      assert((await db.query("SELECT 1 FROM cases WHERE hn = '7900003'")).rowCount === 0, "nothing saved for Tuesday");

      // Fri 4 Dec at 16:30: Mon 7 Dec is a holiday in the BOT stub, so Tue 8 Dec is the next workday, closed after 15:00;
      // the form starts on Wed 9 Dec, and the calendar names the holiday.
      setNow("2026-12-04T16:30:00+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await page.getAttribute("header time", "datetime")) === "2026-12-08", "the board shows Tuesday 8 Dec");
      await page.click('[data-testid="add-case-button"]');
      await page.waitForSelector(`${dialog}[open]`);
      assert((await dateValue(page, "case-date")) === "2026-12-09", `past the holiday and the cut-off: ${await dateValue(page, "case-date")}`);
      await page.click('[data-testid="case-date"]');
      await calendar.waitFor();
      for (const iso of ["2026-12-07", "2026-12-08"]) assert(await calendar.locator(`[data-date="${iso}"]`).isDisabled(), `${iso} closed`);
      assert(!(await calendar.locator('[data-date="2026-12-09"]').isDisabled()), "Wednesday open");
      assert(((await calendar.locator('[data-date="2026-12-07"]').getAttribute("aria-label")) ?? "").includes(","), "the holiday is named on its day");
      // the BOT's holidays named under the calendar (Pong, 15 Nov 2026: "for special holiday, disable click and remark
      // underneath calendar"); the BOT listed this year, so no note that it did not
      const remarks = await textOf(page, '[data-testid="case-date-calendar"] ul');
      // and the hospital's own special holiday, 16 Dec (Pong, 15 Nov 2026: "add 16 ธ.ค. 69 as special holiday กรณีพิเศษ")
      for (const name of ["7 ธ.ค. ชดเชยวันพ่อแห่งชาติ", "10 ธ.ค. วันรัฐธรรมนูญ", "16 ธ.ค. วันหยุดกรณีพิเศษ", "31 ธ.ค. วันสิ้นปี"]) {
        assert(remarks.includes(name), `${name} under the calendar: ${remarks}`);
      }
      assert(await calendar.locator('[data-date="2026-12-16"]').isDisabled(), "16 Dec cannot be booked");
      assert((await page.locator('[data-testid="case-date-calendar-unlisted"]').count()) === 0, "the BOT listed 2569");
      await ownerShot(page, "booking-calendar-holiday.png");
      setNow("2026-11-16T10:00:00+07:00");
      await ctx.close();

      // a second doctor, a general surgeon, books Tuesday too: OR 12
      setNow("2026-11-13T10:00:00+07:00");
      const ctxY = await contextAs(RP.drY);
      const pageY = await ctxY.newPage();
      pageY.on("pageerror", (e) => errors.push(e.message));
      await pageY.goto(`${APP}/`, { waitUntil: "networkidle" });
      await pageY.click('[data-testid="add-case-button"]');
      await pageY.waitForSelector(`${dialog}[open]`);
      await book(pageY, { date: "2026-11-17", hn: HN_Y_MATCH, operation: "Total thyroidectomy", room: "or-12" });
      await ctxY.close();
      setNow("2026-11-16T10:00:00+07:00");

      // the board (Monday, nothing uploaded): the alert for everyone, and the room still opens its booking
      const nurse = await contextAs(RP.nurse);
      const board = await nurse.newPage();
      board.on("pageerror", (e) => errors.push(e.message));
      await board.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await textOf(board, '[data-testid="no-upload-alert"]')) === "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569", "no-upload alert");
      assert((await board.locator('[data-notice-id]').count()) === 1, "the one badge (Pong, 16 Nov 2026)");
      // only doctors (DR) get the booking button (Pong, 16 Nov 2026): not a nurse
      assert((await board.locator('[data-testid="add-case-button"]').count()) === 0, "no booking button for a nurse");
      // in the middle of the strip, with the database-off icon (Pong, 16 Nov 2026)
      const centred = await board.evaluate(() => {
        const strip = document.querySelector('[data-testid="notice-strip"]').getBoundingClientRect();
        const badge = document.querySelector('[data-testid="no-upload-alert"]').getBoundingClientRect();
        return Math.abs(badge.left + badge.width / 2 - (strip.left + strip.width / 2));
      });
      assert(centred <= 1, `the badge is centred: ${centred}px off`);
      assert((await board.locator('[data-testid="no-upload-alert"] svg[data-icon="no-table"]').count()) === 1, "the badge's icon");
      await ownerShot(board, "board-no-upload.png");
      // The strip above the plan keeps one height (Pong, 15 Nov 2026); a tap on the badge opens its message as a chat
      // bubble, and a tap outside, Escape (the badge gets the focus back) or the close button shuts it.
      assert((await board.evaluate(() => document.querySelector('[data-testid="notice-strip"]').getBoundingClientRect().height)) === 60, "the strip's fixed height");
      await board.click('[data-testid="no-upload-alert"]');
      await board.waitForSelector('[data-testid="notice-bubble"]');
      assert((await board.getAttribute('[data-testid="no-upload-alert"]', "aria-expanded")) === "true", "the badge says its bubble is open");
      assert((await textOf(board, "#board-notice-bubble-title")) === "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569", "the bubble's title");
      assert((await textOf(board, "#board-notice-bubble-detail")).includes("15:00–16:00"), "the bubble says when MX uploads");
      await ownerShot(board, "board-notice-open.png");
      // from inside the bubble, so the check fails if the focus is not moved back
      await board.focus('#board-notice-bubble [aria-label="ปิด"]');
      await board.keyboard.press("Escape");
      await board.waitForSelector('[data-testid="notice-bubble"]', { state: "detached" });
      assert(await board.evaluate(() => document.activeElement?.dataset.testid === "no-upload-alert"), "Escape gives the badge the focus back");
      await board.click('[data-testid="no-upload-alert"]');
      await board.waitForSelector('[data-testid="notice-bubble"]');
      await board.click('#board-notice-bubble [aria-label="ปิด"]');
      await board.waitForSelector('[data-testid="notice-bubble"]', { state: "detached" });
      assert(await board.evaluate(() => document.activeElement?.dataset.testid === "no-upload-alert"), "the close button gives the badge the focus back");
      // keyboard focus moving on past the strip closes the bubble
      await board.click('[data-testid="no-upload-alert"]');
      await board.waitForSelector('[data-testid="notice-bubble"]');
      await board.focus("#or-11 .fp-floor");
      await board.waitForSelector('[data-testid="notice-bubble"]', { state: "detached" });
      await board.click('[data-testid="no-upload-alert"]');
      await board.waitForSelector('[data-testid="notice-bubble"]');
      await board.mouse.click(8, 830);
      await board.waitForSelector('[data-testid="notice-bubble"]', { state: "detached" });
      assert((await board.getAttribute('[data-testid="no-upload-alert"]', "aria-expanded")) === "false", "closed by a tap outside");
      // the emergency room's card has no database-off icon in its header (Pong, 16 Nov 2026); OR 9 is EMER in the
      // repair's first half
      await board.click("#or-9 .fp-floor");
      await board.waitForSelector(".sheet-head h2");
      assert((await textOf(board, ".sheet-head h2")) === "OR 9", "OR 9's card");
      assert((await board.locator('[data-testid="room-no-table"]').count()) === 0, "no icon on the emergency room's card");
      await board.keyboard.press("Escape");
      await board.waitForSelector(".sheet-head", { state: "detached" });
      await board.click("#or-11 .fp-floor");
      await board.waitForSelector(".case-row");
      // every other OR room's card says there is no HOSxP table yet
      assert((await board.getAttribute('[data-testid="room-no-table"] svg', "aria-label")) === "ยังไม่มีตาราง HOSxP", "the icon in OR 11's header");
      await ownerShot(board, "room-no-table.png");
      assert(JSON.stringify(await sheetRows(board)) === JSON.stringify([["booking", null, null]]), `OR 11: ${JSON.stringify(await sheetRows(board))}`);
      assert((await textOf(board, ".case-row p")).startsWith("Perm cath insertion"), "the booking's operation, now required");
      // the row's icon alone at its right end (Pong, 15 Nov 2026: "no text"), with the longer name for a screen reader
      const icon = board.locator('.case-row [data-testid="row-icon"]');
      assert((await icon.getAttribute("data-source")) === "booking" && (await icon.locator("svg").count()) === 1, "the booking's icon");
      assert((await icon.textContent()) === "แพทย์จองห้อง" && (await icon.locator(".sr-only").textContent()) === "แพทย์จองห้อง", "only the spoken name");
      // a tap says what it means in a bubble beside it (Pong, 16 Nov 2026), white like the icon; Escape closes only it
      await icon.click();
      const tip = board.locator('[data-testid="row-icon-tip"]');
      assert((await tip.textContent()) === "แพทย์จองห้อง" && (await tip.getAttribute("data-tone")) === "booking", "the booking's meaning in a bubble, amber");
      assert((await icon.getAttribute("aria-expanded")) === "true", "the icon says its bubble is open");
      await board.keyboard.press("Escape");
      await tip.waitFor({ state: "detached" });
      assert((await board.locator(".case-row").count()) === 1, "Escape closed the bubble, not the room");
      // when it was booked, smaller, under the surgeon: Bangkok time in Thai (the database's clock, not the app's)
      const bookedAt = await textOf(board, '.case-row [data-testid="row-booked-at"]');
      assert(/^วันเวลาที่จองคิว : \d{1,2} [ก-๙]+\.(?:[ก-๙]+\.)? \d{2}, \d{2}:\d{2}$/.test(bookedAt), `the booking's time: ${bookedAt}`);
      // the booking's note (Pong, 17 Nov 2026: "each case row has หมายเหตุ => click to open dialog to see details"): a
      // หมายเหตุ button under the time, for the nurse too, that opens the note with its case in a dialog
      const noteButton = board.locator('.case-row [data-testid="row-note"]');
      assert((await noteButton.count()) === 1 && (await noteButton.textContent()).trim() === "หมายเหตุ", "the row's หมายเหตุ button");
      assert((await noteButton.getAttribute("aria-haspopup")) === "dialog", "it says it opens a dialog");
      const noteBox = await noteButton.boundingBox();
      assert(noteBox && noteBox.height >= 24, `the button is tall enough to tap: ${JSON.stringify(noteBox)}`);
      await ownerShot(board, "room-note-button.png");
      const noteDialog = board.locator('[data-testid="case-note-dialog"]');
      await noteButton.click();
      await board.waitForSelector('[data-testid="case-note-dialog"][open]');
      assert((await board.locator('[data-testid="case-note-text"]').textContent()) === NOTE_SAVED, "the note with its line breaks");
      assert((await textOf(board, "#case-note-title")) === "หมายเหตุ" && (await textOf(board, '[data-testid="case-note-room"]')) === "OR 11 · ลำดับ 1", "the title and the case's room");
      const details = await board.$$eval('[data-testid="case-note-details"] > *', (els) => els.map((e) => e.textContent.trim()));
      assert(details.slice(0, 2).join("|") === "การผ่าตัด|Perm cath insertion" && details.includes("ศัลยแพทย์") && details.includes("จองคิว"), `the case: ${JSON.stringify(details)}`);
      assert(!details.includes("HN") && !details.join(" ").includes(HN_TODAY), "no HN for the nurse");
      const lines = await board.locator('[data-testid="case-note-text"]').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
      assert(lines >= 3, `the note keeps its lines: about ${lines}`);
      await ownerShot(board, "room-note-dialog.png");
      // Escape closes the note, not the room, and the button gets the focus back
      await board.keyboard.press("Escape");
      await board.waitForSelector('[data-testid="case-note-dialog"]:not([open])', { state: "attached" });
      assert((await board.locator(".case-row").count()) === 1, "Escape closed the note, not the room");
      assert(await board.evaluate(() => document.activeElement?.dataset.testid === "row-note"), "the button has the focus again");
      // a tap outside the card closes it too, and only it; so does ปิด. A selection dragged from the note out past the
      // card does not.
      await noteButton.click();
      await board.waitForSelector('[data-testid="case-note-dialog"][open]');
      const noteText = await board.locator('[data-testid="case-note-text"]').boundingBox();
      await board.mouse.move(noteText.x + 12, noteText.y + noteText.height / 2);
      await board.mouse.down();
      await board.mouse.move(6, 6, { steps: 4 });
      await board.mouse.up();
      assert(await noteDialog.evaluate((el) => el.open), "a selection dragged out of the card keeps the note open");
      await board.mouse.click(6, 6);
      await board.waitForSelector('[data-testid="case-note-dialog"]:not([open])', { state: "attached" });
      assert((await board.locator(".case-row").count()) === 1, "a tap outside closed the note, not the room");
      await noteButton.click();
      await board.click('[data-testid="case-note-close"]');
      await board.waitForSelector('[data-testid="case-note-dialog"]:not([open])', { state: "attached" });
      assert(!(await noteDialog.evaluate((el) => el.open)), "ปิด closes it");
      // the dressing room shows who does the dressing instead (Pong, 15 Nov 2026): doctor X said the scrub does, for
      // Tuesday, before Tuesday's upload
      await board.goto(`${APP}/?date=2026-11-17&room=or-10`, { waitUntil: "networkidle" });
      await board.waitForSelector(".case-row");
      assert(JSON.stringify(await rowIcons(board)) === JSON.stringify(["scrub"]), `OR 10's icon: ${JSON.stringify(await rowIcons(board))}`);
      await board.click('.case-row [data-testid="row-icon"]');
      const scrubTip = board.locator('[data-testid="row-icon-tip"]');
      assert((await scrubTip.textContent()) === "ฝาก scrub ทำ", "the scrub's name in a bubble");
      assert((await scrubTip.evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(228, 154, 162)", "pink, like the nurse");
      await board.click(".room-sheet h2");
      await scrubTip.waitFor({ state: "detached" });
      assert((await board.locator('.case-row [data-testid="row-icon"][data-source]').count()) === 0, "no source icon in the dressing room");
      assert((await board.locator('.case-row [data-testid="row-note"]').count()) === 0, "a booking without a note has no หมายเหตุ button");
      await ownerShot(board, "room-sheet-dressing-booked.png");
      await nurse.close();

      // HN: the booking doctor sees theirs; nobody else gets another doctor's in the page at all
      const nurseHtml = (await htmlAs(RP.nurse)).html;
      const yHtml = (await htmlAs(RP.drY)).html;
      const xHtml = (await htmlAs(RP.drX)).html;
      for (const hn of [HN_TODAY, HN_X_MISSING, "7000002"]) {
        assert(!nurseHtml.includes(hn), "no HN in the nurse's page");
        assert(!yHtml.includes(hn), "no HN of doctor X's bookings in doctor Y's page");
        assert(xHtml.includes(hn), "doctor X's own HNs in their page");
      }
      assert(yHtml.includes(HN_Y_MATCH) && !xHtml.includes(HN_Y_MATCH) && !nurseHtml.includes(HN_Y_MATCH), "doctor Y's HN only in their own page");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
    });

    await t("MX upload: closed before 15:00; .xls refused; a file of other days refused; refused by the server at 16:00; accepted in the window, with its summary", async () => {
      setNow("2026-11-16T14:30:00+07:00");
      const ctx = await contextAs(RP.mx);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/upload`, { waitUntil: "networkidle" });
      assert((await textOf(page, "header p")) === "ผู้จัดการตาราง", `MX's eyebrow: ${await textOf(page, "header p")}`);
      assert((await textOf(page, "#upload-title")) === "ตารางของวันอังคารที่ 17 พฤศจิกายน 2569", `the target day: ${await textOf(page, "#upload-title")}`);
      assert((await textOf(page, '[data-testid="upload-window"]')) === "ยังไม่เปิดรับ", "the window is not open yet");
      assert(await page.isDisabled('[data-testid="upload-submit"]'), "MX cannot send before 15:00");
      assert(!(await textOf(page, '[data-testid="upload-card"]')).includes("ผู้ดูแลอัปโหลดได้ทุกเวลา"), "no admin note for MX");
      const admin = (await htmlAs(RP.admin, "/upload")).html;
      assert(admin.includes("ผู้ดูแลอัปโหลดได้ทุกเวลา") && admin.includes("ผู้ดูแลระบบ"), "the admin may upload at any time");

      setNow("2026-11-16T15:10:00+07:00");
      await page.reload({ waitUntil: "networkidle" });
      assert((await textOf(page, '[data-testid="upload-window"]')) === "เปิดรับอยู่", "open from 15:00");
      assert(!(await page.isDisabled('[data-testid="upload-submit"]')), "MX can send now");
      const result = async () => {
        await page.waitForSelector('[data-testid="upload-result"]');
        return textOf(page, '[data-testid="upload-result"]');
      };
      const send = async (file) => {
        // choosing a file clears the last answer, so the answer waited for is this file's
        await page.setInputFiles('[data-testid="upload-file"]', file);
        await page.click('[data-testid="upload-submit"]');
        await page.waitForFunction(
          () => document.querySelector('[data-testid="upload-result"]') && document.querySelector('[data-testid="upload-submit"]')?.getAttribute("aria-busy") !== "true",
        );
        return result();
      };
      // the picker speaks Thai (Pong, 17 Nov 2026: "translate upload input to Thai"), the file's name once one is chosen
      assert((await textOf(page, '[data-testid="upload-picker"]')).includes("เลือกไฟล์"), "a Thai เลือกไฟล์ button");
      assert((await textOf(page, '[data-testid="upload-file-name"]')) === "ยังไม่ได้เลือกไฟล์", "no file yet");
      // an .xls is refused by its name before it is sent
      await page.setInputFiles('[data-testid="upload-file"]', { name: "or-export.xls", mimeType: "application/vnd.ms-excel", buffer: OLE });
      assert((await textOf(page, '[data-testid="upload-file-name"]')) === "or-export.xls", "the chosen file's name");
      await page.waitForSelector("#upload-file-problem");
      assert((await textOf(page, "#upload-file-problem")).includes("บันทึกเป็น .xlsx"), `xls by name: ${await textOf(page, "#upload-file-problem")}`);
      // an .xls renamed .xlsx is refused by the server, which reads the file itself
      assert((await send({ name: "or-export.xlsx", mimeType: XLSX_TYPE, buffer: OLE })).includes("บันทึกเป็น .xlsx"), "renamed xls refused");
      // the whole sample holds several days: refused, and the message names the day it must be
      const several = await send(SAMPLE_WORKBOOK);
      assert(several.includes("ต้องเป็นตารางวันที่ 17 พ.ย. 2569 เท่านั้น"), `a file of other days: ${several}`);
      // one short line however many days the file holds (Pong, 17 Nov 2026: "concise alert message")
      assert(!several.includes(",") && several.length < 120, `a span of days, not a list: ${several}`);
      // the right file, but 16:00 has struck by the time it is sent: the server's clock decides
      await page.setInputFiles('[data-testid="upload-file"]', E2E_WORKBOOK);
      setNow("2026-11-16T16:00:00+07:00");
      await page.click('[data-testid="upload-submit"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="upload-result"]')?.textContent?.includes("15:00–16:00"));
      assert((await result()) === "อัปโหลดได้เฉพาะ 15:00–16:00 น.", `after 16:00: ${await result()}`);
      assert((await db.query("SELECT count(*)::int AS n FROM workbook_uploads")).rows[0].n === 0, "nothing saved so far");

      // inside the window: saved, and the page shows the upload with its summary and the matching
      setNow("2026-11-16T15:20:00+07:00");
      await page.click('[data-testid="upload-submit"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="upload-result"] [role="status"]'));
      assert(
        (await result()) === "บันทึกตารางของวันอังคารที่ 17 พ.ย. 2569 แล้ว ลงห้อง 8 จาก 8 เคส · ขึ้นกระดานเวลา 16:00 น.",
        `saved: ${await result()}`,
      );
      await page.waitForSelector('[data-testid="upload-matching"]');
      assert((await textOf(page, '[data-testid="upload-latest"] h2 + p')) === `15:20 น. · ${RP.mx.name}`, "when and by whom");
      const stats = await page.$$eval('[data-testid="upload-latest"] dd', (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
      // 4 HOSxP cases nobody booked (not the 2 dressings: nobody need book the dressing room) and 1 booking HOSxP lacks.
      // Of the 9 kept only Tha Chalom's case is cut: the vascular case goes to the mixed room OR 11 (Pong, 18 Nov 2026:
      // "Vas stay on others room if not emer").
      assert(JSON.stringify(stats) === JSON.stringify(["17 แถว", "9 เคส", "8 เคส", "5 รายการ"]), `counts: ${JSON.stringify(stats)}`);
      const latest = await textOf(page, '[data-testid="upload-latest"]');
      for (const line of ["ยกเลิกการผ่าตัด", "เคสของ รพ.นครท่าฉลอม", "OR 12 · GENSX", "ID ซ้ำ นับครั้งเดียว"]) assert(latest.includes(line), `summary shows ${line}`);
      assert((await textOf(page, '[data-testid="upload-matching"]')) === "แพทย์จองไว้ 3 รายการ · ตรงกัน 2 รายการ", `matching: ${await textOf(page, '[data-testid="upload-matching"]')}`);
      assert((await page.locator('[data-testid="upload-unbooked"] li').count()) === 4, "four HOSxP cases nobody booked, outside the dressing room");
      const missing = await textOf(page, '[data-testid="upload-not-in-hosxp"]');
      assert(missing.includes(`HN ${HN_X_MISSING}`) && missing.includes(RP.drX.name) && missing.includes("OR 10"), `the booking HOSxP does not list: ${missing}`);

      // stored: one upload for Tuesday made on Monday, its cases with normalised HNs and, of the patient, only the name
      const up = (await db.query("SELECT id, cycle_day::text AS c, target_date::text AS t, uploaded_by, uploader_name, file_name, total_rows, kept, placed FROM workbook_uploads")).rows;
      assert(
        up.length === 1 && up[0].c === "2026-11-16" && up[0].t === "2026-11-17" && up[0].uploaded_by === RP.mx.sub && up[0].uploader_name === RP.mx.name &&
          up[0].file_name === "e2e-or-export.xlsx" && up[0].total_rows === 17 && up[0].kept === 9 && up[0].placed === 8,
        `upload row: ${JSON.stringify(up)}`,
      );
      const cases = (
        await db.query("SELECT (to_jsonb(w) - 'patient_name')::text AS j, patient_name, hn, room_id FROM workbook_cases w WHERE upload_id = $1 ORDER BY position", [up[0].id])
      ).rows;
      assert(cases.length === 8 && cases.some((c) => c.hn === "7000015" && c.room_id === "or-12"), `stored cases: ${cases.length}`);
      // The name (Pong, 16 Nov 2026: "Add patient name line above HN") in its own column, the made-up one from the file.
      assert(cases.every((c) => /^ตัวอย่าง ผู้ป่วย\d+$/.test(c.patient_name ?? "")), "each case keeps the patient's name");
      assert(cases.every((c) => !/ผู้ป่วย|ประกัน|690000|ปี \d/.test(c.j)), "no other patient field (age, AN, cover) stored");

      await page.setViewportSize({ width: 360, height: 780 });
      await noSideScroll(page, "/upload at 360px");
      await page.setViewportSize({ width: 390, height: 844 });
      await touchTargets(page, "/upload");
      await ownerShot(page, "upload-summary.png", { tall: true });
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
    });

    await t("16:00: the board turns to Tuesday with the upload: booked rows first, a booking HOSxP lacks gone, icons, an empty notice strip; HN only for who may see it", async () => {
      // until 16:00 the board keeps Monday: the upload is the next cycle's
      setNow("2026-11-16T15:59:00+07:00");
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดวันนี้", "Monday's board until 16:00");
      assert((await textOf(page, '[data-testid="no-upload-alert"]')) === "ยังไม่มีตาราง HOSxP ของ 16 พ.ย. 2569", "Monday has no upload of its own");

      setNow("2026-11-16T16:30:00+07:00");
      await page.reload({ waitUntil: "networkidle" });
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดถัดไป", "tomorrow's list");
      assert((await page.getAttribute("header time", "datetime")) === "2026-11-17", "dated Tuesday");
      assert((await page.locator('[data-testid="no-upload-alert"]').count()) === 0, "uploaded: no alert");
      // no ไม่ตรง badge since 16 Nov 2026: the strip is empty; the rooms keep their mismatch marks
      assert((await page.locator("[data-notice-id]").count()) === 0, `uploaded: an empty strip: ${await textOf(page, "[data-notice-strip]")}`);
      // nor an admin who is not a doctor
      assert((await page.locator('[data-testid="add-case-button"]').count()) === 0, "no booking button for an admin who is not a DR");
      // test mode is for admins only: on a day with its upload, a non-admin's /?notices=all has no false "no table" badge
      // or room icon
      {
        const viewer = await contextAs(RP.nurse);
        const other = await viewer.newPage();
        await other.goto(`${APP}/?notices=all&room=or-12`, { waitUntil: "networkidle" });
        await other.waitForSelector(".sheet-head h2");
        assert((await other.locator("[data-notice-id]").count()) === 0, "no test notices for a non-admin");
        assert((await other.locator('[data-testid="room-no-table"]').count()) === 0, "no room icon for a non-admin");
        await viewer.close();
        // and an admin's does show both, the room's icon too
        await page.goto(`${APP}/?notices=all&room=or-12`, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-testid="room-no-table"]');
        assert((await page.locator('[data-notice-id="no-upload"]').count()) === 1, "an admin's test notice");
        await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      }
      // HOSxP's cases nobody booked, but not the dressing room's; the booking HOSxP does not list is off the board
      for (const [room, flagged] of [["or-10", false], ["or-11", true], ["or-12", true], ["or-13", false]]) {
        const label = (await page.getAttribute(`#${room} .fp-floor`, "aria-label")) ?? "";
        assert(label.includes("ข้อมูลไม่ตรงกับการจอง") === flagged, `${room} mismatch mark: ${label}`);
      }
      await ownerShot(page, "board-after-upload.png");

      // OR 12: doctor Y's booking matched first, then HOSxP's cases nobody booked (Pong, 15 Nov 2026: bookings first,
      // then HOSxP's order); 7000011, a general surgeon's endoscopy, is GENSX's since the scope rule went (Pong, 19 Nov
      // 2026: "now base on surgeon name and dept only, no more scope case"). In the dressing room OR 10, HOSxP's I&D and dressing nobody booked, with no flag, and not
      // doctor X's dressing-room booking, which HOSxP does not list ("no real patient set"). Doctor X's matched case is
      // in OR 13, where HOSxP's list places it (ORTHO), not OR 11, the mixed room the booking was in: after the upload
      // MX's list decides the room, unless the doctor picked the dressing room.
      await page.goto(`${APP}/?room=or-12`, { waitUntil: "networkidle" });
      await page.waitForSelector(".case-row");
      assert(
        JSON.stringify(await sheetRows(page)) ===
          JSON.stringify([
            ["matched", null, `HN ${HN_Y_MATCH}`],
            ["hosxp", "unbooked", "HN 7000001"],
            ["hosxp", "unbooked", "HN 7000011"],
          ]),
        `OR 12 for the admin: ${JSON.stringify(await sheetRows(page))}`,
      );
      // the icons alone: a handshake for the match, a database for HOSxP's case nobody booked; no word chips at all
      assert(JSON.stringify(await rowIcons(page)) === JSON.stringify(["matched", "hosxp", "hosxp"]), `OR 12's icons: ${JSON.stringify(await rowIcons(page))}`);
      const badges = await page.$$eval(".case-row .badge", (els) => els.map((e) => e.textContent.trim()));
      assert(badges.every((text) => text === "นอกเวลา"), `no chips but นอกเวลา: ${JSON.stringify(badges)}`);
      assert((await page.locator(".case-row").nth(0).textContent()).includes("Total thyroidectomy"), "a matched row has the workbook's operation");
      // each row: the operation, the HN on its own line, the surgeon as large as the HN, then when it was booked,
      // smaller; the icon at the right end, centred on the row's height
      const layout = await page.$$eval(".case-row", (rows) =>
        rows.map((row) => {
          const lines = [...row.querySelectorAll(":scope > div > p")];
          const size = (testid) => {
            const line = row.querySelector(`[data-testid="${testid}"]`);
            return line ? Number.parseFloat(getComputedStyle(line).fontSize) : null;
          };
          const text = row.querySelector(":scope > div").getBoundingClientRect();
          const icon = row.querySelector('[data-testid="row-icon"]').getBoundingClientRect();
          const box = row.getBoundingClientRect();
          return {
            lines: lines.map((line) => line.dataset.testid ?? "?"),
            patient: size("row-patient"),
            hn: size("row-hn"),
            surgeonText: row.querySelector('[data-testid="row-surgeon"]').textContent.trim(),
            opWrap: getComputedStyle(row.querySelector("[data-op-id]")).whiteSpace,
            surgeon: size("row-surgeon"),
            bookedAt: size("row-booked-at"),
            iconRight: Math.round(box.right - icon.right),
            iconAfterText: icon.left >= text.right,
            iconMiddle: Math.abs(icon.top + icon.height / 2 - (box.top + box.height / 2)),
            iconSize: Math.round(icon.width),
            visibleText: row.querySelector('[data-testid="row-icon"]').innerText.trim(),
          };
        }),
      );
      assert(JSON.stringify(layout.map((row) => row.lines)) === JSON.stringify([
        ["row-op", "row-patient", "row-hn", "row-surgeon", "row-booked-at"],
        ["row-op", "row-patient", "row-hn", "row-surgeon"],
        ["row-op", "row-patient", "row-hn", "row-surgeon"],
      ]), `the rows' lines: ${JSON.stringify(layout)}`);
      for (const row of layout) {
        assert(row.patient === 15 && row.hn === 15 && row.surgeon === 15, `the patient's name, the HN and the surgeon at 15px: ${JSON.stringify(row)}`);
        // the surgeon without นพ./พญ. (Pong, 16 Nov 2026: "No นพ พญ prefix"), the operation on one line
        assert(row.surgeonText === "ตัวอย่าง ศัลย์ทั่วไป", `the surgeon without a title: ${row.surgeonText}`);
        assert(row.opWrap === "nowrap", `the operation on one line: ${JSON.stringify(row)}`);
        assert(row.iconAfterText && row.iconRight <= 24 && row.iconMiddle <= 1 && row.iconSize >= 40, `the icon at the right, centred: ${JSON.stringify(row)}`);
      }
      assert(layout[0].bookedAt === 12, `the booking's time smaller: ${layout[0].bookedAt}`);
      // names that fit are plain text; the matched icon's meaning in a green bubble, closed by a tap elsewhere
      assert((await page.locator('.case-row [data-testid="row-op"] button').count()) === 0, "no name is cut at 390px");
      await page.click('.case-row [data-testid="row-icon"]');
      const matchedTip = page.locator('[data-testid="row-icon-tip"]');
      assert((await matchedTip.textContent()) === "ตาราง HOSxP ตรงกับการจอง" && (await matchedTip.getAttribute("data-tone")) === "matched", "the matched meaning");
      // the HOSxP-only database icon has its own blue, apart from the calendar's amber (Pong, 16 Nov 2026)
      const hosxpBg = await page.$eval('.case-row [data-testid="row-icon"][data-source="hosxp"]', (el) => getComputedStyle(el).backgroundColor);
      assert(hosxpBg === "rgb(228, 238, 247)", `the database icon's blue tile: ${hosxpBg}`);
      await ownerShot(page, "room-sheet-icon-tip.png");
      // a tap on the dimmed plan above the sheet closes the bubble and keeps the room open, like the account menu
      await page.click('button[aria-label="ปิดรายการห้อง"]', { position: { x: 195, y: 300 } });
      await matchedTip.waitFor({ state: "detached" });
      assert((await page.locator(".room-sheet .case-row").count()) === 3, "the room stays open when a tap on the plan closes a bubble");
      // on a 320px phone the long name ends in "…" and a chevron; a tap unfolds it in place, another folds it
      await page.setViewportSize({ width: 320, height: 844 });
      const cutName = page.locator('.case-row [data-testid="row-op"] button').first();
      await cutName.waitFor();
      const opHeight = () => cutName.locator("[data-op-id]").evaluate((el) => el.getBoundingClientRect().height);
      assert((await cutName.getAttribute("aria-expanded")) === "false" && (await opHeight()) < 30, "folded on one line");
      assert((await cutName.locator("[data-op-id]").evaluate((el) => el.scrollWidth > el.clientWidth)), "the name is cut with an ellipsis");
      await cutName.click();
      assert((await cutName.getAttribute("aria-expanded")) === "true" && (await opHeight()) > 30, "unfolded over two lines");
      await ownerShot(page, "room-sheet-name-open.png");
      await cutName.click();
      assert((await cutName.getAttribute("aria-expanded")) === "false" && (await opHeight()) < 30, "folded again");
      // a tap on the bubble closes it and reaches nothing under it
      const cutIndex = await page.$$eval(".case-row", (rows) => rows.findIndex((row) => row.querySelector('[data-testid="row-op"] button')));
      const cutRow = page.locator(".case-row").nth(cutIndex);
      await cutRow.locator('[data-testid="row-icon"]').click();
      await page.locator('[data-testid="row-icon-tip"]').click();
      await page.locator('[data-testid="row-icon-tip"]').waitFor({ state: "detached" });
      assert((await cutName.getAttribute("aria-expanded")) === "false", "a tap on the bubble unfolds nothing");
      // unfolded with the keyboard, then the sheet widens so the whole name fits: it stays open until folded, then it is
      // plain text, and the focus goes to the row's icon rather than nowhere
      await cutName.focus();
      await page.keyboard.press("Enter");
      assert((await cutName.getAttribute("aria-expanded")) === "true", "unfolded with Enter");
      await page.setViewportSize({ width: 390, height: 844 });
      assert((await cutName.getAttribute("aria-expanded")) === "true", "kept open when the sheet widens");
      await page.keyboard.press("Enter");
      await cutRow.locator('[data-testid="row-op"] button').waitFor({ state: "detached" });
      assert(await cutRow.locator('[data-testid="row-icon"]').evaluate((el) => el === document.activeElement), "the focus moves to the row's icon");
      // moving the focus away closes an open bubble
      await page.keyboard.press("Enter");
      await page.locator('[data-testid="row-icon-tip"]').waitFor();
      await page.keyboard.press("Shift+Tab");
      await page.locator('[data-testid="row-icon-tip"]').waitFor({ state: "detached" });
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
      await ownerShot(page, "room-sheet.png");
      await page.goto(`${APP}/?room=or-10`, { waitUntil: "networkidle" });
      await page.waitForSelector(".case-row");
      const dressingRoom = await sheetRows(page);
      assert(
        JSON.stringify(dressingRoom) === JSON.stringify([["hosxp", null, "HN 7000003"], ["hosxp", null, "HN 7000010"]]),
        `OR 10: ${JSON.stringify(dressingRoom)}`,
      );
      // who does each dressing instead of where it came from: nobody booked these, so the doctor
      assert(JSON.stringify(await rowIcons(page)) === JSON.stringify(["surgeon", "surgeon"]), `OR 10's icons: ${JSON.stringify(await rowIcons(page))}`);
      await page.click('.case-row [data-testid="row-icon"]');
      const doctorTip = page.locator('[data-testid="row-icon-tip"]');
      assert((await doctorTip.textContent()) === "แพทย์ทำเอง", "the doctor's name in a bubble");
      assert((await doctorTip.evaluate((el) => getComputedStyle(el).backgroundColor)) === "rgb(127, 191, 183)", "green, like the doctor's scrubs");
      await doctorTip.click();
      await doctorTip.waitFor({ state: "detached" });
      assert((await page.locator(".room-sheet .case-row").count()) === 2, "a tap on the bubble closes only the bubble");
      await ownerShot(page, "room-sheet-dressing.png");
      await page.goto(`${APP}/?room=or-13`, { waitUntil: "networkidle" });
      await page.waitForSelector(".case-row");
      const orthoRoom = await sheetRows(page);
      assert(orthoRoom.some((row) => JSON.stringify(row) === JSON.stringify(["matched", null, "HN 7000002"])), `OR 13: ${JSON.stringify(orthoRoom)}`);
      await page.goto(`${APP}/?room=or-11`, { waitUntil: "networkidle" });
      await page.waitForSelector(".case-row");
      const mixedRoom = await sheetRows(page);
      assert(!mixedRoom.some((row) => row[0] === "matched"), `OR 11 has no matched pair: ${JSON.stringify(mixedRoom)}`);

      // the HN in each viewer's page: everything for MX, a doctor's own bookings only, none for a nurse
      const html = {};
      for (const key of ["mx", "nurse", "drX", "drY"]) html[key] = (await htmlAs(RP[key])).html;
      const placed = ["7000001", "7000002", "7000003", "7000010", "7000011", "7000013", "7000014", "7000015"];
      for (const hn of placed) assert(html.mx.includes(hn), `MX sees ${hn}`);
      assert(!html.mx.includes(HN_X_MISSING), "the booking HOSxP does not list is off the board, even for MX");
      for (const hn of [...WORKBOOK_HNS, HN_TODAY, HN_X_MISSING]) assert(!html.nurse.includes(hn), "no HN in the nurse's page");
      for (const hn of WORKBOOK_HNS.filter((h) => h !== "7000002")) assert(!html.drX.includes(hn), "doctor X gets no HN but their own");
      for (const hn of [...WORKBOOK_HNS.filter((h) => h !== HN_Y_MATCH), HN_TODAY, HN_X_MISSING]) assert(!html.drY.includes(hn), "doctor Y gets no HN but their own");
      assert(html.drX.includes("7000002") && html.drY.includes(HN_Y_MATCH), "each doctor's own HNs");
      // the patient's name goes with the HN: every one for MX, a doctor's own case only, none for a nurse
      const patients = (page) => new Set(page.match(/ตัวอย่าง ผู้ป่วย\d+/g) ?? []);
      assert(patients(html.mx).size >= 7, `MX sees the patients' names: ${[...patients(html.mx)]}`);
      assert(patients(html.nurse).size === 0, "no patient's name in the nurse's page");
      assert(patients(html.drX).size === 1 && patients(html.drY).size === 1, `each doctor sees only their own patient's name: ${[...patients(html.drX)]} ${[...patients(html.drY)]}`);
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
      rmSync(NOW_FILE, { force: true });
    });

    await t("the board's date picks another day: a floating month calendar in Thai, a day's own HOSxP list, back to the current board", async () => {
      // Tuesday after 16:00: the board shows Wednesday, which has no upload yet
      setNow("2026-11-17T17:00:00+07:00");
      const ctx = await contextAs(RP.nurse);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      const shownDay = () => page.getAttribute("header time", "datetime");
      assert((await shownDay()) === "2026-11-18", "after 16:00 the board shows Wednesday");
      const dialog = page.locator('[data-testid="board-date-dialog"]');
      const day = (iso) => page.locator(`#board-date-calendar [data-date="${iso}"]`);
      const openPicker = async () => {
        await page.click('[data-testid="board-date-button"]');
        await dialog.waitFor({ state: "visible" });
      };
      // the date (and the line above it) is a 44px target that opens the calendar in a floating card over a tinted page
      const target = await page.evaluate(() => {
        const box = document.querySelector('[data-testid="board-date-button"]').parentElement.parentElement.getBoundingClientRect();
        return box.height;
      });
      assert(target >= 44, `the date block is a 44px target: ${target}`);
      await openPicker();
      assert((await dialog.evaluate((el) => el.matches(":modal"))) === true, "a modal card");
      assert((await textOf(page, "#board-date-calendar-title")) === "พฤศจิกายน 2569", "opens on the board's month, in Thai with the Buddhist year");
      assert((await day("2026-11-18").getAttribute("aria-pressed")) === "true", "the board's day is the picked one");
      assert((await day("2026-11-17").getAttribute("aria-current")) === "date", "today is marked");
      assert(await day("2026-11-22").isDisabled(), "a Sunday is closed");
      assert((await page.locator('[data-testid="board-date-current"]').count()) === 0, "no way back needed on the board's own day");
      // back to 1 Jan 2026, the first half's first day (Pong, 18 Nov 2026: "allow view calendar backward"; until then
      // "current and future day only"), up to the repair's last day ("Calendar confine Within time range"): January
      // 2569 to March 2570
      assert(await day("2026-11-16").isEnabled(), "yesterday can be picked");
      assert(await page.locator('#board-date-calendar [data-nav="prev"]').isEnabled(), "the months before this one can be shown");
      assert(await page.locator('#board-date-calendar [data-nav="next"]').isEnabled(), "December can be shown");
      await ownerShot(page, "board-date-picker.png");
      // a swipe turns the month (Pong, 15 Nov 2026: "allow swipe back and forth"): to the left the next month, to the
      // right the one before, never past the months that can be picked; a scroll up or down turns nothing, and the day
      // the finger lifts from is not picked
      const title = () => textOf(page, "#board-date-calendar-title");
      await swipe(page, '#board-date-calendar [role="grid"]', 120);
      assert((await title()) === "ตุลาคม 2569", `swiped back to October: ${await title()}`);
      await swipe(page, '#board-date-calendar [role="grid"]', -120);
      assert((await title()) === "พฤศจิกายน 2569", `swiped on to November: ${await title()}`);
      await swipe(page, '#board-date-calendar [role="grid"]', -120);
      assert((await title()) === "ธันวาคม 2569", `swiped to December: ${await title()}`);
      await swipe(page, '#board-date-calendar [role="grid"]', -30, 100);
      assert((await title()) === "ธันวาคม 2569", `an up-and-down move turns nothing: ${await title()}`);
      await swipe(page, '#board-date-calendar [role="grid"]', 120);
      assert((await title()) === "พฤศจิกายน 2569", `swiped back to November: ${await title()}`);
      assert(await dialog.isVisible(), "still open: no day picked by a swipe");
      assert((await shownDay()) === "2026-11-18" && !new URL(page.url()).searchParams.has("date"), "the board's day unchanged");
      // Escape closes it and the date gets the focus back
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert(await page.evaluate(() => document.activeElement?.dataset.testid === "board-date-button"), "the focus goes back to the date");
      // a tap outside the card closes it too
      await openPicker();
      await page.mouse.click(4, 840);
      await dialog.waitFor({ state: "hidden" });
      // a tap on the date that closes the account menu only closes the menu
      await page.click('[data-testid="user-menu"]');
      await page.locator('[data-testid="account-menu"]').waitFor({ state: "visible" });
      const dateBox = await page.locator('[data-testid="board-eyebrow"]').boundingBox();
      await page.mouse.click(dateBox.x + 4, dateBox.y + dateBox.height / 2);
      await page.locator('[data-testid="account-menu"]').waitFor({ state: "hidden" });
      await page.waitForTimeout(300);
      assert(!(await dialog.isVisible()), "the tap that closed the menu did not open the calendar");
      // the line above the date carries the picker's chevron, so the date keeps its room
      assert((await page.locator('[data-testid="board-date-chevron"]').count()) === 1, "the chevron by the line above the date");

      // today, after 16:00: Tuesday's HOSxP list again, with its mismatches
      await openPicker();
      await day("2026-11-17").click();
      await page.waitForURL((url) => url.searchParams.get("date") === "2026-11-17");
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2026-11-17");
      await dialog.waitFor({ state: "hidden" });
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดวันนี้", "today's eyebrow");
      assert((await page.locator("[data-notice-id]").count()) === 0, `Tuesday has its upload: ${await textOf(page, "[data-notice-strip]")}`);
      await ownerShot(page, "board-picked-day.png");
      // a room opened on the picked day keeps it, and shows that day's cases
      await page.goto(`${APP}/?date=2026-11-17&room=or-12`, { waitUntil: "networkidle" });
      await page.waitForSelector(".case-row");
      assert((await page.locator(".case-row").count()) === 3, `OR 12 on Tuesday: ${await page.locator(".case-row").count()} rows`);
      // Escape in the card closes the card only: the room stays open behind it
      await openPicker();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.waitForTimeout(300);
      assert((await page.locator(".case-row").count()) === 3 && new URL(page.url()).searchParams.get("room") === "or-12", "the room stays open");
      await page.goto(`${APP}/?date=2026-11-17`, { waitUntil: "networkidle" });

      // a day in the repair's second half draws the second half's plan; the calendar ends on the repair's last day
      assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "1", "Tuesday is in the first half");
      await openPicker();
      for (const month of ["ธันวาคม 2569", "มกราคม 2570", "กุมภาพันธ์ 2570", "มีนาคม 2570"]) {
        await page.click('#board-date-calendar [data-nav="next"]');
        assert((await textOf(page, "#board-date-calendar-title")) === month, `the next month: ${month}`);
        if (month !== "ธันวาคม 2569") continue;
        // the BOT's holidays cannot be picked and are named under the calendar (Pong, 15 Nov 2026)
        // and the hospital's own, 16 Dec (Pong, 15 Nov 2026: "add 16 ธ.ค. 69 as special holiday กรณีพิเศษ")
        const named = [["2026-12-07", "ชดเชยวันพ่อแห่งชาติ"], ["2026-12-10", "วันรัฐธรรมนูญ"], ["2026-12-16", "วันหยุดกรณีพิเศษ"], ["2026-12-31", "วันสิ้นปี"]];
        for (const [iso, name] of named) {
          assert(await day(iso).isDisabled(), `${iso} is closed`);
          assert(((await day(iso).getAttribute("aria-label")) ?? "").endsWith(name), `${iso} is named on its day`);
        }
        const remarks = await page.$$eval("#board-date-calendar ul li", (items) => items.map((li) => li.textContent.replace(/\s+/g, " ").trim()));
        assert(
          JSON.stringify(remarks) === JSON.stringify(["7 ธ.ค. ชดเชยวันพ่อแห่งชาติ", "10 ธ.ค. วันรัฐธรรมนูญ", "16 ธ.ค. วันหยุดกรณีพิเศษ", "31 ธ.ค. วันสิ้นปี"]),
          `December's holidays under the calendar: ${JSON.stringify(remarks)}`,
        );
        assert((await page.locator('[data-testid="board-date-calendar-unlisted"]').count()) === 0, "the BOT listed 2569");
        await ownerShot(page, "board-date-holidays.png");
      }
      assert(await page.locator('#board-date-calendar [data-nav="next"]').isDisabled(), "no month after the repair");
      assert(await day("2027-03-17").isEnabled(), "the repair's last day can be picked");
      assert(await day("2027-03-18").isDisabled(), "the day after the repair cannot");
      await day("2027-03-01").click();
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2027-03-01");
      assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "2", "the second half's repair zone");
      assert((await page.getAttribute("#or-1 .fp-floor", "role")) === "button", "OR 1 operates in the second half");
      assert((await page.getAttribute("#or-12 .fp-floor", "aria-label"))?.endsWith("ปิด"), "OR 12 is closed in the second half");
      await ownerShot(page, "board-picked-second-half.png");
      await page.goto(`${APP}/?date=2026-11-17`, { waitUntil: "networkidle" });

      // a past day (Pong, 18 Nov 2026: "allow view calendar backward"): the calendar goes back to January 2569 and no
      // further; a day there has the first half's rooms (no weekly schedule) and says it is a past list
      await openPicker();
      for (let i = 0; i < 12 && (await page.locator('#board-date-calendar [data-nav="prev"]').isEnabled()); i += 1) {
        await page.click('#board-date-calendar [data-nav="prev"]');
      }
      assert((await textOf(page, "#board-date-calendar-title")) === "มกราคม 2569", `the first month: ${await textOf(page, "#board-date-calendar-title")}`);
      assert(await page.locator('#board-date-calendar [data-nav="prev"]').isDisabled(), "no month before January 2569");
      await day("2026-01-05").click();
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2026-01-05");
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดย้อนหลัง", "a past day's eyebrow");
      assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "1", "the first half's rooms in January 2569");
      assert((await page.getAttribute("#or-12 .fp-floor", "role")) === "button", "OR 12 operates");
      assert((await page.getAttribute("#or-2 .fp-floor", "aria-label"))?.endsWith("ปิด"), "OR 2 is closed, not the weekly schedule's");
      await ownerShot(page, "board-picked-past-day.png");
      await page.goto(`${APP}/?date=2026-11-17`, { waitUntil: "networkidle" });

      // a day further ahead: no list yet; the way back to the current board
      await openPicker();
      assert((await page.locator('[data-testid="board-date-current"]').count()) === 1, "a way back to the current board");
      await day("2026-11-20").click();
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2026-11-20");
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดถัดไป", "a day ahead's eyebrow");
      assert((await textOf(page, '[data-testid="no-upload-alert"]')) === "ยังไม่มีตาราง HOSxP ของ 20 พ.ย. 2569", "a day ahead has no list yet");
      await openPicker();
      await page.click('[data-testid="board-date-current"]');
      await page.waitForURL((url) => !url.searchParams.has("date"));
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2026-11-18");
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดถัดไป", "back on the current board");

      // the keyboard: Enter on the date puts the focus on the shown day, the arrows move it, Enter picks
      await page.focus('[data-testid="board-date-button"]');
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "visible" });
      await page.waitForFunction(() => document.activeElement?.dataset.date === "2026-11-18");
      await page.keyboard.press("ArrowRight");
      assert(await page.evaluate(() => document.activeElement?.dataset.date === "2026-11-19"), "the right arrow moves a day");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2026-11-19");
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดถัดไป", "Thursday by the keyboard");

      // an address with a day the calendar never offers, or the board's own day, shows the board's own day and loses its
      // date, so the board turns over at the next 16:00 again
      for (const bad of ["2025-12-31", "2026-11-22", "2027-03-18", "2026-11-31", "tomorrow", "2026-11-18"]) {
        await page.goto(`${APP}/?date=${bad}&room=or-13`, { waitUntil: "networkidle" });
        assert((await shownDay()) === "2026-11-18", `?date=${bad} -> ${await shownDay()}`);
        await page.waitForURL((url) => !url.searchParams.has("date") && url.searchParams.get("room") === "or-13");
      }
      // the date keeps its year beside the chevron on a narrow phone, for a nurse and for an admin with two more buttons
      for (const person of [RP.nurse, RP.admin]) {
        const c = await contextAs(person);
        const p = await c.newPage();
        for (const width of [360, 390, 450, 768, 1280]) {
          await p.setViewportSize({ width, height: 800 });
          // a Thursday, the longest day name
          await p.goto(`${APP}/?date=2026-11-19`, { waitUntil: "networkidle" });
          const cut = await p.evaluate(() => {
            const span = document.querySelector('[data-testid="board-date-button"] > span');
            return span.scrollWidth > span.clientWidth + 0.5;
          });
          assert(!cut, `the date is cut short at ${width}px for ${person.name}`);
          await noSideScroll(p, `the date picker's button at ${width}px`);
        }
        await c.close();
      }
      // a year the BOT gives no holidays for (the stub lists none for 2028, as for a year not announced yet) says so
      // under its months: once the repair is over the calendar runs 60 days ahead, into January 2571
      setNow("2027-12-01T10:00:00+07:00");
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      await openPicker();
      assert((await textOf(page, "#board-date-calendar-title")) === "ธันวาคม 2570", "December 2570");
      assert((await page.locator('[data-testid="board-date-calendar-unlisted"]').count()) === 0, "the BOT listed 2570");
      await page.click('#board-date-calendar [data-nav="next"]');
      assert((await textOf(page, "#board-date-calendar-title")) === "มกราคม 2571", "January 2571");
      assert(
        (await textOf(page, '[data-testid="board-date-calendar-unlisted"]')) === "ปฏิทินยังไม่มีวันหยุดปี 2571",
        `the note: ${await textOf(page, "#board-date-calendar ul")}`,
      );
      await ownerShot(page, "board-date-unlisted-year.png");
      await page.keyboard.press("Escape");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
      rmSync(NOW_FILE, { force: true });
    });

    await t("a room's list in a full screen card; a sideways swipe on the plan moves the board a workday", async () => {
      // Tuesday after 16:00: the board's own day is Wednesday 18 Nov; Tuesday has its HOSxP list (OR 12: three cases)
      setNow("2026-11-17T17:00:00+07:00");
      const ctx = await contextAs(RP.nurse);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const shownDay = () => page.getAttribute("header time", "datetime");
      const waitDay = (iso) => page.waitForFunction((day) => document.querySelector("header time")?.getAttribute("datetime") === day, iso);
      await page.goto(`${APP}/?date=2026-11-17&room=or-12`, { waitUntil: "networkidle" });
      await page.waitForSelector(".room-sheet .case-row");

      // Pong, 19 Nov 2026: "add full screen btn on room dialog, click to display Y-scrollable floating card center - center"
      const card = page.locator('[data-testid="room-full"]');
      await page.click('[data-testid="room-expand"]');
      await card.waitFor();
      // the card's short entrance (a slight rise and scale) ends before it is measured
      await page.waitForTimeout(300);
      assert((await card.locator(".case-row").count()) === 3, "the card lists the room's three cases");
      assert((await textOf(page, "#room-full-title")) === "OR 12", "the room's name");
      assert((await textOf(page, '[data-testid="room-full-day"]')) === "วันอังคารที่ 17 พ.ย. 2569", "the card names the day, as it covers the top bar");
      assert(await page.evaluate(() => document.activeElement?.id === "room-full-title"), "the focus on the card's heading");
      const view = page.viewportSize();
      const box = await card.boundingBox();
      assert(Math.abs(box.x + box.width / 2 - view.width / 2) < 1.5 && Math.abs(box.y + box.height / 2 - view.height / 2) < 1.5, `centred: ${JSON.stringify(box)}`);
      assert(box.x >= 7 && box.x <= 9, `8px from a phone's sides: ${box.x}`);
      assert(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="room-full"] ol')).overflowY === "auto"), "the list scrolls up and down");
      await ownerShot(page, "room-full-card.png");
      // Escape closes the card only: the sheet is still open behind it, the focus back on the button
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      assert(await page.evaluate(() => document.activeElement?.dataset.testid === "room-expand"), "the focus goes back to the button");
      assert((await page.locator(".room-sheet .case-row").count()) === 3 && new URL(page.url()).searchParams.get("room") === "or-12", "the room stays open");
      // the shrink button and a tap outside the card close it too
      await page.click('[data-testid="room-expand"]');
      await card.waitFor();
      await page.click('[data-testid="room-full-close"]');
      await card.waitFor({ state: "detached" });
      await page.click('[data-testid="room-expand"]');
      await card.waitFor();
      await page.mouse.click(view.width / 2, 3);
      await card.waitFor({ state: "detached" });
      assert(new URL(page.url()).searchParams.get("room") === "or-12", "still the room");
      // on a computer the list takes two columns
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.click('[data-testid="room-expand"]');
      await card.waitFor();
      await page.waitForTimeout(300);
      const columns = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="room-full"] ol')).gridTemplateColumns.split(" ").length);
      assert(columns === 2, `two columns on a computer: ${columns}`);
      assert((await card.boundingBox()).width === 1024, "64rem wide");
      await page.keyboard.press("Escape");
      await card.waitFor({ state: "detached" });
      await page.setViewportSize(view);
      await page.click('[data-testid="room-close"]');
      await page.waitForURL((url) => !url.searchParams.has("room"));

      // Pong, 19 Nov 2026: "allow swipe on layout to select date". To the left: the next workday, here the board's own
      // day, so the address drops its date
      const plan = '[data-testid="day-swipe"]';
      assert((await textOf(page, '[data-testid="swipe-hint-next"]')) === "พ. 18 พ.ย.", "the next day's hint");
      assert((await textOf(page, '[data-testid="swipe-hint-prev"]')) === "จ. 16 พ.ย.", "the day before's hint");
      await swipe(page, plan, -140);
      await waitDay("2026-11-18");
      assert(!new URL(page.url()).searchParams.has("date"), "the board's own day has no date in the address");
      // to the right: the day before, twice
      await swipe(page, plan, 140);
      await waitDay("2026-11-17");
      assert(new URL(page.url()).searchParams.get("date") === "2026-11-17", "Tuesday in the address");
      await swipe(page, plan, 140);
      await waitDay("2026-11-16");
      // a short drag springs back, and a move up or down is not a swipe
      await swipe(page, plan, -30);
      await swipe(page, plan, -60, 160);
      await page.waitForTimeout(800);
      assert((await shownDay()) === "2026-11-16", "still Monday");
      // over the weekend: Friday to Monday and back
      await page.goto(`${APP}/?date=2026-11-20`, { waitUntil: "networkidle" });
      await swipe(page, plan, -140);
      await waitDay("2026-11-23");
      await swipe(page, plan, 140);
      await waitDay("2026-11-20");
      // a swipe that starts on a room moves the day and opens no room; a tap still opens it
      await page.goto(`${APP}/?date=2026-11-17`, { waitUntil: "networkidle" });
      await swipe(page, "#or-12 .fp-floor", -140);
      await waitDay("2026-11-18");
      await page.waitForTimeout(400);
      assert(!new URL(page.url()).searchParams.has("room") && (await page.locator(".room-sheet.is-open").count()) === 0, "no room opened");
      await page.locator("#or-12 .fp-floor").click();
      await page.waitForURL((url) => url.searchParams.get("room") === "or-12");
      // the repair's last day has no day after it: the plan only gives a little
      await page.goto(`${APP}/?date=2027-03-17`, { waitUntil: "networkidle" });
      assert((await page.locator('[data-testid="swipe-hint-next"]').count()) === 0, "no next day's hint");
      await swipe(page, plan, -140);
      await page.waitForTimeout(800);
      assert((await shownDay()) === "2027-03-17", "still the repair's last day");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();
      rmSync(NOW_FILE, { force: true });
    });

    await t("doctors' tutorial: a doctor's first visit opens it once; a practice booking on a made-up day, before and after the 16:00 upload, every symbol explained; nothing saved", async () => {
      // Thursday 10:00: the first day a doctor could book is Friday 20 Nov, the made-up day (the repair's first half:
      // OR 10 the dressing room, OR 12 general surgery, OR 13 orthopaedics)
      setNow("2026-11-19T10:00:00+07:00");
      await db.query("DELETE FROM tutorial_seen WHERE user_id = $1", [RP.drY.userId]);
      const casesBefore = (await db.query("SELECT count(*)::int AS n FROM cases")).rows[0].n;
      const ctx = await contextAs(RP.drY);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      // Pong, 19 Nov 2026: "create user-friendly step-by-step interactive tutorial guide with dummy example (just like
      // start of mobile game app), also explain details of symbols. Note that this tutorial is for DR role only"
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert(page.url() === `${APP}/tutorial?first=1`, `a doctor's first visit opens the tutorial: ${page.url()}`);
      await page.waitForSelector('[data-testid="coach-welcome"]');
      assert((await page.getAttribute("header time", "datetime")) === "2026-11-20", "the made-up day is the first day the doctor could book");
      assert((await page.locator('[data-testid="tutorial-notice"]').count()) === 1, "a badge says the cases are made up");
      assert((await textOf(page, '[data-testid="coach-skip"]')) === "ข้ามไปก่อน", "a first visit may skip it");
      await ownerShot(page, "tutorial-welcome.png");
      await page.click('[data-testid="coach-start"]');
      await waitUntil(async () => (await db.query("SELECT 1 FROM tutorial_seen WHERE user_id = $1", [RP.drY.userId])).rowCount === 1, "starting notes it seen");

      // The steps, as a doctor goes through them: ถัดไป on a bubble or a card, the example answer and ถัดไป where
      // something is typed, and the real button, room or icon where the coach asks for a tap.
      const taps = {
        book: '[data-testid="add-case-button"]',
        "form-submit": '[data-testid="case-submit"]',
        "form-close": '[data-testid="add-case-close"]',
        room: "#or-12 .fp-floor",
        "room-again": "#or-12 .fp-floor",
        "my-icon": '.room-sheet .case-row:has([data-testid="row-hn"]) [data-testid="row-icon"]',
        unfold: '.room-sheet .case-row:has([data-testid="row-note"]) button.case-op',
        note: '.room-sheet .case-row [data-testid="row-note"]',
        "note-close": 'dialog[open] [data-testid="case-note-close"]',
        expand: '[data-testid="room-expand"]',
        "full-close": '[data-testid="room-full-close"]',
        dressing: "#or-10 .fp-floor",
      };
      const pictures = {
        plan: "tutorial-plan.png",
        "plan-symbols": "tutorial-plan-symbols.png",
        book: "tutorial-book.png",
        "form-hn": "tutorial-hn.png",
        "my-row": "tutorial-my-row.png",
        upload: "tutorial-upload.png",
        mismatch: "tutorial-mismatch.png",
        matched: "tutorial-matched.png",
        unfold: "tutorial-unfold.png",
        doers: "tutorial-dressing.png",
        "row-symbols": "tutorial-row-symbols.png",
      };
      /** Goes through the steps from the welcome card to the end, with `pictures` (step id: file) and `checks` (step id: fn). */
      const walk = async (page, pictures, checks = {}) => {
        const walked = [];
        let previous = "welcome";
        for (;;) {
          await page.waitForFunction((prev) => {
            const coach = document.querySelector('[data-testid="coach"]');
            return coach !== null && coach.dataset.step !== prev;
          }, previous);
          const id = await page.getAttribute('[data-testid="coach"]', "data-step");
          const mode = await page.getAttribute('[data-testid="coach"]', "data-mode");
          walked.push(id);
          previous = id;
          assert(walked.length < 60, `too many steps: ${walked.join(", ")}`);
          if (id === "finish") return walked;
          if (pictures[id]) await ownerShot(page, pictures[id]);
          if (checks[id]) await checks[id]();
          if (taps[id]) {
            assert(mode === "tap", `${id}: a tap step`);
            await page.click(taps[id]);
          } else if (mode === "do") {
            const example = page.locator('[data-testid="coach-example"]');
            if (await example.count()) await example.click();
            await page.click('[data-testid="coach-next"]:not([disabled])');
          } else {
            assert(mode === "info", `${id}: ${mode} step without a tap`);
            await page.click('[data-testid="coach-next"]');
          }
        }
      };
      const walked = await walk(page, pictures, {
        "my-row": async () => {
          const rows = await sheetRows(page);
          assert(JSON.stringify(rows) === JSON.stringify([["booking", null, null], ["booking", null, "HN 1234567"]]), `before the upload: the colleague's booking, then the doctor's with its HN only: ${JSON.stringify(rows)}`);
        },
        booked: async () => {
          // the confetti, mid-fall
          await page.waitForTimeout(700);
          await page.screenshot({ path: join(SCREENS, "tutorial-booked.png") });
          shots.push("tutorial-booked.png");
          assert((await textOf(page, '[data-testid="my-case-hn"]')) === "HN 1234567", "the practice booking in the form's own list");
        },
        mismatch: async () => {
          assert((await page.locator("#or-12 .fp-mismatch").count()) === 1, "the room's ! mark after the upload");
          assert((await page.locator('[data-testid="no-upload-alert"]').count()) === 0, "no more no-HOSxP badge");
        },
        gone: async () => assert((await page.getAttribute("#or-13 .fp-floor", "aria-label"))?.includes("ไม่มีเคส"), "the booking HOSxP lacks is gone from OR 13"),
        matched: async () => {
          const rows = await sheetRows(page);
          assert(JSON.stringify(rows) === JSON.stringify([["matched", null, null], ["matched", null, "HN 1234567"], ["hosxp", "unbooked", null]]), `after the upload: ${JSON.stringify(rows)}`);
          assert((await textOf(page, '.room-sheet [data-testid="row-patient"]')) === "ตัวอย่าง ผู้ป่วย", "the made-up patient's name, for the doctor alone");
          assert((await textOf(page, '.room-sheet .case-row[data-flag="unbooked"] .badge-warning')) === "นอกเวลา", "HOSxP's unbooked case is out of hours");
        },
        doers: async () => assert(JSON.stringify(await rowIcons(page)) === '["scrub","surgeon"]', `the dressing room's portraits: ${JSON.stringify(await rowIcons(page))}`),
      });
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(SCREENS, "tutorial-finish.png") });
      shots.push("tutorial-finish.png");
      assert((await db.query("SELECT count(*)::int AS n FROM cases")).rows[0].n === casesBefore, "the practice booking saved nothing");

      // the end goes to the real board, which no longer sends the doctor to the tutorial
      await page.click('[data-testid="coach-finish-board"]');
      await page.waitForURL(`${APP}/`);
      await page.waitForSelector('[data-testid="add-case-button"]');
      await page.goto(`${APP}/`, { waitUntil: "networkidle" });
      assert(page.url() === `${APP}/`, `seen once, the board stays: ${page.url()}`);
      // วิธีใช้งาน in the account menu opens it again, without the first visit's skip
      await page.click('[data-testid="user-menu"]');
      await page.click('[data-testid="account-help-link"]');
      await page.waitForURL(`${APP}/tutorial`);
      await page.waitForSelector('[data-testid="coach-welcome"]');
      assert((await textOf(page, '[data-testid="coach-skip"]')) === "กลับตาราง", "a replay goes back to the board");
      await page.click('[data-testid="coach-skip"]');
      await page.waitForURL(`${APP}/`);

      // on a computer: the same steps beside the room column, the full screen card in two columns
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${APP}/tutorial`, { waitUntil: "networkidle" });
      await page.click('[data-testid="coach-start"]');
      const onComputer = await walk(page, {
        "plan-symbols": "tutorial-plan-symbols-computer.png",
        "form-hn": "tutorial-hn-computer.png",
        matched: "tutorial-matched-computer.png",
      });
      assert(JSON.stringify(onComputer) === JSON.stringify(walked), `the same steps on a computer: ${onComputer.join(", ")}`);
      assert((await db.query("SELECT count(*)::int AS n FROM cases")).rows[0].n === casesBefore, "nothing saved on the computer either");
      assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
      await ctx.close();

      // for doctors only: a nurse is sent back to the board, and has no วิธีใช้งาน
      const nurse = await contextAs(RP.nurse);
      const nursePage = await nurse.newPage();
      await nursePage.goto(`${APP}/tutorial`, { waitUntil: "networkidle" });
      assert(nursePage.url() === `${APP}/`, `a nurse goes back to the board: ${nursePage.url()}`);
      assert((await nursePage.locator('[data-testid="account-help-link"]').count()) === 0, "no tutorial link for a nurse");
      await nurse.close();
      rmSync(NOW_FILE, { force: true });
    });

    await t("admin: the demo schedule on /admin: at least 10 made-up cases in every room of a day in either half, nothing saved; admins only", async () => {
      // Monday 10:00: the board shows Monday, in the repair's first half (14 Nov 2026 – 26 Jan 2027)
      setNow("2026-11-16T10:00:00+07:00");
      const counts = async () => (await db.query("SELECT (SELECT count(*) FROM cases)::int AS c, (SELECT count(*) FROM workbook_cases)::int AS w, (SELECT count(*) FROM workbook_uploads)::int AS u")).rows[0];
      const before = await counts();
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      const section = page.locator('[data-testid="demo-section"]');
      // closed to start with, like every section: the half buttons show once it is opened
      assert(!(await page.isVisible('[data-testid="demo-half-1"]')), "the demo section starts closed");
      await openSection(page, "demo");
      assert((await textOf(page, "#demo-title")) === "ตารางตัวอย่าง", "the section's title");
      const half = (n) => page.locator(`[data-testid="demo-half-${n}"]`);
      assert((await half(1).getAttribute("href")) === "/?demo=1&half=1" && (await half(2).getAttribute("href")) === "/?demo=1&half=2", "a link for each half");
      assert((await half(1).innerText()).replace(/\s+/g, " ") === "ครึ่งแรก 1 ม.ค. 2569 – 26 ม.ค. 2570", `the first half: ${await half(1).innerText()}`);
      assert((await half(2).innerText()).replace(/\s+/g, " ") === "ครึ่งหลัง 27 ม.ค. 2570 – 17 มี.ค. 2570", `the second half: ${await half(2).innerText()}`);
      for (const n of [1, 2]) assert(((await half(n).boundingBox())?.height ?? 0) >= 44, "44px targets");
      await noSideScroll(page, "the admin page with the demo section at 390px");
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: join(SCREENS, "admin-demo.png") });
      shots.push("admin-demo.png");

      // the rooms of the day shown, each opened by its address: at least 10 cases, all made up
      const roomRows = async (room, date) => {
        await page.goto(`${APP}/?demo=1${date ? `&date=${date}` : ""}&room=${room}`, { waitUntil: "networkidle" });
        await page.waitForSelector(".case-row");
        return page.$$eval(".case-row", (rows) => rows.map((row) => row.innerText));
      };
      const checkDay = async (date, rooms) => {
        for (const room of rooms) {
          const rows = await roomRows(room, date);
          assert(rows.length >= 10 && rows.length <= 12, `${room}: ${rows.length} cases`);
          assert(rows.every((text) => text.includes("ตัวอย่าง")), `${room}: made-up surgeons`);
        }
      };

      // ครึ่งแรก: the board's own day, Monday, so the address keeps no date
      await half(1).click();
      await page.waitForURL((url) => url.pathname === "/" && url.search === "?demo=1");
      assert((await page.getAttribute("header time", "datetime")) === "2026-11-16", "the first half's demo is the board's own day");
      assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "1", "the first half's plan");
      const kinds = await page.$$eval('[data-testid="notice-strip"] .notice-badge', (els) => els.map((el) => el.dataset.noticeId));
      assert(JSON.stringify(kinds) === JSON.stringify(["demo"]), `the demo's badge alone: ${JSON.stringify(kinds)}`);
      await ownerShot(page, "board-demo-first-half.png");
      await page.click('[data-notice-id="demo"]');
      await page.waitForSelector('[data-testid="notice-bubble"]');
      assert((await textOf(page, "#board-notice-bubble-title")) === "ตารางตัวอย่าง · เคสสมมติ ไม่ใช่ข้อมูลจริง", "the badge says it is made up");
      await page.waitForTimeout(400);
      await ownerShot(page, "board-demo-notice.png");
      await checkDay(null, ["or-9", "or-10", "or-11", "or-12", "or-13"]);
      await ownerShot(page, "board-demo-room.png");
      // the demo's dressing room, OR 10: who does each dressing, the doctor and the scrub both
      await roomRows("or-10", null);
      const doers = await rowIcons(page);
      assert(doers.includes("scrub") && doers.includes("surgeon") && doers.every((who) => who === "scrub" || who === "surgeon"), `OR 10: ${JSON.stringify(doers)}`);
      await ownerShot(page, "board-demo-dressing.png");
      // with the test notices too, the demo's badge stays first
      await page.goto(`${APP}/?demo=1&notices=all`, { waitUntil: "networkidle" });
      const both = await page.$$eval('[data-testid="notice-strip"] .notice-badge', (els) => els.map((el) => el.dataset.noticeId));
      assert(JSON.stringify(both) === JSON.stringify(["demo", "no-upload"]), `the demo with every notice: ${JSON.stringify(both)}`);

      // ครึ่งหลัง: its first workday, Wednesday 27 Jan 2027, by its address
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      await openSection(page, "demo");
      await half(2).click();
      await page.waitForURL((url) => url.searchParams.get("demo") === "1" && url.searchParams.get("date") === "2027-01-27" && !url.searchParams.has("half"));
      assert((await page.getAttribute("header time", "datetime")) === "2027-01-27", "the second half's first day");
      assert((await page.getAttribute('[data-testid="repair-zone"]', "data-half")) === "2", "the second half's plan");
      assert((await page.locator('[data-notice-id="demo"]').count()) === 1, "the demo's badge");
      await ownerShot(page, "board-demo-second-half.png");
      await checkDay("2027-01-27", ["or-1", "or-2", "or-3", "or-4", "or-5"]);
      // the date picker stays in the demo
      await page.goto(`${APP}/?demo=1&date=2027-01-27`, { waitUntil: "networkidle" });
      await page.click('[data-testid="board-date-button"]');
      await page.locator('[data-testid="board-date-dialog"]').waitFor({ state: "visible" });
      await page.click('#board-date-calendar [data-date="2027-01-28"]');
      await page.waitForURL((url) => url.searchParams.get("date") === "2027-01-28" && url.searchParams.get("demo") === "1");
      await page.waitForFunction(() => document.querySelector("header time")?.getAttribute("datetime") === "2027-01-28");
      assert((await page.locator('[data-notice-id="demo"]').count()) === 1, "another day of the demo");
      // the logo goes back to the real board
      await page.click('header a[aria-label="ORSKH.APP หน้าแรก"]');
      await page.waitForURL((url) => url.pathname === "/" && url.search === "");
      await page.waitForFunction(() => !document.querySelector('[data-notice-id="demo"]'));
      // in the second half, the first half's button says it is over, and its address goes back to /admin rather than
      // to a day of the second half
      setNow("2027-02-01T10:00:00+07:00");
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      await openSection(page, "demo");
      assert((await half(1).getAttribute("aria-disabled")) === "true" && (await half(1).getAttribute("href")) === null, "the first half is over");
      assert((await half(1).innerText()).replace(/\s+/g, " ") === "ครึ่งแรก จบแล้ว", `the first half: ${await half(1).innerText()}`);
      assert((await half(2).getAttribute("href")) === "/?demo=1&half=2", "the second half still opens");
      await page.goto(`${APP}/?demo=1&half=1`, { waitUntil: "networkidle" });
      assert(new URL(page.url()).pathname === "/admin", `a half that is over goes back to /admin: ${page.url()}`);
      setNow("2026-11-16T10:00:00+07:00");
      assert(errors.length === 0, `no page errors: ${errors.join(" | ")}`);
      await ctx.close();

      // nothing was saved, and anyone but an admin gets the real board, with no redirect
      assert(JSON.stringify(await counts()) === JSON.stringify(before), `no booking or upload saved: ${JSON.stringify(await counts())}`);
      for (const path of ["/?demo=1", "/?demo=1&half=2"]) {
        const r = await fetch(`${APP}${path}`, { headers: { cookie: `session=${await sessionOf(RP.nurse)}` }, redirect: "manual" });
        const html = await r.text();
        assert(r.status === 200 && !html.includes("ตารางตัวอย่าง") && !html.includes("ตัวอย่าง หนึ่ง"), `${path} for a nurse: ${r.status}`);
      }
    });

    await t("admin: past days' HOSxP lists imported on /admin show on the board's calendar; importing again replaces them", async () => {
      // Thu 19 Nov: the made-up sample's days (Mon 2 to Sat 7 Nov) are all past
      setNow("2026-11-19T10:00:00+07:00");
      const imported = async () =>
        (await db.query("SELECT to_char(target_date, 'YYYY-MM-DD') AS day, placed FROM workbook_uploads WHERE past_import ORDER BY target_date")).rows;
      assert((await imported()).length === 0, "no imported list to start with");
      const ctx = await contextAs(RP.admin);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${APP}/admin`, { waitUntil: "networkidle" });
      assert((await textOf(page, '[data-testid="past-span"]')) === "ยังไม่มีตารางย้อนหลัง", `nothing yet: ${await textOf(page, '[data-testid="past-span"]')}`);
      await openSection(page, "past");
      assert((await textOf(page, "#past-title")) === "ตารางย้อนหลังจาก HOSxP", "the section's title");

      const importFile = async () => {
        await page.setInputFiles('[data-testid="past-file"]', SAMPLE_WORKBOOK);
        await page.click('[data-testid="past-submit"]');
        await page.waitForSelector('[data-testid="past-result"]', { timeout: 30_000 });
        return textOf(page, '[data-testid="past-result"]');
      };
      // Mon 2 to Fri 6 Nov are workdays; Saturday's rows are left out
      const message = await importFile();
      const days = await imported();
      assert(JSON.stringify(days.map((row) => row.day)) === JSON.stringify(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]), `the days: ${JSON.stringify(days)}`);
      const placed = days.reduce((sum, row) => sum + row.placed, 0);
      assert(message === `บันทึก 5 วัน 2–6 พ.ย. 2569 ลงห้อง ${placed} เคส`, `the answer: ${message}`);
      assert((await textOf(page, '[data-testid="past-span"]')) === "มีแล้ว 5 วัน · 2–6 พ.ย. 2569", `the line: ${await textOf(page, '[data-testid="past-span"]')}`);
      await noSideScroll(page, "the admin page with the past lists section at 390px");
      await page.locator('[data-testid="past-section"]').screenshot({ path: join(SCREENS, "admin-past-lists.png") });
      shots.push("admin-past-lists.png");

      // importing the same file again replaces the lists: still one per day
      assert((await importFile()) === message, "the same answer again");
      const again = (await db.query("SELECT count(*)::int AS n FROM workbook_uploads WHERE past_import")).rows[0].n;
      assert(again === 5, `one list per day: ${again}`);

      // the board's calendar: Thu 5 Nov now has its list, its cases in their rooms
      await page.goto(`${APP}/?date=2026-11-05`, { waitUntil: "networkidle" });
      assert((await textOf(page, '[data-testid="board-eyebrow"]')) === "ตารางผ่าตัดย้อนหลัง", "a past day");
      assert((await page.locator('[data-testid="no-upload-alert"]').count()) === 0, "a past day with a list has no no-list notice");
      await page.goto(`${APP}/?date=2026-11-05&room=or-12`, { waitUntil: "networkidle" });
      await page.waitForSelector(".case-row");
      const rows = await page.$$eval(".case-row", (items) => items.length);
      assert(rows >= 1, `OR 12 on 5 Nov: ${rows} cases`);
      assert(errors.length === 0, `no page errors: ${errors.join(" | ")}`);
      await ctx.close();

      // a nurse cannot import (the action checks the admin again) and has no such section
      const r = await fetch(`${APP}/admin`, { headers: { cookie: `session=${await sessionOf(RP.nurse)}` }, redirect: "manual" });
      assert(r.status === 404, `/admin for a nurse: ${r.status}`);

      await db.query("DELETE FROM workbook_uploads WHERE past_import");
      setNow("2026-11-16T10:00:00+07:00");
    });

    await t("outages (Pong, 17 Nov 2026): a database or server error goes to /unavailable, a lost connection covers the page; the session is kept", async () => {
      // 1: the landing opens without signing in; "ลองอีกครั้ง" goes back only to a path on this site
      for (const [from, back] of [["/?room=or-3", "/?room=or-3"], ["//evil.example/x", "/"], ["https://evil.example/", "/"], ["/unavailable?reason=server", "/"]]) {
        const r = await fetch(`${APP}/unavailable?reason=server&from=${encodeURIComponent(from)}`, { redirect: "manual" });
        const html = await r.text();
        assert(r.status === 200 && html.includes("ระบบขัดข้องชั่วคราว"), `/unavailable without a session: ${r.status}`);
        assert(html.includes(`href="${back.replace(/&/g, "&amp;")}"`) && !html.includes("evil.example\""), `retry for ${from} goes to ${back}`);
      }

      // 2: the app with its database down: a signed-in nurse goes to the outage page, not to sign in, and keeps the cookie
      const downEnv = { ...appEnv, APP_URL: DOWN_APP, DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:9/nothing_listens_here" };
      downApp = startProcess("app-down", ["node_modules/next/dist/bin/next", "start", "-p", String(DOWN_APP_PORT)], downEnv);
      await waitFor(`${DOWN_APP}/unavailable`, downApp);
      let ctx = await newContext(browser);
      await ctx.addCookies([{ name: "session", value: await sessionToken(NURSE), url: DOWN_APP, httpOnly: true, sameSite: "Lax" }]);
      let page = await ctx.newPage();
      await page.goto(`${DOWN_APP}/?room=or-3`);
      await page.waitForSelector('[data-testid="outage"][data-reason="server"]');
      let at = new URL(page.url());
      assert(at.pathname === "/unavailable" && at.searchParams.get("reason") === "server" && at.searchParams.get("from") === "/?room=or-3", `nurse at ${page.url()}`);
      assert((await page.getAttribute('[data-testid="outage-retry"]', "href")) === "/?room=or-3", "retry goes back to the board");
      assert(await cookie(ctx, "session"), "the session cookie is kept through the outage");
      await shoot(page, "outage-server");
      await ctx.close();

      // 3: break-glass needs no database to sign in, so the page itself fails: the board's error also lands there
      ctx = await newContext(browser);
      await ctx.addCookies([{ name: "session", value: await sessionToken(BREAK_GLASS), url: DOWN_APP, httpOnly: true, sameSite: "Lax" }]);
      page = await ctx.newPage();
      await page.goto(`${DOWN_APP}/`);
      await page.waitForURL(/\/unavailable\?reason=server/);
      await page.waitForSelector('[data-testid="outage"][data-reason="server"]');
      await ctx.close();

      // 4: offline on the real app: the network landing covers the board, and the board is back once online
      ctx = await newContext(browser);
      await ctx.addCookies([{ name: "session", value: await sessionToken(BREAK_GLASS), url: APP, httpOnly: true, sameSite: "Lax" }]);
      page = await ctx.newPage();
      await page.goto(`${APP}/`);
      await page.waitForSelector('[data-testid="board-eyebrow"]');
      assert((await page.locator('[data-testid="offline-cover"]').count()) === 0, "no cover while online");
      await ctx.setOffline(true);
      await page.waitForSelector('[data-testid="offline-cover"] [data-testid="outage"][data-reason="network"]');
      assert((await plainText(page, '[data-testid="offline-cover"] h1')) === "ไม่มีการเชื่อมต่ออินเทอร์เน็ต", "the network title");
      await shoot(page, "outage-network", { full: false });
      const reloaded = page.waitForEvent("load");
      await ctx.setOffline(false);
      await reloaded;
      await page.waitForSelector('[data-testid="offline-cover"]', { state: "detached" });
      assert(new URL(page.url()).pathname === "/", `back on the board: ${page.url()}`);
      await ctx.close();
    });

    await t("computers (Pong, 17 Nov 2026): with the device gate on, only MX and admins open the board on a computer, signed out otherwise; phones open it in LIFF", async () => {
      // the same build with the gate on, as on Vercel (CLIENT_GATE=liff; the mocks stay allowed since VERCEL is unset)
      const gateEnv = { ...appEnv, APP_URL: GATE_APP, CLIENT_GATE: "liff", LIFF_ID: "2001234567-AbCdEfGh" };
      gateApp = startProcess("app-gate", ["node_modules/next/dist/bin/next", "start", "-p", String(GATE_APP_PORT)], gateEnv);
      await waitFor(`${GATE_APP}/login`, gateApp);
      const get = async (path, ua, person) => {
        const r = await fetch(`${GATE_APP}${path}`, {
          headers: { "user-agent": ua, ...(person ? { cookie: `session=${await sessionOf(person)}` } : {}) },
          redirect: "manual",
        });
        return { status: r.status, location: r.headers.get("location"), cookie: r.headers.get("set-cookie") ?? "", body: await r.text() };
      };
      // the floor plan's own label (the site's description says แปลนห้องผ่าตัด on every page)
      const PLAN = 'aria-label="แปลนห้องผ่าตัด"';
      const isBoard = (r) => r.status === 200 && r.body.includes(PLAN) && !r.body.includes('data-testid="desktop-only"');
      assert(JSON.stringify((await db.query("SELECT u.first_name || ' ' || u.last_name AS name FROM mx_members m JOIN users u ON u.id = m.user_id")).rows.map((r) => r.name)) === JSON.stringify([RP.mx.name]), "MX is the one member left by the admin test");

      // a nurse (not MX) on a computer: the desktop-only page, signed out on this browser, 403 from the API
      const nurseDesk = await get("/?room=or-3", UA_DESKTOP, RP.nurse);
      assert(nurseDesk.status === 200 && nurseDesk.body.includes('data-testid="desktop-only"'), `nurse on a computer: ${nurseDesk.status}`);
      assert(nurseDesk.body.includes("เฉพาะผู้จัดการตาราง (MX) และผู้ดูแลระบบ") && !nurseDesk.body.includes(PLAN), "the page says who may, and no board");
      assert(/(^|,\s*)session=;/.test(nurseDesk.cookie) && /Max-Age=0/i.test(nurseDesk.cookie), `signed out: ${nurseDesk.cookie}`);
      const nurseApi = await get("/api/board", UA_DESKTOP, RP.nurse);
      assert(nurseApi.status === 403 && JSON.parse(nurseApi.body).error === "desktop-mx-only", `nurse's API call from a computer: ${nurseApi.status}`);
      // the same nurse in the LIFF app on a phone: the board, still signed in
      const nursePhone = await get("/", UA_IPHONE_LIFF, RP.nurse);
      assert(isBoard(nursePhone) && !/session=;/.test(nursePhone.cookie), `nurse in LIFF: ${nursePhone.status}`);
      // MX and the admin on a computer: the board (and the admin page for the admin)
      assert(isBoard(await get("/", UA_DESKTOP, RP.mx)), "MX on a computer");
      assert((await get("/api/board", UA_DESKTOP, RP.mx)).status !== 403, "MX's API calls from a computer");
      assert(isBoard(await get("/", UA_DESKTOP, RP.admin)), "the admin on a computer");
      assert((await get("/admin", UA_DESKTOP, RP.admin)).status === 200, "/admin on a computer");
      // a phone browser outside LINE: the open-in-LINE page, which says who a computer is for
      const safari = await get("/", UA_IPHONE_SAFARI, RP.mx);
      assert(safari.status === 200 && safari.body.includes('data-testid="open-in-line"') && safari.body.includes("เฉพาะผู้จัดการตาราง (MX) และผู้ดูแลระบบ"), `phone Safari: ${safari.status}`);
      // nobody signed in on a computer: LINE Login's QR code, as before
      const login = await get("/login", UA_DESKTOP);
      assert(login.status === 307 && login.location === "/api/auth/line/start", `computer /login: ${login.status} ${login.location}`);

      // the page as a computer shows it
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: "th-TH", userAgent: UA_DESKTOP });
      await ctx.addCookies([{ name: "session", value: await sessionOf(RP.nurse), url: GATE_APP, httpOnly: true, sameSite: "Lax" }]);
      const page = await ctx.newPage();
      await page.goto(`${GATE_APP}/`);
      await page.waitForSelector('[data-testid="desktop-only"]');
      await noLineLogin(page, "/desktop-only");
      assert(!(await ctx.cookies(GATE_APP)).some((c) => c.name === "session" && c.value), "no session left in the browser");
      await shoot(page, "desktop-only", { full: false });
      await ctx.close();
    });

    await t("no OTP code, deeSMSX token, key, HN or workbook row appears in server logs", async () => {
      assert(issuedCodes.length >= 20, `codes and tokens collected: ${issuedCodes.length}`);
      for (const proc of [app, fileApp, downApp, gateApp].filter(Boolean)) {
        const log = proc.log();
        for (const code of issuedCodes) assert(!log.includes(code), `code or token found in the ${proc.name} log`);
        assert(!log.includes(SESSION_SECRET) && !log.includes(OTP_PEPPER) && !log.includes(TG_TOKEN), `secret in the ${proc.name} log`);
        assert(!log.includes(SMS_API_KEY) && !log.includes(SMS_SECRET_KEY), `deeSMSX key in the ${proc.name} log`);
        assert(webhookSecret && !log.includes(webhookSecret), `webhook secret in the ${proc.name} log`);
        assert(!log.includes(BOT_TOKEN), `the holidays token in the ${proc.name} log`);
        // no HN and nothing of a workbook row (patients' made-up names, operations) is ever logged
        for (const hn of [...WORKBOOK_HNS, HN_TODAY, HN_X_MISSING]) assert(!log.includes(hn), `an HN in the ${proc.name} log`);
        assert(!/ตัวอย่าง|ผู้ป่วย|cholecystectomy|thyroidectomy/i.test(log), `a workbook row in the ${proc.name} log`);
      }
      assert(/\[sms\] deeSMSX OTP request failed: code 102/.test(app.log()), "provider failures are logged by reference code");
    });
  } finally {
    await browser.close();
    await db.end();
    stopAll();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`[e2e] screenshots: ${shots.length ? shots.join(", ") : "none"}`);
  console.log(`\n[e2e] ${results.length - failed} passed, ${failed} failed. Screenshots: ${SCREENS}  Logs: ${LOG_DIR}`);
  process.exitCode = failed ? 1 : 0;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopAll();
    process.exit(130);
  });
}
// the servers run detached: stop them however this process ends (also on a crash, such as EPIPE on stdout)
process.on("exit", stopAll);

main().catch((e) => {
  console.error(`[e2e] ${e.message}`);
  stopAll();
  process.exitCode = 1;
});
