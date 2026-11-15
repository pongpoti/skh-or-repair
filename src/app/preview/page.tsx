import { notFound } from "next/navigation";
import { BoardRefresh } from "@/components/board-refresh";
import { SuiteBoard, type BoardView } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, type BoardDay } from "@/lib/board-day";
import { buildBoardRows } from "@/lib/board-rows";
import { addDays, parseDay, todayIso, weekDates } from "@/lib/days";
import { currentRepairPeriods } from "@/lib/repair-store";
import { SAMPLE_DOCTOR_ID, sampleCases } from "./sample";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

/** The board's day for a date given outright: that date is today and the board's day. */
function fixedDay(date: string): BoardDay {
  return { today: date, minutes: 9 * 60, cycleDay: addDays(date, -1), boardDate: date, relation: "today" };
}

/**
 * The board without signing in, in development only. With no parameters it shows the day the board shows now (the
 * 16:00 turnover, holidays from the BOT feed when a token is set).
 *
 * - ?date=2026-12-14 shows the board as on that date (e.g. the repair's second half); ?day=tue the Tuesday of this week.
 * - ?at=2026-11-16T16:30+07:00 shows the board's day at that moment (after 16:00: the next workday).
 * - ?holiday=วันปิยมหาราช shows the closed day.
 * - ?sample=1 adds made-up HOSxP cases and bookings (preview/sample.ts) to see the source chips, flags and room marks;
 *   with ?upload=0 the bookings alone, as before MX uploads.
 * - ?mx=1 shows the board as MX sees it (every HN, the upload button); otherwise as the sample's doctor, who sees the
 *   HN of their own bookings. ?admin=1 adds the admin button.
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
  }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const weekday = parseDay(params.day);
  const date =
    params.date && ISO_DATE.test(params.date) ? params.date : weekday !== null ? weekDates(todayIso())[weekday] : null;
  const at = params.at && ISO_TIME.test(params.at) ? new Date(params.at) : new Date();
  const [day, periods] = await Promise.all([
    date ? fixedDay(date) : loadBoardDay(at),
    // The repair's dates from the database, or the planned ones when there is none.
    currentRepairPeriods(),
  ]);
  const holiday = params.holiday?.trim() || null;

  const sample = params.sample ? sampleCases(day.boardDate, periods) : { workbook: [], bookings: [] };
  const built = buildBoardRows({
    date: day.boardDate,
    periods,
    workbook: params.sample && params.upload !== "0" ? sample.workbook : null,
    bookings: sample.bookings,
    viewer: { allHn: Boolean(params.mx), userId: params.mx ? null : SAMPLE_DOCTOR_ID },
  });
  const board: BoardView | null = holiday
    ? null
    : { date: day.boardDate, rows: built.rows, uploaded: built.uploaded, mismatchCount: built.mismatchCount, mismatchByRoom: built.mismatchByRoom };

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
        holiday={holiday}
        roomId={params.room ?? null}
        pathname="/preview"
      />
    </div>
  );
}
