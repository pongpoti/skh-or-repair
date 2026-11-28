"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { countEntries, KIND_LABELS, type LogEntry, type LogEvent, type LogKind } from "@/lib/booking-log";
import { specialtyOf } from "@/lib/specialties";
import { searchKey } from "@/lib/user-labels";

/**
 * The admin's booking log (Pong, 28 Nov 2026: "Create logged booking cases dashboard, opened from admin profile"): the
 * counts of the bookings the filters pick out (each a button that filters by itself), the filters, and either the
 * bookings, the latest made first, each opening to its history, or every change as it happened. Read only. Everything
 * is filtered here in the browser from what the server sent (lib/booking-log-store.ts), so the filters answer at once.
 */

type Status = "all" | "booked" | "cancelled" | "changed" | "calendar";
type Period = "all" | "today" | "7" | "30";
type View = "bookings" | "events";
type Sort = "booked" | "date";

const PAGE = 50;

const BADGE: Record<LogKind, string> = {
  book: "badge-success",
  edit: "badge-warning",
  move: "badge-warning",
  cancel: "badge-stop",
  restore: "badge-success",
};

const CHEVRON = (
  <svg className="log-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const SEARCH_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4.2-4.2" />
  </svg>
);

/** Midnight today in Thailand, as a time, for the period filter. */
function bangkokMidnight(now: number): number {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Date.parse(`${day}T00:00:00+07:00`);
}

/** The earliest time the period lets through, or null for all. */
function periodStart(period: Period, now: number): number | null {
  if (period === "all") return null;
  const midnight = bangkokMidnight(now);
  return period === "today" ? midnight : midnight - (Number(period) - 1) * 86_400_000;
}

function matchesStatus(entry: LogEntry, status: Status): boolean {
  switch (status) {
    case "booked":
      return !entry.cancelled;
    case "cancelled":
      return entry.cancelled;
    case "changed":
      return entry.events.some((e) => e.kind === "edit" || e.kind === "move");
    case "calendar":
      return entry.via === "calendar";
    default:
      return true;
  }
}

function SpecialtyTag({ code }: { code: string }) {
  const specialty = specialtyOf(code);
  if (!specialty) return null;
  return (
    <span
      className="chip min-h-0 shrink-0 px-2 py-0 text-[0.6875rem] leading-5 tracking-[0.02em]"
      style={{ "--chip": specialty.color, color: specialty.text } as CSSProperties}
    >
      {specialty.label}
    </span>
  );
}

function CalendarTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md border border-[rgb(31_90_138/0.28)] bg-[#e4eef7] px-1.5 text-[0.6875rem] leading-5 font-semibold text-[#1f5a8a]">
      ปฏิทิน
    </span>
  );
}

/** Where and when: "สมุทรสาคร · OR 5 · จ. 30 พ.ย. 69 · 08:30–09:30". */
function Where({ entry }: { entry: LogEntry }) {
  return (
    <span className="min-w-0 text-sm font-semibold text-ink tabular-nums">
      {entry.placeName} · {entry.room}
      {entry.dressing ? " (ห้องทำแผล)" : ""} · {entry.dateText}
      {entry.time ? ` · ${entry.time}` : ""}
    </span>
  );
}

function Changes({ event }: { event: LogEvent }) {
  if (!event.changes.length) {
    return event.kind === "edit" || event.kind === "move" ? <p className="text-xs text-muted">ไม่มีรายละเอียด (ก่อนเริ่มเก็บประวัติ)</p> : null;
  }
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-[0.8125rem] leading-5 text-ink-2">
      {event.changes.map((change) => (
        <li key={change.label} className="break-words">
          <span className="font-semibold text-ink">{change.label}</span> {change.before} <span aria-label="เป็น">→</span>{" "}
          <span className="font-semibold text-ink">{change.after}</span>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ events }: { events: readonly LogEvent[] }) {
  return (
    <ol className="flex flex-col gap-3 border-l-2 border-line pl-4" data-testid="log-timeline">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span className="absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full border-2 border-surface bg-line-strong" aria-hidden />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`badge ${BADGE[event.kind]}`}>{KIND_LABELS[event.kind]}</span>
            <span className="text-xs text-ink-2 tabular-nums">{event.atText}</span>
            {event.via === "calendar" ? <CalendarTag /> : null}
          </div>
          <Changes event={event} />
        </li>
      ))}
    </ol>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm break-words text-ink">{value}</dd>
    </div>
  );
}

function BookingRow({ entry }: { entry: LogEntry }) {
  const changes = entry.events.filter((e) => e.kind === "edit" || e.kind === "move").length;
  return (
    <li>
      <details className="log-row group" data-testid="log-booking">
        <summary className="flex cursor-pointer list-none items-start gap-3 rounded-xl p-3 sm:p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`badge ${entry.cancelled ? "badge-stop" : "badge-success"}`}>{entry.cancelled ? "ยกเลิก" : "จองอยู่"}</span>
              <Where entry={entry} />
            </div>
            <p className="mt-1 truncate text-[0.9375rem] font-semibold text-ink">{entry.operation || "ไม่ระบุการผ่าตัด"}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
              {entry.hn ? <span className="tabular-nums">HN {entry.hn}</span> : null}
              {entry.patient ? <span className="min-w-0 truncate">{entry.patient}</span> : null}
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="truncate">{entry.doctor}</span>
                <SpecialtyTag code={entry.specialty} />
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="tabular-nums">จองเมื่อ {entry.bookedAtText}</span>
              {entry.via === "calendar" ? <CalendarTag /> : null}
              {changes ? <span className="font-semibold text-[var(--late)]">แก้ไข {changes} ครั้ง</span> : null}
            </div>
          </div>
          <span className="mt-0.5 shrink-0 text-muted">{CHEVRON}</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line px-3 pt-3 pb-4 sm:px-4">
          {entry.diagnosis || entry.note ? (
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Detail label="การวินิจฉัย" value={entry.diagnosis} />
              <Detail label="หมายเหตุ" value={entry.note} />
            </dl>
          ) : null}
          <Timeline events={entry.events} />
        </div>
      </details>
    </li>
  );
}

function EventRow({ entry, event }: { entry: LogEntry; event: LogEvent }) {
  return (
    <li className="flex flex-col gap-1 p-3 sm:flex-row sm:gap-4 sm:p-4" data-testid="log-event">
      <div className="flex shrink-0 items-center gap-2 sm:w-44 sm:flex-col sm:items-start sm:gap-1">
        <span className={`badge ${BADGE[event.kind]}`}>{KIND_LABELS[event.kind]}</span>
        <span className="text-xs text-ink-2 tabular-nums">{event.atText}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Where entry={entry} />
          {event.via === "calendar" ? <CalendarTag /> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          {entry.hn ? <span className="tabular-nums">HN {entry.hn}</span> : null}
          <span className="min-w-0 truncate">{entry.operation || "ไม่ระบุการผ่าตัด"}</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate">{entry.doctor}</span>
            <SpecialtyTag code={entry.specialty} />
          </span>
        </div>
        <Changes event={event} />
      </div>
    </li>
  );
}

const TILES: ReadonlyArray<{ status: Status; label: string; key: keyof ReturnType<typeof countEntries> }> = [
  { status: "all", label: "การจองทั้งหมด", key: "all" },
  { status: "booked", label: "จองอยู่", key: "booked" },
  { status: "cancelled", label: "ยกเลิก", key: "cancelled" },
  { status: "changed", label: "มีแก้ไข/ย้าย", key: "changed" },
  { status: "calendar", label: "จากปฏิทิน", key: "calendar" },
];

const SEGMENT =
  "flex min-h-11 flex-1 items-center justify-center rounded-[9px] px-3 text-sm font-semibold text-ink-2 transition-colors aria-pressed:bg-white aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_rgb(41_29_20/0.12)]";

export function BookingLog({ entries, truncated }: { entries: readonly LogEntry[] | null; truncated: boolean }) {
  const [status, setStatus] = useState<Status>("all");
  const [place, setPlace] = useState("");
  const [doctor, setDoctor] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("bookings");
  const [sort, setSort] = useState<Sort>("booked");
  const [shown, setShown] = useState(PAGE);
  // Set when a period is picked (never on the server's render), so the page and its first render agree.
  const [now, setNow] = useState(0);

  const list = useMemo(() => entries ?? [], [entries]);

  const doctors = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of list) map.set(entry.doctorId, entry.doctor);
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "th"));
  }, [list]);

  /** The bookings the hospital, doctor and search pick out, before the status and the period. */
  const base = useMemo(() => {
    const needle = searchKey(query);
    return list.filter(
      (entry) =>
        (!place || entry.place === place) &&
        (!doctor || entry.doctorId === doctor) &&
        (!needle ||
          [entry.hn, entry.hn.replace(/^0+/, ""), entry.patient, entry.operation, entry.diagnosis, entry.doctor, entry.note].some((v) =>
            searchKey(v).includes(needle),
          )),
    );
  }, [list, place, doctor, query]);

  const from = periodStart(period, now);
  const inPeriod = useMemo(() => (from === null ? base : base.filter((e) => Date.parse(e.bookedAt) >= from)), [base, from]);
  const counts = useMemo(() => countEntries(inPeriod), [inPeriod]);

  const bookings = useMemo(() => {
    const picked = inPeriod.filter((entry) => matchesStatus(entry, status));
    if (sort === "date") return [...picked].sort((a, b) => b.date.localeCompare(a.date) || b.bookedAt.localeCompare(a.bookedAt));
    return picked;
  }, [inPeriod, status, sort]);

  /** Every change of the bookings picked out (whatever their own booking time), the latest first. */
  const events = useMemo(() => {
    const out: Array<{ entry: LogEntry; event: LogEvent }> = [];
    for (const entry of base) {
      if (!matchesStatus(entry, status)) continue;
      for (const event of entry.events) if (from === null || Date.parse(event.at) >= from) out.push({ entry, event });
    }
    return out.sort((a, b) => b.event.at.localeCompare(a.event.at) || Number(b.event.id) - Number(a.event.id));
  }, [base, status, from]);

  const total = view === "bookings" ? bookings.length : events.length;
  const reset = () => setShown(PAGE);

  if (entries === null) {
    return (
      <p className="notice notice-warning" role="alert">
        อ่านประวัติการจองไม่ได้ ลองใหม่อีกครั้ง
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3" role="group" aria-label="สรุป">
        {TILES.map((tile) => (
          <button
            key={tile.status}
            type="button"
            aria-pressed={status === tile.status}
            onClick={() => {
              setStatus(tile.status);
              reset();
            }}
            className="log-tile"
            data-testid={`log-tile-${tile.status}`}
          >
            <span className="text-xl leading-7 font-bold text-ink tabular-nums sm:text-2xl sm:leading-8">{counts[tile.key].toLocaleString("th-TH")}</span>
            <span className="text-xs leading-4 font-semibold text-ink-2">{tile.label}</span>
          </button>
        ))}
      </div>

      <section className="card flex flex-col gap-3 p-3 sm:p-4" aria-label="ตัวกรอง">
        <label className="relative block">
          <span className="sr-only">ค้นหา</span>
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted">{SEARCH_ICON}</span>
          <input
            type="search"
            className="field field-text pl-10"
            placeholder="ค้นหา HN ชื่อผู้ป่วย การผ่าตัด แพทย์"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
            data-testid="log-search"
          />
        </label>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-2">โรงพยาบาล</span>
            <select className="field min-w-0 text-[0.9375rem]" value={place} onChange={(e) => (setPlace(e.target.value), reset())} data-testid="log-place">
              <option value="">ทั้งหมด</option>
              <option value="skh">สมุทรสาคร</option>
              <option value="tha-chalom">ท่าฉลอม</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-2">แพทย์</span>
            <select className="field min-w-0 text-[0.9375rem]" value={doctor} onChange={(e) => (setDoctor(e.target.value), reset())} data-testid="log-doctor">
              <option value="">ทุกคน</option>
              {doctors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-2">{view === "bookings" ? "จองเมื่อ" : "เมื่อ"}</span>
            <select
              className="field min-w-0 text-[0.9375rem]"
              value={period}
              onChange={(e) => {
                setNow(Date.now());
                setPeriod(e.target.value as Period);
                reset();
              }}
              data-testid="log-period"
            >
              <option value="all">ทั้งหมด</option>
              <option value="today">วันนี้</option>
              <option value="7">7 วันล่าสุด</option>
              <option value="30">30 วันล่าสุด</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-2">เรียงตาม</span>
            <select
              className="field min-w-0 text-[0.9375rem]"
              value={sort}
              disabled={view === "events"}
              onChange={(e) => (setSort(e.target.value as Sort), reset())}
              data-testid="log-sort"
            >
              <option value="booked">เวลาจอง</option>
              <option value="date">วันผ่าตัด</option>
            </select>
          </label>
        </div>
      </section>

      <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
        <div className="flex rounded-xl bg-[var(--tan-fill)] p-1 min-[480px]:w-80" role="group" aria-label="แสดง">
          <button type="button" className={SEGMENT} aria-pressed={view === "bookings"} onClick={() => (setView("bookings"), reset())} data-testid="log-view-bookings">
            การจอง
          </button>
          <button type="button" className={SEGMENT} aria-pressed={view === "events"} onClick={() => (setView("events"), reset())} data-testid="log-view-events">
            ความเคลื่อนไหว
          </button>
        </div>
        <p className="text-sm text-ink-2" data-testid="log-total" aria-live="polite">
          {total.toLocaleString("th-TH")} รายการ
        </p>
      </div>

      {total === 0 ? (
        <p className="card p-6 text-center text-sm text-ink-2" data-testid="log-empty">
          {list.length ? "ไม่พบรายการ" : "ยังไม่มีการจอง"}
        </p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line overflow-hidden">
          {view === "bookings"
            ? bookings.slice(0, shown).map((entry) => <BookingRow key={entry.id} entry={entry} />)
            : events.slice(0, shown).map(({ entry, event }) => <EventRow key={event.id} entry={entry} event={event} />)}
        </ul>
      )}
      {total > shown ? (
        <button type="button" className="btn btn-ghost self-center" onClick={() => setShown((n) => n + PAGE)} data-testid="log-more">
          ดูเพิ่ม ({(total - shown).toLocaleString("th-TH")})
        </button>
      ) : null}
      {truncated ? <p className="text-center text-xs text-muted">แสดงการจองล่าสุด {list.length.toLocaleString("th-TH")} รายการ</p> : null}
    </div>
  );
}
