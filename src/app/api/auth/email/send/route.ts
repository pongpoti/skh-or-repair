import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { emailTransport } from "@/lib/email";
import { emailLoginFor, userIdFrom } from "@/lib/email-http";
import { EMAIL_LIMITS, hasLiveEmailCode, sendEmailCode } from "@/lib/email-otp";
import { emailConfig, otpPepper } from "@/lib/env";
import { waitText } from "@/lib/format";
import { guardPost, json, MSG, sleepUntil } from "@/lib/http";
import { logEvent } from "@/lib/otp";
import { clientIp, readJsonBody, userAgent } from "@/lib/security";

// Every accepted request takes at least this long, so response timing says little about the doctor.
const MIN_RESPONSE_MS = 700;

/**
 * POST {userId}: emails a new sign-in code to every address of this doctor (lib/email-otp.ts), for the LINE account of
 * this browser. Answers the addresses masked ("so•••@gmail.com") and the wait before another code.
 */
export async function POST(req: NextRequest) {
  const started = Date.now();
  const blocked = guardPost(req);
  if (blocked) return blocked;
  const login = await emailLoginFor(req);
  if (login instanceof NextResponse) return login;

  const body = await readJsonBody(req);
  const userId = userIdFrom(body?.userId);
  if (!userId) return json({ error: MSG.emailPick, reason: "pick" }, 400);

  const ip = clientIp(req.headers);
  const ua = userAgent(req.headers);
  const cfg = emailConfig();
  try {
    const pool = await db();
    const result = await sendEmailCode(pool, {
      userId,
      sub: login.sub,
      ip,
      pepper: otpPepper(),
      dailyCap: cfg.dailyCap,
      transport: emailTransport(cfg),
    });
    const event = (name: Parameters<typeof logEvent>[1]["event"]) => logEvent(pool, { event: name, sub: login.sub, ip, userAgent: ua });

    if (result.status === "sent") {
      await event("email_sent");
      await sleepUntil(started, MIN_RESPONSE_MS);
      return json({ ok: true, to: result.to, cooldown: EMAIL_LIMITS.cooldownS });
    }
    await sleepUntil(started, MIN_RESPONSE_MS);
    if (result.status === "unavailable") return json({ error: MSG.emailNotDoctor, reason: "unavailable" }, 400);
    if (result.status === "no_email") return json({ error: MSG.emailNone, reason: "no_email" }, 400);
    if (result.status === "limited") {
      await event("email_rate_limited");
      // Whether this LINE account has a usable code for this doctor (it can then be typed in).
      const codePending = await hasLiveEmailCode(pool, userId, login.sub);
      const daily = result.reason === "pair_day" || result.reason === "sub_users";
      const error = daily ? `${MSG.tooManyToday} ลองใหม่ได้ในอีก ${waitText(result.retryAfterS)}` : MSG.tooMany;
      return json({ error, retryAfter: result.retryAfterS, ...(codePending ? { codePending: true } : {}) }, 429, {
        headers: { "Retry-After": String(result.retryAfterS) },
      });
    }
    if (result.status === "capped") {
      console.warn("[email-otp] EMAIL_DAILY_CAP reached:", result.sentToday);
      await event("email_daily_cap");
      return json({ error: MSG.emailDailyCap }, 503, { headers: { "Retry-After": String(result.retryAfterS) } });
    }
    await event("email_send_failed");
    if (result.reason === "misconfigured") return json({ error: MSG.notReady }, 503);
    return json({ error: MSG.emailFailed }, 502);
  } catch (e) {
    console.error("[email-otp] send failed:", (e as Error).message);
    await sleepUntil(started, MIN_RESPONSE_MS);
    return json({ error: MSG.notReady }, 503);
  }
}
