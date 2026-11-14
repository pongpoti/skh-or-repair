import { after, NextResponse, type NextRequest } from "next/server";
import { noteDoctorAuthorized, noteDoctorRevoked, noteRevoked } from "@/lib/authz";
import { clearCookie, setCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { emailLoginFor, userIdFrom } from "@/lib/email-http";
import { signInByEmail, verifyEmailCode } from "@/lib/email-otp";
import { otpPepper, sessionSecret } from "@/lib/env";
import { guardPost, json, MSG } from "@/lib/http";
import { logEvent } from "@/lib/otp";
import { clientIp, readJsonBody, safeNextPath, userAgent } from "@/lib/security";
import { buildEmailSignInMessage, notify } from "@/lib/telegram";
import { signSession } from "@/lib/tokens";

/**
 * POST {userId, code}: checks a doctor's email code for the LINE account of this browser. A good code makes this LINE
 * account the holder of the doctor's name (lib/email-otp.ts signInByEmail()) and signs it in; the administrators get a
 * notice (no undo button: the code went to the doctor's own addresses).
 */
export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;
  const login = await emailLoginFor(req);
  if (login instanceof NextResponse) return login;

  const body = await readJsonBody(req);
  const userId = userIdFrom(body?.userId);
  // Accept full-width (NFKC) and Thai digits, ignore spaces.
  const code =
    typeof body?.code === "string"
      ? body.code
          .normalize("NFKC")
          .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
          .replace(/\s+/g, "")
      : "";
  if (!userId) return json({ error: MSG.emailPick, reason: "pick" }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: MSG.wrongCode, reason: "format" }, 400);

  const ip = clientIp(req.headers);
  const ua = userAgent(req.headers);
  try {
    const pool = await db();
    const event = (name: Parameters<typeof logEvent>[1]["event"]) => logEvent(pool, { event: name, sub: login.sub, ip, userAgent: ua });
    const result = await verifyEmailCode(pool, { userId, sub: login.sub, code, pepper: otpPepper() });
    if (!result.ok) {
      if (result.reason === "locked") {
        await event("email_locked");
        return json({ ok: false, error: MSG.locked, reason: "locked", remaining: 0 }, 400);
      }
      if (result.reason === "expired") return json({ ok: false, error: MSG.expired, reason: "expired", remaining: 0 }, 400);
      await event("email_failed");
      return json(
        { ok: false, error: `${MSG.wrongCode} เหลือโอกาสอีก ${result.remaining} ครั้ง`, reason: "invalid", remaining: result.remaining },
        400,
      );
    }

    const signed = await signInByEmail(pool, { userId, sub: login.sub, lineName: login.name, ip, userAgent: ua });
    if (signed.status === "unavailable") {
      await event("email_refused");
      return json({ ok: false, error: MSG.emailNotDoctor, reason: "unavailable" }, 400);
    }
    if (signed.status === "line_has_claim") {
      await event("email_refused");
      return json({ ok: false, error: MSG.emailLineHasName, reason: "line_has_claim" }, 409);
    }

    noteDoctorAuthorized(userId, login.sub);
    const { replaced } = signed;
    if (replaced) {
      if (replaced.phone) noteRevoked(replaced.phone);
      else noteDoctorRevoked(userId, replaced.lineSub);
    }
    if (signed.created) {
      // After the response: a slow or failing Telegram never delays or breaks the sign-in. A doctor moving their own
      // LINE account from a number to email is not news.
      const at = new Date();
      const before = replaced && replaced.lineSub !== login.sub ? replaced : null;
      after(() => notify(buildEmailSignInMessage(signed.user, { lineName: login.name, at, replaced: before })));
    }
    const token = await signSession({ sub: login.sub, phone: null, userId, name: login.name, picture: login.picture }, sessionSecret());
    const res = NextResponse.json({ ok: true, redirect: safeNextPath(login.next) }, { headers: { "Cache-Control": "no-store" } });
    clearCookie(res, "pending");
    clearCookie(res, "access");
    setCookie(res, "session", token);
    return res;
  } catch (e) {
    console.error("[email-otp] verify failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
