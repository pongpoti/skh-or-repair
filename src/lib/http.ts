import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "./env";
import { CLAIM_BLOCKED, CLAIM_BLOCKED_LINE } from "./claim-text";
import { isJsonRequest, isSameOrigin } from "./security";

export const MSG = {
  notReady: "ระบบยังไม่พร้อม ติดต่อผู้ดูแล",
  badRequest: "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง",
  sessionExpired: "หมดเวลา เริ่มเข้าสู่ระบบใหม่",
  // U+00A0 keeps a number with its unit ("10 หลัก") on one line (Thai line breaking)
  invalidPhone: "ใส่เบอร์มือถือ 10\u00A0หลัก ขึ้นต้นด้วย 06, 08 หรือ 09",
  // deeSMSX refused the number (reference code 99)
  smsRejected: "ส่ง SMS ไปเบอร์นี้ไม่ได้ ตรวจเบอร์อีกครั้ง",
  // deeSMSX has no credit left (102)
  smsUnavailable: "ส่ง SMS ไม่ได้ตอนนี้ ลองใหม่ภายหลัง",
  // deeSMSX may or may not have sent the SMS (timeout, unreadable answer); the wait is LIMITS.cooldownS
  smsUncertain: "ส่งรหัสไม่สำเร็จ รอ 1\u00A0นาทีแล้วขอรหัสใหม่",
  // SMS_DAILY_CAP reached
  dailyCap: "วันนี้ส่ง SMS ครบจำนวนแล้ว ติดต่อผู้ดูแล",
  tooMany: "ขอรหัสบ่อยเกินไป รอสักครู่แล้วลองใหม่",
  tooManyToday: "วันนี้ขอรหัสครบแล้ว",
  wrongCode: "รหัสไม่ถูกต้อง",
  locked: "ใส่รหัสผิดหลายครั้ง ขอรหัสใหม่",
  expired: "รหัสหมดอายุแล้ว ขอรหัสใหม่",
  failed: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง",
  // name claims (/login/claim)
  claimPick: "เลือกชื่อของคุณก่อน",
  claimType: "เลือกตำแหน่งก่อน",
  claimTaken: "ชื่อนี้มีคนเลือกแล้ว ถ้าเป็นชื่อคุณ ติดต่อผู้ดูแล",
  claimUnavailable: "ไม่มีชื่อนี้ในรายชื่อแล้ว เลือกใหม่",
  claimHasName: "เบอร์นี้ใช้กับชื่ออื่นแล้ว ติดต่อผู้ดูแล",
  claimLineHasName: "LINE นี้ใช้กับชื่ออื่นแล้ว ติดต่อผู้ดูแล",
  claimBlocked: CLAIM_BLOCKED,
  claimBlockedLine: CLAIM_BLOCKED_LINE,
  claimTooMany: "เลือกชื่อบ่อยเกินไป ลองใหม่ภายหลัง",
  // doctors' email codes (/login/doctor)
  emailPick: "เลือกชื่อของคุณก่อน",
  emailNotDoctor: "ไม่มีชื่อนี้ในรายชื่อแพทย์ เลือกใหม่",
  emailNone: "ยังไม่มีอีเมลของชื่อนี้ ติดต่อผู้ดูแล",
  emailDailyCap: "วันนี้ส่งอีเมลครบจำนวนแล้ว ติดต่อผู้ดูแล",
  emailFailed: "ส่งอีเมลไม่สำเร็จ ลองใหม่อีกครั้ง",
  emailLineHasName: "LINE นี้ใช้กับชื่ออื่นแล้ว ติดต่อผู้ดูแล",
  // the doctor's name is held by another LINE account: only an administrator can free it
  emailTaken: "ชื่อนี้มีคนใช้แล้ว ถ้าเป็นชื่อคุณ ติดต่อผู้ดูแล",
} as const;

export function json(body: unknown, status = 200, init?: { headers?: Record<string, string> }): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

/** Origin of the app if configured, else the request's own origin (used only for error redirects). */
export function originFor(req: NextRequest): string {
  try {
    return appUrl().origin;
  } catch {
    return req.nextUrl.origin;
  }
}

/**
 * CSRF guard for every POST: Origin (fallback Referer) must equal APP_URL's origin,
 * and the body must be JSON. Returns an error response or null when OK.
 */
export function guardPost(req: NextRequest): NextResponse | null {
  let origin: string;
  try {
    origin = appUrl().origin;
  } catch {
    return json({ error: MSG.notReady }, 503);
  }
  if (!isSameOrigin(req.headers, origin)) return json({ error: MSG.badRequest }, 403);
  if (!isJsonRequest(req.headers)) return json({ error: MSG.badRequest }, 415);
  return null;
}

export type ErrorCode = "cancelled" | "state" | "line" | "config" | "failed";

export function redirectToError(req: NextRequest, code: ErrorCode): NextResponse {
  const res = NextResponse.redirect(new URL(`/login/error?code=${code}`, originFor(req)), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function sleepUntil(startMs: number, minMs: number): Promise<void> {
  const wait = startMs + minMs - Date.now();
  return wait > 0 ? new Promise((r) => setTimeout(r, wait)) : Promise.resolve();
}
