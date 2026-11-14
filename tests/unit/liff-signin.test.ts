import { TEST_DB, TEST_SESSION_SECRET } from "./_setup";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { POST as liffRoute } from "@/app/api/auth/line/liff/route";
import { createPool, ensureSchema } from "@/lib/db";
import { upsertBinding } from "@/lib/otp";
import { verifyPending, verifySession } from "@/lib/tokens";

// Sign-in inside the LIFF app: the page posts liff.getIDToken(), LINE's verify endpoint (a stub here) checks it.
describe("LIFF sign-in (POST /api/auth/line/liff, database)", () => {
  const pool = createPool(TEST_DB);
  let server: Server;
  let claims: Record<string, unknown> = {};
  let status = 200;
  let lastForm: URLSearchParams | null = null;

  const good = (sub = "U-liff-new") => ({
    iss: "https://access.line.me",
    sub,
    aud: "1234567890",
    exp: Math.floor(Date.now() / 1000) + 600,
    iat: Math.floor(Date.now() / 1000),
    name: "ทดสอบ LIFF",
    picture: "https://profile.line-scdn.net/0habc",
  });

  before(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        lastForm = new URLSearchParams(body);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(status === 200 ? claims : { error: "invalid_request" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.LINE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await ensureSchema(pool);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE line_bindings, login_events RESTART IDENTITY");
    status = 200;
    claims = good();
  });
  after(async () => {
    server.close();
    delete process.env.LINE_API_URL;
    await pool.end();
  });

  const post = (body: unknown, headers: Record<string, string> = {}) =>
    liffRoute(
      new NextRequest("http://localhost:3999/api/auth/line/liff", {
        method: "POST",
        headers: { origin: "http://localhost:3999", "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  test("a LINE account with no verified number: pending cookie, on to /login/verify", async () => {
    const res = await post({ idToken: "liff.id.token", next: "/?room=or-2" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, redirect: "/login/verify" });
    assert.equal(lastForm?.get("id_token"), "liff.id.token");
    assert.equal(lastForm?.get("client_id"), "1234567890");
    assert.equal(lastForm?.has("nonce"), false);
    const pending = await verifyPending(res.cookies.get("pending")?.value, TEST_SESSION_SECRET);
    assert.equal(pending?.sub, "U-liff-new");
    assert.equal(pending?.next, "/?room=or-2");
    assert.equal(res.cookies.get("session"), undefined);
  });

  test("a LINE account verified for an authorized number: signed in, back to next", async () => {
    await upsertBinding(pool, "U-liff-known", "0812345678", "old name"); // 0812345678 is in ALLOWED_PHONES
    claims = good("U-liff-known");
    const res = await post({ idToken: "liff.id.token", next: "/?room=or-2" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, redirect: "/?room=or-2" });
    const session = await verifySession(res.cookies.get("session")?.value, TEST_SESSION_SECRET);
    assert.equal(session?.sub, "U-liff-known");
    assert.equal(session?.phone, "0812345678");
    const { rows } = await pool.query("SELECT event FROM login_events WHERE line_sub = $1", ["U-liff-known"]);
    assert.deepEqual(rows.map((r) => r.event), ["login_binding"]);
  });

  test("an unsafe next is reduced to /", async () => {
    await upsertBinding(pool, "U-liff-known", "0812345678", "x");
    claims = good("U-liff-known");
    const res = await post({ idToken: "liff.id.token", next: "//evil.example/" });
    assert.deepEqual(await res.json(), { ok: true, redirect: "/" });
  });

  test("a token LINE rejects, or one for another channel, answers fallback and sets no cookie", async () => {
    status = 400;
    let res = await post({ idToken: "liff.id.token" });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).fallback, true);
    assert.equal(res.cookies.get("session"), undefined);
    assert.equal(res.cookies.get("pending"), undefined);

    status = 200;
    claims = { ...good(), aud: "999" };
    res = await post({ idToken: "liff.id.token" });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).fallback, true);
  });

  test("bad requests: no token, not JSON, another origin", async () => {
    for (const body of [{}, { idToken: 5 }, { idToken: "short" }, "not json"]) {
      const res = await post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal((await res.json()).fallback, true);
    }
    assert.equal((await post({ idToken: "liff.id.token" }, { origin: "https://evil.example" })).status, 403);
  });
});
