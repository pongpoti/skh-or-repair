import type { AddedCase } from "@/lib/added-cases";
import { allocationFor } from "@/lib/allocation";
import { addDays } from "@/lib/days";
import { roomsHeldBy } from "@/lib/placement";
import type { WorkbookCase } from "@/lib/board-rows";
import type { RepairPeriods } from "@/lib/repair";
import { openRooms } from "@/lib/rooms";
import type { CaseStatus, Shift } from "@/lib/schedule";

/** The preview's own doctor (users.id), who sees the HN of the bookings they made. */
export const SAMPLE_DOCTOR_ID = "9001";

/**
 * Made-up rows for /preview?sample=1 (development only), so every row icon, flag and room mark can be seen without a
 * database: invented operations, surgeons and HNs, never real patient data. The bookings use the day's first three open
 * rooms, whatever the layout; the workbook cases take their departments from those rooms and are placed by the board's
 * rules (lib/placement.ts). Two workbook cases nobody booked: a dressing, which goes to the day's dressing room
 * unflagged (booking does not matter there), and an excision in an operating room, flagged. Bookings HOSxP does not list
 * leave the board once the workbook is in (lib/board-rows.ts). One workbook HN keeps a leading zero, as HOSxP may write
 * it, to show it still matches the booking (bookings store the HN normalised, lib/hn.ts). Two bookings are in the
 * dressing room by the doctor's choice, one for each answer to the scrub question, so both the doctor's and the scrub's
 * icons show with &upload=0; the scrub's is in HOSxP too, so it also shows after the upload. Three bookings carry a
 * made-up note (หมายเหตุ), one over several lines, so the rows' note button and its dialog can be seen. Two of the sample
 * doctor's bookings carry a made-up diagnosis, one with a patient's name too (it is not in HOSxP, so only &upload=0 shows
 * it; HOSxP's name stands for a matched one), so the rows' Dx line can be seen.
 */
export function sampleCases(date: string, periods: RepairPeriods): { workbook: WorkbookCase[]; bookings: AddedCase[] } {
  const rooms = openRooms(date, periods).map((room) => room.id);
  if (rooms.length === 0) return { workbook: [], bookings: [] };
  const room = (i: number) => rooms[i % rooms.length];
  const dept = (roomId: string) => allocationFor(roomId, date, periods)?.am?.code ?? null;

  let position = 0;
  const hosxp = (roomId: string, hn: string, operation: string, surgeon: string, status: CaseStatus = "scheduled", shift: Shift = "in"): WorkbookCase => {
    position += 1;
    const patientName = `${["นาย", "นาง", "น.ส."][position % 3]} ตัวอย่าง ผู้ป่วย${position}`;
    return { caseId: `9000${position}`, hn, patientName, operation, surgeon, dept: dept(roomId), team: null, urgency: "Elective", shift, status, position };
  };
  let id = 0;
  const booking = (
    roomId: string,
    hn: string,
    operation: string,
    surgeonId: string,
    surgeon: string,
    scrubDoes: boolean | null = null,
    note = "",
    patient: { name?: string; diagnosis?: string } = {},
  ): AddedCase => {
    id += 1;
    const dressing = scrubDoes !== null;
    // Booked a week before, an hour apart, oldest first as the database lists them.
    const bookedAt = new Date(`${addDays(date, -7)}T${String(8 + id).padStart(2, "0")}:15:00+07:00`).toISOString();
    // An hour each from 08:30 in booking order, so the day view and the rows show times.
    const start = 8 * 60 + 30 + (id - 1) * 60;
    const time = start + 60 <= 15 * 60 + 30 ? { start, end: start + 60 } : { start: null, end: null };
    const patientName = patient.name ?? "";
    const diagnosis = patient.diagnosis ?? "";
    return { id: String(id), date, roomId, hn, patientName, diagnosis, operation, shift: "in", dressing, scrubDoes, note, surgeonId, surgeon, subtype: "GENSX", bookedAt, ...time };
  };
  const dressingRoom = roomsHeldBy("INFECT", date, periods)[0] ?? room(0);

  const workbook = [
    hosxp(room(0), "0100001", "Excision of lipoma, back", "นพ. ตัวอย่าง หนึ่ง", "in-progress"),
    hosxp(room(0), "100002", "Wound dressing, left leg", "พญ. ตัวอย่าง สอง"),
    hosxp(room(1), "100004", "Open reduction and internal fixation, radius", "นพ. ตัวอย่าง สาม"),
    hosxp(room(2), "100005", "Laparoscopic cholecystectomy", "นพ. ตัวอย่าง หนึ่ง", "delayed", "out"),
    hosxp(room(1), "100009", "Excision of breast mass, right", "นพ. ตัวอย่าง สาม"),
    hosxp(dressingRoom, "100007", "I&D abscess, right thigh", "นพ. ตัวอย่าง หนึ่ง"),
  ];
  const bookings = [
    booking(room(0), "100001", "", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง", null, "ขอ C-arm\nเตรียมเลือด PRC 2 unit"),
    booking(room(1), "100003", "", "9002", "ตัวอย่าง สาม"),
    booking(room(1), "100004", "ORIF radius", "9002", "ตัวอย่าง สาม", null, "ขอ set small fragment และ mini C-arm"),
    booking(room(2), "100005", "Cholecystectomy", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง", null, "", { diagnosis: "Symptomatic gallstone" }),
    booking(room(2), "100006", "Herniorrhaphy, right", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง", null, "", { name: "นาย ตัวอย่าง จองเอง", diagnosis: "Inguinal hernia, right" }),
    booking(dressingRoom, "100007", "I&D abscess, right thigh", SAMPLE_DOCTOR_ID, "ตัวอย่าง หนึ่ง", true, "ผู้ป่วยแพ้ latex"),
    booking(dressingRoom, "100008", "Wound dressing, sacrum", "9002", "ตัวอย่าง สาม", false),
  ];
  return { workbook, bookings };
}
