import "server-only";
import { revalidatePath } from "next/cache";
import type { NextRequest, NextResponse } from "next/server";
import { CALENDAR_MAX_BODY, checkCaller, type ApiReply } from "./calendar-api";
import { db } from "./db";
import { json } from "./http";
import { BOARD_PATH, THA_CHALOM_PATH } from "./places";
import { isJsonRequest, readJsonBody } from "./security";

/**
 * A saved change shows on the boards (they are force-dynamic anyway). Saved is saved: a failure here (outside Next's
 * request scope, as in the unit tests) is no failure of the call.
 */
function refreshBoards(): void {
  try {
    revalidatePath(BOARD_PATH);
    revalidatePath(THA_CHALOM_PATH);
  } catch (error) {
    console.warn("[calendar-api] board refresh skipped:", error instanceof Error ? error.message.slice(0, 120) : "unknown error");
  }
}

/**
 * The calendar API's routes (src/app/api/v1/calendar/cases) around lib/calendar-api.ts: the caller's key first, then the
 * body (JSON, at most CALENDAR_MAX_BODY bytes), then the call. One log line per call, with the method, the calendar's
 * id, the status and the answer's code: never a body, a header, an HN or a name. A database error is a 503 with its
 * message only logged (a pg error's detail can quote the row, and a booking's row holds the HN).
 */
export async function calendarCall(
  req: NextRequest,
  what: { id?: string | null; body?: boolean; writes?: boolean },
  run: (pool: Awaited<ReturnType<typeof db>>, body: Record<string, unknown>) => Promise<ApiReply>,
): Promise<NextResponse> {
  const answer = (reply: ApiReply) => {
    const code = (reply.body as { error?: unknown }).error;
    console.info(`[calendar-api] ${req.method} ${what.id ?? "-"} ${reply.status}${typeof code === "string" ? ` ${code}` : ""}`);
    return json(reply.body, reply.status, reply.headers ? { headers: reply.headers } : undefined);
  };
  try {
    const refused = checkCaller(req.headers);
    if (refused) return answer(refused);
    if (what.id === null) return answer({ status: 404, body: { ok: false, error: "not_found", message: "ไม่พบรายการนี้" } });
    let body: Record<string, unknown> = {};
    if (what.body) {
      if (!isJsonRequest(req.headers)) return answer({ status: 415, body: { ok: false, error: "not_json", message: "ส่งเป็น application/json" } });
      if (Number(req.headers.get("content-length") ?? "0") > CALENDAR_MAX_BODY) {
        return answer({ status: 413, body: { ok: false, error: "too_large", message: "ข้อมูลใหญ่เกินไป" } });
      }
      const read = await readJsonBody(req, CALENDAR_MAX_BODY);
      if (!read) return answer({ status: 400, body: { ok: false, error: "bad_json", message: "อ่าน JSON ไม่ได้ (ต้องเป็น object เดียว)" } });
      body = read;
    }
    const reply = await run(await db(), body);
    if (what.writes && reply.status < 300) refreshBoards();
    return answer(reply);
  } catch (error) {
    console.error(`[calendar-api] ${req.method} ${what.id ?? "-"} failed:`, error instanceof Error ? error.message : "unknown error");
    return answer({ status: 503, body: { ok: false, error: "unavailable", message: "ระบบไม่พร้อม ลองใหม่ภายหลัง" } });
  }
}
