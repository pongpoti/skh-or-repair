import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { clientAllowed, gateMode, isDesktop, isLiff, isLineApp, isPhone, liffUrl, needsDeskRole } from "@/lib/gate";

// Real-world shaped User-Agents (versions invented).
const UA = {
  iosLiff:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0 LIFF",
  iosLine:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0",
  androidLiff:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.10.0/IAB LIFF",
  androidLine:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.10.0/IAB",
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidTabletLine:
    "Mozilla/5.0 (Linux; Android 14; SM-X710 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Safari/537.36 Line/14.10.0/IAB LIFF",
  ipadLine:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.10.0 LIFF",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  macLine:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/9.5.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  androidTabletChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  curl: "curl/8.5.0",
  liffWord: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile LIFF",
};

const SAVED = { ...process.env };
afterEach(() => {
  for (const k of ["CLIENT_GATE", "LIFF_ID", "VERCEL", "VERCEL_ENV"]) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("device detection", () => {
  test("LINE app and LIFF", () => {
    assert.ok(isLineApp(UA.iosLine) && isLineApp(UA.androidLine) && isLineApp(UA.macLine));
    assert.ok(!isLineApp(UA.iosSafari) && !isLineApp(UA.androidChrome) && !isLineApp(UA.desktopChrome));
    assert.ok(isLiff(UA.iosLiff) && isLiff(UA.androidLiff));
    assert.ok(!isLiff(UA.iosLine) && !isLiff(UA.androidLine));
    assert.ok(!isLiff(UA.liffWord), "LIFF without the LINE app is not LIFF");
  });
  test("computers and tablets: browsers that are not phones", () => {
    for (const ua of [UA.desktopChrome, UA.windowsEdge, UA.macSafari, UA.linuxFirefox, UA.macLine, UA.ipadLine, UA.androidTabletChrome])
      assert.ok(isDesktop(ua), ua);
    for (const ua of [UA.iosLiff, UA.androidLiff, UA.iosSafari, UA.androidChrome, UA.liffWord, UA.curl, ""]) assert.ok(!isDesktop(ua), ua);
  });
  test("phones only", () => {
    for (const ua of [UA.iosLine, UA.androidLine, UA.iosSafari, UA.androidChrome]) assert.ok(isPhone(ua), ua);
    for (const ua of [UA.androidTabletLine, UA.ipadLine, UA.desktopChrome, UA.macLine, ""]) assert.ok(!isPhone(ua), ua);
  });
});

describe("clientAllowed", () => {
  test("off lets everything through", () => {
    assert.ok(clientAllowed(UA.desktopChrome, "off"));
    assert.ok(clientAllowed(null, "off"));
  });
  test("liff: the LIFF app on a phone, and any browser on a computer or tablet", () => {
    for (const ua of [
      UA.iosLiff,
      UA.androidLiff,
      UA.desktopChrome,
      UA.windowsEdge,
      UA.macSafari,
      UA.linuxFirefox,
      UA.macLine,
      UA.ipadLine,
      UA.androidTabletLine,
      UA.androidTabletChrome,
    ])
      assert.ok(clientAllowed(ua, "liff"), ua);
    for (const ua of [UA.iosLine, UA.androidLine, UA.iosSafari, UA.androidChrome, UA.liffWord, UA.curl, "", null, undefined])
      assert.ok(!clientAllowed(ua, "liff"), String(ua));
  });
});

describe("needsDeskRole: the computer board is for MX and admins only", () => {
  test("every client the gate lets in but a phone in LIFF, and only with the gate on", () => {
    for (const ua of [UA.desktopChrome, UA.windowsEdge, UA.macSafari, UA.linuxFirefox, UA.macLine, UA.ipadLine, UA.androidTabletLine, UA.androidTabletChrome])
      assert.ok(needsDeskRole(ua, "liff"), ua);
    for (const ua of [UA.iosLiff, UA.androidLiff]) assert.ok(!needsDeskRole(ua, "liff"), ua);
    for (const ua of [UA.desktopChrome, UA.iosLiff, ""]) assert.ok(!needsDeskRole(ua, "off"), `${ua} with the gate off`);
  });
});

describe("gateMode and the LIFF link", () => {
  test("liff on Vercel (production and preview, LIFF_ID or not), off elsewhere", () => {
    delete process.env.CLIENT_GATE;
    delete process.env.LIFF_ID;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    assert.equal(gateMode(), "off");
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "preview";
    assert.equal(gateMode(), "liff");
    process.env.VERCEL_ENV = "production";
    assert.equal(gateMode(), "liff");
    process.env.LIFF_ID = "2001234567-AbCdEfGh";
    assert.equal(gateMode(), "liff");
  });
  test("CLIENT_GATE: off is the break-glass, anything else fails closed", () => {
    process.env.VERCEL = "1";
    process.env.CLIENT_GATE = " OFF ";
    assert.equal(gateMode(), "off");
    for (const v of ["line", "liff", "of", "0"]) {
      process.env.CLIENT_GATE = v;
      assert.equal(gateMode(), "liff", v);
    }
    delete process.env.VERCEL;
    process.env.CLIENT_GATE = "liff";
    assert.equal(gateMode(), "liff");
  });
  test("liffUrl only for a well-formed LIFF ID", () => {
    delete process.env.LIFF_ID;
    assert.equal(liffUrl(), null);
    process.env.LIFF_ID = "2001234567-AbCdEfGh";
    assert.equal(liffUrl(), "https://liff.line.me/2001234567-AbCdEfGh");
    for (const bad of ["abc", "https://liff.line.me/2001234567-AbCdEfGh", "2001234567-Ab/../x"]) {
      process.env.LIFF_ID = bad;
      assert.equal(liffUrl(), null, bad);
    }
  });
});
