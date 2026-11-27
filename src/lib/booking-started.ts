import "server-only";
import type { Pool, PoolClient } from "pg";
import type { AddedCase } from "./added-cases";
import { bookingUnderWay } from "./board-rows";
import { listCasesOn } from "./cases";
import type { PlaceId } from "./places";
import type { RepairPeriods } from "./repair";
import { getRepairPeriods } from "./repair-store";
import { workbookForDay } from "./workbook-store";

/**
 * Whether today's booking is on a row HOSxP says is under way or over (lib/board-rows.ts bookingUnderWay), on its
 * hospital's board: the row's actions then offer only booking again, and the server refuses an edit or a cancel (the
 * board's actions and the calendar API alike). Only today's list can say so.
 */
export async function startedToday(pool: Pool | PoolClient, booking: AddedCase, today: string, surgeonId: string, periods?: RepairPeriods): Promise<boolean> {
  if (booking.date !== today) return false;
  const place: PlaceId = booking.place === "tha-chalom" ? "tha-chalom" : "skh";
  const [workbook, bookings, inForce] = await Promise.all([
    workbookForDay(pool, today, place),
    listCasesOn(pool, today, place),
    periods ? Promise.resolve(periods) : getRepairPeriods(pool),
  ]);
  if (!workbook) return false;
  return bookingUnderWay({ date: today, periods: inForce, workbook: workbook.cases, bookings }, booking.id, surgeonId, place);
}
