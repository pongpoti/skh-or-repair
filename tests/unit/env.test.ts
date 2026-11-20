import "./_setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { NextResponse } from "next/server";
import { cookieName, cookieOptions, sessionTtlFor, setSessionCookie } from "@/lib/cookies";
import { allowedPhonesRaw, appUrl, assertOtpReady, ConfigError, lineConfig, phoneSignInOpen, smsConfig } from "@/lib/env";
import { phoneSignInClosed } from "@/lib/http";
import { setTestEnv } from "./_setup";

afterEach(() => setTestEnv());

describe("env validation", () => {
  test("reports missing variable NAMES only, never values", () => {
    delete process.env.OTP_PEPPER;
    delete process.env.DATABASE_URL;
    process.env.SESSION_SECRET = "short-secret-value";
    process.env.SMS_PROVIDER = "deesmsx";
    delete process.env.DEESMSX_API_KEY;
    delete process.env.DEESMSX_SECRET_KEY;
    try {
      assertOtpReady();
      assert.fail("expected ConfigError");
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      assert.deepEqual(e.names.sort(), ["DATABASE_URL", "DEESMSX_API_KEY", "DEESMSX_SECRET_KEY", "OTP_PEPPER", "SESSION_SECRET"]);
      assert.ok(!e.message.includes("short-secret-value"));
    }
  });

  test("sign-in by number is closed unless PHONE_SIGNIN=open (doctors-only pre-release, Pong 20 Nov 2026)", async () => {
    delete process.env.PHONE_SIGNIN;
    assert.equal(phoneSignInOpen(), false);
    const closed = phoneSignInClosed();
    assert.ok(closed);
    assert.equal(closed.status, 403);
    assert.deepEqual(await closed.json(), { error: "ช่วงทดลองใช้ เปิดให้แพทย์ก่อน", reason: "doctors_only" });
    for (const v of ["", " ", "yes", "true", "1", "closed"]) {
      process.env.PHONE_SIGNIN = v;
      assert.equal(phoneSignInOpen(), false, JSON.stringify(v));
    }
    for (const v of ["open", " OPEN ", "Open"]) {
      process.env.PHONE_SIGNIN = v;
      assert.equal(phoneSignInOpen(), true, JSON.stringify(v));
      assert.equal(phoneSignInClosed(), null);
    }
  });

  test("ALLOWED_PHONES (break-glass list) is optional", () => {
    delete process.env.ALLOWED_PHONES;
    assertOtpReady();
    assert.equal(allowedPhonesRaw(), "");
    process.env.ALLOWED_PHONES = "  ";
    assertOtpReady();
    assert.equal(allowedPhonesRaw(), "");
  });

  test("APP_URL is reduced to its origin", () => {
    process.env.APP_URL = "https://orskh.vercel.app/some/path";
    assert.equal(appUrl().toString(), "https://orskh.vercel.app/");
    process.env.APP_URL = "ftp://x";
    assert.throws(() => appUrl(), ConfigError);
  });

  test("LINE endpoints: real by default, dev overrides honoured locally, ignored on Vercel", () => {
    delete process.env.LINE_AUTH_URL;
    delete process.env.LINE_API_URL;
    let c = lineConfig();
    assert.equal(c.authorizeUrl, "https://access.line.me/oauth2/v2.1/authorize");
    assert.equal(c.tokenUrl, "https://api.line.me/oauth2/v2.1/token");
    assert.equal(c.verifyUrl, "https://api.line.me/oauth2/v2.1/verify");
    assert.equal(c.redirectUri, "http://localhost:3999/api/auth/line/callback");

    process.env.LINE_AUTH_URL = "http://localhost:4010/oauth2/v2.1/authorize";
    process.env.LINE_API_URL = "http://localhost:4010/";
    c = lineConfig();
    assert.equal(c.authorizeUrl, "http://localhost:4010/oauth2/v2.1/authorize");
    assert.equal(c.tokenUrl, "http://localhost:4010/oauth2/v2.1/token");

    process.env.VERCEL = "1";
    c = lineConfig();
    assert.equal(c.authorizeUrl, "https://access.line.me/oauth2/v2.1/authorize");
    assert.equal(c.verifyUrl, "https://api.line.me/oauth2/v2.1/verify");
  });

  test("LINE channel: the old Auth.js names AUTH_LINE_ID / AUTH_LINE_SECRET still work; the new names win", () => {
    delete process.env.LINE_CHANNEL_ID;
    delete process.env.LINE_CHANNEL_SECRET;
    assert.throws(
      () => lineConfig(),
      (e: unknown) => e instanceof ConfigError && e.names.join() === "LINE_CHANNEL_ID,LINE_CHANNEL_SECRET",
      "reported under the new names",
    );
    process.env.AUTH_LINE_ID = "1111111111";
    process.env.AUTH_LINE_SECRET = "old-line-secret";
    let c = lineConfig();
    assert.equal(c.channelId, "1111111111");
    assert.equal(c.channelSecret, "old-line-secret");
    process.env.LINE_CHANNEL_ID = "2222222222";
    process.env.LINE_CHANNEL_SECRET = "new-line-secret";
    c = lineConfig();
    assert.equal(c.channelId, "2222222222");
    assert.equal(c.channelSecret, "new-line-secret");
  });

  test("SMS: local modes for development, only deeSMSX on Vercel", () => {
    process.env.SMS_PROVIDER = "file";
    process.env.SMS_OUTBOX_DIR = "/tmp/outbox";
    assert.equal(smsConfig().kind, "file");
    process.env.SMS_PROVIDER = "console";
    assert.equal(smsConfig().kind, "console");
    delete process.env.SMS_PROVIDER;
    assert.throws(() => smsConfig(), (e: unknown) => e instanceof ConfigError && e.names.includes("DEESMSX_API_KEY"), "deesmsx by default");
    process.env.SMS_PROVIDER = "file";
    process.env.VERCEL = "1";
    assert.throws(() => smsConfig(), (e: unknown) => e instanceof ConfigError && e.names.includes("DEESMSX_SECRET_KEY"));
    process.env.DEESMSX_API_KEY = "api-key";
    process.env.DEESMSX_SECRET_KEY = "secret-key";
    process.env.DEESMSX_SENDER = "ORSKH";
    const m = smsConfig();
    assert.equal(m.kind, "deesmsx");
    assert.equal(m.sender, "ORSKH");
    assert.equal(m.dailyCap, 300);
    delete process.env.DEESMSX_API_KEY;
    delete process.env.DEESMSX_SECRET_KEY;
    delete process.env.DEESMSX_SENDER;
  });

  test("cookie names: __Host- prefix + Secure on https, plain on http", () => {
    process.env.APP_URL = "https://orskh.vercel.app";
    assert.equal(cookieName("session"), "__Host-session");
    assert.deepEqual(cookieOptions("session"), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 3600,
    });
    process.env.APP_URL = "http://localhost:3000";
    assert.equal(cookieName("session"), "session");
    assert.equal(cookieOptions("tx").secure, false);
    assert.equal(cookieOptions("tx").maxAge, 600);
    assert.equal(cookieOptions("pending").maxAge, 900);
    assert.equal(cookieName("access"), "access");
    assert.equal(cookieOptions("access").maxAge, 12 * 3600);
    process.env.APP_URL = "https://orskh.vercel.app";
    assert.equal(cookieName("access"), "__Host-access");
    assert.equal(cookieOptions("access").httpOnly, true);
  });

  test("session length by device: 30 days in the LINE app, one shift and the browser's life elsewhere", () => {
    process.env.APP_URL = "https://orskh.vercel.app";
    const liff =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0 LIFF";
    const desktop = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    assert.equal(sessionTtlFor(liff), 30 * 24 * 3600);
    assert.equal(sessionTtlFor(desktop), 12 * 3600);
    assert.equal(sessionTtlFor(""), 12 * 3600);

    const phone = NextResponse.json({});
    setSessionCookie(phone, "tok", liff);
    assert.match(phone.headers.get("set-cookie") ?? "", /^__Host-session=tok;.*Max-Age=2592000/i);
    const computer = NextResponse.json({});
    setSessionCookie(computer, "tok", desktop);
    const set = computer.headers.get("set-cookie") ?? "";
    assert.match(set, /^__Host-session=tok;/);
    assert.doesNotMatch(set, /Max-Age|Expires/i, "a computer's session cookie ends with the browser");
    assert.match(set, /HttpOnly/i);
    assert.match(set, /Secure/i);
  });
});
