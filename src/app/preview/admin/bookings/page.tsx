import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { BookingLog } from "@/components/booking-log";
import { describeChanges, logDay, logRoom, logTime, placeName, type LogEntry, type LogEvent, type LogKind } from "@/lib/booking-log";
import { rangeText } from "@/lib/booking-time";
import { displayHn } from "@/lib/hn";
import type { PlaceId } from "@/lib/places";

export const dynamic = "force-dynamic";

type Sample = {
  place: PlaceId;
  room: string;
  date: string;
  time?: [number, number];
  hn: string;
  patient?: string;
  diagnosis?: string;
  operation: string;
  doctor: [id: string, name: string, specialty: string];
  calendar?: boolean;
  dressing?: boolean;
  note?: string;
  /** Hours before now it was booked. */
  booked: number;
  /** Later events: hours after booking, kind, changes. */
  later?: Array<[hours: number, kind: LogKind, changes?: Record<string, [unknown, unknown]>]>;
};

const KIM: Sample["doctor"] = ["1", "กมล ทองดี", "OBGYN"];
const CHAI: Sample["doctor"] = ["2", "ชัยวัฒน์ มีสุข", "GENSX"];
const PRA: Sample["doctor"] = ["3", "ประเสริฐ กล้าหาญ", "ORTHO"];
const SOM: Sample["doctor"] = ["4", "สมใจ ใจเย็น", "URO"];
const NAT: Sample["doctor"] = ["5", "ณัฐพล วงศ์ใหญ่", "CVT"];

/** Invented bookings (no database here), every kind of event among them. */
const SAMPLES: Sample[] = [
  { place: "skh", room: "or-5", date: "2026-12-01", time: [510, 600], hn: "1234567", patient: "สมศรี ใจงาม", diagnosis: "Fracture distal radius", operation: "ORIF distal radius", doctor: PRA, booked: 1 },
  { place: "skh", room: "or-3", date: "2026-12-01", hn: "7654321", operation: "Lap cholecystectomy", doctor: CHAI, booked: 3, later: [[1, "edit", { operation: ["LC", "Lap cholecystectomy"], note: [null, "งดน้ำงดอาหารหลังเที่ยงคืน"] }]] },
  { place: "skh", room: "or-9", date: "2026-12-02", hn: "1112223", operation: "TAH with BSO", doctor: KIM, booked: 5, later: [[2, "move", { date: ["2026-12-01", "2026-12-02"], room: ["or-8", "or-9"] }]] },
  { place: "skh", room: "or-11", date: "2026-12-01", time: [780, 900], hn: "3334445", operation: "CABG", doctor: NAT, calendar: true, booked: 6 },
  { place: "tha-chalom", room: "or-2", date: "2026-12-02", hn: "5556667", operation: "TURP", doctor: SOM, booked: 8, later: [[0.2, "cancel"]] },
  { place: "skh", room: "or-5", date: "2026-12-03", hn: "8889990", operation: "Debridement", doctor: PRA, dressing: true, booked: 20, later: [[0.1, "cancel"], [0.15, "restore"]] },
  { place: "skh", room: "or-3", date: "2026-12-03", hn: "2223334", operation: "Hernioplasty", doctor: CHAI, booked: 26, later: [[3, "edit", { time: [null, [600, 690]] }], [5, "cancel"]] },
  { place: "tha-chalom", room: "scope", date: "2026-12-04", hn: "4445556", operation: "EGD", doctor: CHAI, booked: 50 },
  { place: "skh", room: "or-9", date: "2026-12-04", hn: "6667778", operation: "Cesarean section", doctor: KIM, booked: 75, later: [[4, "edit", { hn: ["6667770", "6667778"], patient: [null, "มาลี สุขใจ"] }]] },
  { place: "skh", room: "or-11", date: "2026-12-07", hn: "9990001", operation: "AVR", doctor: NAT, calendar: true, booked: 120, later: [[10, "cancel"]] },
  { place: "skh", room: "or-13", date: "2026-12-07", hn: "1212121", operation: "TKA right", doctor: PRA, booked: 200 },
  { place: "skh", room: "or-10", date: "2026-12-08", hn: "3434343", operation: "PCNL", doctor: SOM, booked: 400 },
];

function sampleEntries(now: number): LogEntry[] {
  return SAMPLES.map((s, index) => {
    const at = (hours: number) => new Date(now - hours * 3_600_000);
    const via = s.calendar ? "calendar" : "board";
    const events: LogEvent[] = [{ id: `${index}-0`, kind: "book", via, at: at(s.booked).toISOString(), atText: logTime(at(s.booked)), changes: [] }];
    (s.later ?? []).forEach(([hours, kind, changes], i) => {
      const when = at(s.booked - hours);
      events.push({
        id: `${index}-${i + 1}`,
        kind,
        via: kind === "cancel" && s.calendar ? "calendar" : via,
        at: when.toISOString(),
        atText: logTime(when),
        changes: changes ? describeChanges(changes, { before: s.place, after: s.place }) : [],
      });
    });
    const last = events[events.length - 1].kind;
    return {
      id: String(100 + index),
      place: s.place,
      placeName: placeName(s.place),
      room: logRoom(s.place, s.room),
      date: s.date,
      dateText: logDay(s.date),
      time: s.time ? rangeText({ start: s.time[0], end: s.time[1] }) : "",
      hn: displayHn(s.hn),
      patient: s.patient ?? "",
      diagnosis: s.diagnosis ?? "",
      operation: s.operation,
      dressing: s.dressing ?? false,
      note: s.note ?? "",
      doctorId: s.doctor[0],
      doctor: s.doctor[1],
      specialty: s.doctor[2],
      via,
      bookedAt: events[0].at,
      bookedAtText: events[0].atText,
      cancelled: last === "cancel",
      events,
    };
  });
}

/** The booking log with invented bookings, in development only: /preview/admin/bookings (?empty=1, ?failed=1). */
export default async function PreviewBookingLog({ searchParams }: { searchParams: Promise<{ empty?: string; failed?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const entries = params.failed ? null : params.empty ? [] : sampleEntries(Date.parse("2026-11-28T08:00:00Z"));
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="ประวัติการจอง" name="ประเสริฐ กล้าหาญ" boardHref="/preview?admin=1" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-5xl">
          <BookingLog entries={entries} truncated={false} />
        </div>
      </main>
    </div>
  );
}
