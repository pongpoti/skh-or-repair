import { BoardRefresh } from "@/components/board-refresh";
import { SuiteBoard, type BoardView, type CaseAdding } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { addDays, BOOK_AHEAD_DAYS, earliestBookingDay } from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, pickedDay, pickRange, relationTo, type BoardDay } from "@/lib/board-day";
import { everyNotice } from "@/lib/board-notices";
import { buildBoardRows } from "@/lib/board-rows";
import { doctorFor, listCasesBy, listCasesOn } from "@/lib/cases";
import { now } from "@/lib/clock";
import { bangkokParts } from "@/lib/days";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import type { RepairPeriods } from "@/lib/repair";
import { currentRepairPeriods } from "@/lib/repair-store";
import { boardViewer } from "@/lib/roles";
import type { SessionUser } from "@/lib/tokens";
import { fullName } from "@/lib/user-list";
import { workbookFor, workbookForDay } from "@/lib/workbook-store";
import { addCase, deleteCase } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The board's rows for its day: the cycle's latest HOSxP upload matched with the doctors' bookings
 * (lib/board-rows.ts), the add-case form for a doctor, and whether the viewer may upload. The HN is filtered here, on
 * the server: only the doctor who made a booking, MX and admins get it in the page at all. A database problem leaves
 * the rooms empty with a notice and hides the form. A day picked on the board (`picked`) shows the latest upload for that
 * day, whichever cycle made it (a past day's list as it last was, or none yet for a day further ahead).
 */
async function loadBoard(user: SessionUser, day: BoardDay, periods: RepairPeriods, picked: boolean) {
  try {
    const pool = await db();
    const [doctor, bookings, workbook, viewer] = await Promise.all([
      doctorFor(pool, user),
      listCasesOn(pool, day.boardDate),
      picked ? workbookForDay(pool, day.boardDate) : workbookFor(pool, day.cycleDay, day.boardDate),
      boardViewer(pool, user),
    ]);
    const built = buildBoardRows({ date: day.boardDate, periods, workbook: workbook?.cases ?? null, bookings, viewer });
    const board: BoardView = {
      date: day.boardDate,
      rows: built.rows,
      uploaded: built.uploaded,
      mismatchCount: built.mismatchCount,
      mismatchByRoom: built.mismatchByRoom,
    };
    let adding: CaseAdding | null = null;
    if (doctor) {
      // The holidays over the 60 days a doctor can book, for the calendar: the same list the server action checks.
      const [mine, { holidays }] = await Promise.all([
        // The doctor's own bookings, HN included: theirs to see.
        listCasesBy(pool, doctor.id, day.today),
        holidaysBetween(day.today, addDays(day.today, BOOK_AHEAD_DAYS)),
      ]);
      adding = {
        doctor: { name: fullName(doctor), subtype: doctor.subtype },
        today: day.today,
        earliest: earliestBookingDay(day.today, day.minutes, holidays),
        holidays,
        mine,
        onAdd: addCase,
        onRemove: deleteCase,
      };
    }
    // MX and admins see every HN (lib/roles.ts), and they are the ones who upload.
    return { board, adding, canUpload: viewer.allHn, failed: false };
  } catch (error) {
    console.error("[board] cases unavailable:", (error as Error).message);
    const board: BoardView = { date: day.boardDate, rows: [], uploaded: false, mismatchCount: 0, mismatchByRoom: {} };
    return { board, adding: null, canUpload: isAdmin(user.sub), failed: true };
  }
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; notices?: string; date?: string | string[] }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  // Every time decision goes through the app's clock (lib/clock.ts), so the tests can set it.
  const at = now();
  // The full name of the user the number (or the doctor's email sign-in) has claimed, read on every request (a corrected
  // name shows without signing out).
  const range = pickRange(bangkokParts(at).date);
  const [profile, day, periods, { holidays: closed }] = await Promise.all([
    profileFor(user, user.name),
    // The day the board shows: today until 16:00, then the next workday, skipping weekends and Thai holidays.
    loadBoardDay(at),
    // The repair's dates as an admin set them, read on every request so a change shows at once.
    currentRepairPeriods(),
    // The holidays the date picker closes, as the address of a picked day is checked against them.
    holidaysBetween(range.min, range.max),
  ]);
  // Another day picked on the board (?date=YYYY-MM-DD, Pong, 15 Nov 2026), when it is one the picker offers; else the
  // board's own day. Picking the board's own day is the same as picking none.
  const picked = pickedDay(params.date, day.today, closed);
  const view: BoardDay =
    picked && picked !== day.boardDate ? { ...day, boardDate: picked, relation: relationTo(picked, day.today) } : day;
  const { board, adding, canUpload, failed } = await loadBoard(user, view, periods, view !== day);
  // Test mode, for admins only (Pong, 15 Nov 2026): /?notices=all puts every kind of notice in the strip at once, to see
  // how they look together. Anyone else gets the board's own notices; the rooms and bookings are the real ones.
  const testNotices = params.notices === "all" && isAdmin(user.sub) ? everyNotice(view.boardDate) : undefined;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* At 16:00 and at midnight the board changes by itself; the delay is by the server's clock, and the id is this
          render's, so a board brought back by Back keeps counting from when it was first seen. */}
      <BoardRefresh renderId={crypto.randomUUID()} delayMs={nextBoardRefresh(at).getTime() - at.getTime()} />
      <TopBar
        date={view.boardDate}
        eyebrow={boardEyebrow(view.relation)}
        name={profile.name}
        role={profile.role}
        phone={user.phone ? formatPhone(user.phone) : undefined}
        image={user.picture}
        // Admins are listed by LINE user id (AUTH_ADMIN_LINE_IDS), the session's sub.
        adminHref={isAdmin(user.sub) ? "/admin" : null}
        uploadHref={canUpload ? "/upload" : null}
        datePick={{ today: day.today, current: day.boardDate, ...range, holidays: closed }}
      />
      <SuiteBoard
        board={board}
        today={day.today}
        periods={periods}
        roomId={params.room ?? null}
        adding={adding}
        casesUnavailable={failed}
        notices={testNotices}
      />
    </div>
  );
}
