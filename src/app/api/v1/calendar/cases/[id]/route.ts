import type { NextRequest } from "next/server";
import { calendarId, cancelBooking, getBooking, saveBooking } from "@/lib/calendar-api";
import { calendarCall } from "@/lib/calendar-api-http";

/**
 * One calendar record's booking by the calendar's own id (lib/calendar-api.ts): GET reads it, PUT saves it (the whole
 * record: books it, or changes its booking), DELETE cancels it. Server to server with the calendar's bearer key (lib/calendar-api-path.ts).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const id = calendarId((await params).id);
  return calendarCall(req, { id }, (pool) => getBooking(pool, id as string));
}

export async function PUT(req: NextRequest, { params }: Params) {
  const id = calendarId((await params).id);
  return calendarCall(req, { id, body: true, writes: true }, (pool, body) => saveBooking(pool, id as string, body));
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const id = calendarId((await params).id);
  return calendarCall(req, { id, writes: true }, (pool) => cancelBooking(pool, id as string));
}
