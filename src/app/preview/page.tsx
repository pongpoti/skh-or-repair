import { notFound } from "next/navigation";
import { BoardRefresh } from "@/components/board-refresh";
import { SuiteBoard, type BoardView, type CaseAdding } from "@/components/suite-board";
import { BOOK_AHEAD_DAYS, earliestBookingDay } from "@/lib/added-cases";
import { TopBar } from "@/components/top-bar";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, pickRange, type BoardDay } from "@/lib/board-day";
import { everyNotice } from "@/lib/board-notices";
import { buildBoardRows } from "@/lib/board-rows";
import { demoBoardRows } from "@/lib/demo-schedule";
import { addDays, parseDay, todayIso, weekDates } from "@/lib/days";
import { holidaysBetween } from "@/lib/holidays";
import { currentRepairPeriods } from "@/lib/repair-store";
import { previewAddCase, previewMine, previewRemoveCase } from "./actions";
import { SAMPLE_DOCTOR_ID, sampleCases } from "./sample";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The board's day for a date given outright: that date is today and the board's day, at 09:00 or `time`. */
function fixedDay(date: string, time: string | undefined): BoardDay {
  const clock = time ? CLOCK.exec(time) : null;
  const minutes = clock ? Number(clock[1]) * 60 + Number(clock[2]) : 9 * 60;
  return { today: date, minutes, cycleDay: addDays(date, -1), boardDate: date, relation: "today" };
}

/**
 * The board without signing in, in development only. With no parameters it shows the day the board shows now (the
 * 16:00 turnover, holidays from the BOT feed when a token is set).
 *
 * - ?date=2026-12-14 shows the board as on that date (e.g. the repair's second half); ?day=tue the Tuesday of this week.
 *   A sideways swipe across the plan moves ?date= to the workday before or after.
 * - ?at=2026-11-16T16:30+07:00 shows the board's day at that moment (after 16:00: the next workday).
 * - ?holiday=วันปิยมหาราช shows the closed day (no badge in the strip since 16 Nov 2026).
 * - ?sample=1 adds made-up HOSxP cases and bookings (preview/sample.ts) to see the row icons, flags and room marks;
 *   with ?upload=0 the bookings alone, as before MX uploads.
 * - ?demo=1 fills every open room with the admin's demo schedule (lib/demo-schedule.ts, ten or more made-up cases a
 *   room), as an admin sees it: a long list for the room's sheet and its full screen card.
 * - ?mx=1 shows the board as MX sees it (every HN, the upload button); otherwise as the sample's doctor, who sees the
 *   HN of their own bookings. ?admin=1 adds the admin button.
 * - ?failed=1 shows the board as when its cases cannot be read (no badge since 16 Nov 2026); ?notices=all puts every
 *   kind of notice in the strip, now the one ยังไม่มีตาราง HOSxP badge.
 * - ?book=1 adds the booking form as the sample doctor of ?dept= (a department code, GENSX unless given) sees it;
 *   ?time=15:30 with ?date= sets the clock that picks the first day that can be booked. Bookings stay in memory.
 */
export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    room?: string;
    day?: string;
    date?: string;
    at?: string;
    holiday?: string;
    admin?: string;
    mx?: string;
    sample?: string;
    upload?: string;
    failed?: string;
    notices?: string;
    book?: string;
    dept?: string;
    time?: string;
    demo?: string;
  }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const weekday = parseDay(params.day);
  const date =
    params.date && ISO_DATE.test(params.date) ? params.date : weekday !== null ? weekDates(todayIso())[weekday] : null;
  const at = params.at && ISO_TIME.test(params.at) ? new Date(params.at) : new Date();
  const [day, periods] = await Promise.all([
    date ? fixedDay(date, params.time) : loadBoardDay(at),
    // The repair's dates from the database, or the planned ones when there is none.
    currentRepairPeriods(),
  ]);
  const holiday = params.holiday?.trim() || null;

  const sample = params.sample ? sampleCases(day.boardDate, periods) : { workbook: [], bookings: [] };
  const built = params.demo
    ? demoBoardRows(day.boardDate, periods, { allHn: true, userId: null })
    : buildBoardRows({
        date: day.boardDate,
        periods,
        workbook: params.sample && params.upload !== "0" ? sample.workbook : null,
        bookings: sample.bookings,
        viewer: { allHn: Boolean(params.mx), userId: params.mx ? null : SAMPLE_DOCTOR_ID },
      });
  const board: BoardView | null = holiday
    ? null
    : { date: day.boardDate, rows: built.rows, uploaded: built.uploaded, mismatchCount: built.mismatchCount, mismatchByRoom: built.mismatchByRoom };

  let adding: CaseAdding | null = null;
  if (params.book) {
    const { holidays, unlisted } = await holidaysBetween(day.today, addDays(day.today, BOOK_AHEAD_DAYS));
    const name = "ตัวอย่าง หนึ่ง";
    const subtype = params.dept?.trim() || "GENSX";
    const earliest = earliestBookingDay(day.today, day.minutes, holidays);
    adding = {
      doctor: { name, subtype },
      today: day.today,
      earliest,
      holidays,
      unlisted,
      mine: await previewMine(),
      onAdd: previewAddCase.bind(null, { today: day.today, earliest, periods, subtype, holidays, name }),
      onRemove: previewRemoveCase,
    };
  }

  // A swipe across the plan moves ?date= to the workday before or after. The preview's date is its "today", so the
  // address always keeps it (no board's own day to drop it for).
  const range = pickRange(day.today, periods);
  const { holidays: closed, unlisted } = await holidaysBetween(range.min, range.max);
  const swipe = { today: day.today, current: "", ...range, holidays: closed, unlisted };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {date ? null : <BoardRefresh renderId={crypto.randomUUID()} delayMs={nextBoardRefresh(at).getTime() - at.getTime()} />}
      <TopBar
        date={day.boardDate}
        eyebrow={boardEyebrow(day.relation)}
        name="สมหญิง ไลน์"
        pathname="/preview"
        showAccount={false}
        // ?admin=1 shows the bar as an admin sees it.
        adminHref={params.admin ? "/preview/admin" : null}
        uploadHref={params.mx || params.admin ? "/upload" : null}
      />
      <SuiteBoard
        board={board}
        today={day.today}
        periods={periods}
        roomId={params.room ?? null}
        pathname="/preview"
        casesUnavailable={Boolean(params.failed)}
        adding={adding}
        notices={params.notices === "all" ? everyNotice(day.boardDate) : undefined}
        swipe={swipe}
      />
    </div>
  );
}
