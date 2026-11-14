import type { AddedCase } from "@/lib/added-cases";
import { allocationFor } from "@/lib/allocation";
import type { WorkbookCase } from "@/lib/board-rows";
import type { RepairPeriods } from "@/lib/repair";
import { openRooms } from "@/lib/rooms";
import type { CaseStatus, Shift } from "@/lib/schedule";

/** The preview's own doctor (users.id), who sees the HN of the bookings they made. */
export const SAMPLE_DOCTOR_ID = "9001";

/**
 * Made-up rows for /preview?sample=1 (development only), so every source chip, flag and room mark can be seen without
 * a database: invented operations, surgeons and HNs, never real patient data. The bookings use the day's first three
 * open rooms, whatever the layout; the workbook cases take their departments from those rooms and are placed by the
 * board's rules (lib/placement.ts), so the one nobody booked, a dressing, goes to the day's dressing room. One workbook
 * HN keeps a leading zero, as HOSxP may write it, to show it still matches the booking (bookings store the HN
 * normalised, lib/hn.ts).
 */
export function sampleCases(date: string, periods: RepairPeriods): { workbook: WorkbookCase[]; bookings: AddedCase[] } {
  const rooms = openRooms(date, periods).map((room) => room.id);
  if (rooms.length === 0) return { workbook: [], bookings: [] };
  const room = (i: number) => rooms[i % rooms.length];
  const dept = (roomId: string) => allocationFor(roomId, date, periods)?.am?.code ?? null;

  let position = 0;
  const hosxp = (roomId: string, hn: string, operation: string, surgeon: string, status: CaseStatus = "scheduled", shift: Shift = "in"): WorkbookCase => {
    position += 1;
    return { caseId: `9000${position}`, hn, operation, surgeon, dept: dept(roomId), team: null, urgency: "Elective", shift, status, position };
  };
  let id = 0;
  const booking = (roomId: string, hn: string, operation: string, surgeonId: string, surgeon: string): AddedCase => {
    id += 1;
    return { id: String(id), date, roomId, hn, operation, shift: "in", surgeonId, surgeon, subtype: "GENSX" };
  };

  const workbook = [
    hosxp(room(0), "0100001", "Excision of lipoma, back", "นพ. ตัวอย่าง หนึ่ง", "in-progress"),
    hosxp(room(0), "100002", "Wound dressing, left leg", "พญ. ตัวอย่าง สอง"),
    hosxp(room(1), "100004", "Open reduction and internal fixation, radius", "นพ. ตัวอย่าง สาม"),
    hosxp(room(2), "100005", "Laparoscopic cholecystectomy", "นพ. ตัวอย่าง หนึ่ง", "delayed", "out"),
  ];
  const bookings = [
    booking(room(0), "100001", "", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง"),
    booking(room(1), "100003", "", "9002", "ตัวอย่าง สาม"),
    booking(room(1), "100004", "ORIF radius", "9002", "ตัวอย่าง สาม"),
    booking(room(2), "100005", "Cholecystectomy", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง"),
    booking(room(2), "100006", "Herniorrhaphy, right", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง"),
  ];
  return { workbook, bookings };
}
