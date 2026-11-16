import { after, NextResponse, type NextRequest } from "next/server";
import { accessGrantFor } from "@/lib/access-http";
import { noteAuthorized } from "@/lib/authz";
import { clearCookie, sessionTtlFor, setSessionCookie } from "@/lib/cookies";
import { db } from "@/lib/db";
import { sessionSecret, telegramEnabled } from "@/lib/env";
import { guardPost, json, MSG } from "@/lib/http";
import { logEvent } from "@/lib/otp";
import { clientIp, readJsonBody, userAgent } from "@/lib/security";
import { announceClaim, ensureWebhook } from "@/lib/telegram";
import { signSession } from "@/lib/tokens";
import { claimUser, saveClaimTelegramRefs } from "@/lib/user-list";

/** Largest users.id (an integer column). */
const MAX_USER_ID = 2_147_483_647;

/** A users row id from the page: a positive whole number within users.id's range (sent as a number or as its digits). */
function userIdOf(v: unknown): string | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[1-9]\d{0,9}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_USER_ID ? String(n) : null;
}

/**
 * POST {userId}: the verified number of this browser's access cookie claims that name from the staff list
 * (lib/user-list.ts claimUser(): first claim wins and the name is then locked for everyone else, one name per number and
 * per LINE account, limits, the 24 h block after an undo; the LINE account is bound to the number in the same
 * transaction; doctors are refused, they sign in by email). On success the access cookie becomes a session. When
 * Telegram is set up, every chat in TELEGRAM_CHAT_ID is told after the response, with a button to undo the claim.
 */
export async function POST(req: NextRequest) {
  const blocked = guardPost(req);
  if (blocked) return blocked;
  const grant = await accessGrantFor(req);
  if (grant instanceof NextResponse) return grant;

  const body = await readJsonBody(req);
  const userId = userIdOf(body?.userId);
  if (!userId) return json({ error: MSG.claimPick, reason: "invalid" }, 400);

  const ip = clientIp(req.headers);
  const ua = userAgent(req.headers);
  try {
    const pool = await db();
    const result = await claimUser(pool, { userId, phone: grant.phone, sub: grant.sub, lineName: grant.name, ip, userAgent: ua });
    switch (result.status) {
      case "blocked":
        await logEvent(pool, { event: "claim_refused", sub: grant.sub, phone: grant.phone, ip, userAgent: ua });
        return json({ error: result.by === "line" ? MSG.claimBlockedLine : MSG.claimBlocked, reason: "blocked", by: result.by }, 403);
      case "limited":
        await logEvent(pool, { event: "claim_refused", sub: grant.sub, phone: grant.phone, ip, userAgent: ua });
        return json({ error: MSG.claimTooMany, reason: "limited", retryAfter: result.retryAfterS }, 429, {
          headers: { "Retry-After": String(result.retryAfterS) },
        });
      case "taken":
        return json({ error: MSG.claimTaken, reason: "taken" }, 409);
      case "unavailable":
        return json({ error: MSG.claimUnavailable, reason: "unavailable" }, 409);
      case "phone_has_claim":
        return json({ error: MSG.claimHasName, reason: "phone_has_claim" }, 409);
      case "line_has_claim":
        return json({ error: MSG.claimLineHasName, reason: "line_has_claim" }, 409);
    }

    if (result.status === "claimed" && telegramEnabled()) {
      const { claim, user } = result;
      // Registered before anything else can fail: every stored claim is announced. Telegram being slow or down never
      // fails the claim; announceClaim() tries twice, and a claim that reached nobody keeps an empty tg_messages.
      after(async () => {
        try {
          await ensureWebhook(); // so the undo button reaches this app
        } catch (e) {
          console.error("[claim] webhook registration failed:", (e as Error).message);
        }
        try {
          const sent = await announceClaim(user, claim);
          if (sent.length) await saveClaimTelegramRefs(pool, claim.id, sent);
          else console.error("[claim] claim", claim.id, "was not sent to Telegram (unannounced: see README, Claims)");
        } catch (e) {
          console.error("[claim] notifying Telegram failed:", (e as Error).message);
        }
      });
    }
    // "own_claim": the number already holds this name (another tab, or a retry): claimUser() bound it, sign in.
    noteAuthorized(grant.phone);
    const token = await signSession({ sub: grant.sub, phone: grant.phone, userId: null, name: grant.name, picture: grant.picture }, sessionSecret(), sessionTtlFor(req.headers.get("user-agent") ?? ""));
    const res = NextResponse.json({ ok: true, redirect: "/" }, { headers: { "Cache-Control": "no-store" } });
    clearCookie(res, "access");
    clearCookie(res, "pending");
    setSessionCookie(res, token, req.headers.get("user-agent") ?? "");
    return res;
  } catch (e) {
    console.error("[claim] claim failed:", (e as Error).message);
    return json({ error: MSG.notReady }, 503);
  }
}
