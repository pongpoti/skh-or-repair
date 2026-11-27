import type { NextRequest } from "next/server";
import { listBookings, saveBooking } from "@/lib/calendar-api";
import { calendarCall } from "@/lib/calendar-api-http";

/**
 * The calendar API's list (lib/calendar-api.ts): GET lists the calendar's bookings by day (?from=&to=), POST saves a
 * calendar record (books it, or changes its booking). Server to server with the calendar's bearer key; the proxy lets this path through without a session
 * (lib/calendar-api-path.ts).
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return calendarCall(req, {}, (pool) => listBookings(pool, req.nextUrl.searchParams));
}

export async function POST(req: NextRequest) {
  return calendarCall(req, { body: true, writes: true }, (pool, body) => saveBooking(pool, null, body));
}
