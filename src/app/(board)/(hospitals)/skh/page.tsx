import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BoardRefresh } from "@/components/board-refresh";
import { SuiteBoard, type BoardView, type CaseAdding } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { addDays, bookAheadDays, firstBookingDay } from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requestPath, requireUser } from "@/lib/auth/server";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, pickedDay, pickRange, relationTo, type BoardDay } from "@/lib/board-day";
import { boardNotices, DEMO_NOTICE, everyNotice, SIM_NOTICE, type BoardNotice } from "@/lib/board-notices";
import { buildBoardRows } from "@/lib/board-rows";
import { doctorFor, listCasesBy, listCasesOn } from "@/lib/cases";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { demoBoardRows, demoDay } from "@/lib/demo-schedule";
import { holidaysBetween } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import { BOARD_PATH } from "@/lib/places";
import type { RepairPeriods } from "@/lib/repair";
import { currentRepairPeriods } from "@/lib/repair-store";
import { boardViewer } from "@/lib/roles";
import { simulatedBookings } from "@/lib/sim-bookings";
import type { SessionUser } from "@/lib/tokens";
import { TUTORIAL_COOKIE } from "@/lib/tutorial";
import { tutorialSeen } from "@/lib/tutorial-store";
import { unavailablePath } from "@/lib/unavailable";
import { fullName } from "@/lib/user-list";
import { workbookFor, workbookForDay } from "@/lib/workbook-store";
import { addCase, dayBookings, deleteCase, editCase, undoCancel } from "@/app/(board)/actions";

export const dynamic = "force-dynamic";

/**
 * The board's rows for its day: the cycle's latest HOSxP upload matched with the doctors' bookings
 * (lib/board-rows.ts), the add-case form for a doctor, and whether the viewer may upload. The HN is filtered here, on
 * the server: only the doctor who made a booking, MX and admins get it in the page at all. A database problem returns
 * null, and the page goes to the outage page (Pong, 17 Nov 2026; it used to leave the rooms empty). A day picked on the board (`picked`) shows the latest upload for that
 * day, whichever cycle made it (today's after 16:00, or none yet for a day further ahead).
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
      offBoard: built.offBoard,
    };
    let adding: CaseAdding | null = null;
    // A first visit goes to the tutorial, once: a doctor's (Pong, 19 Nov 2026), and RN's, PN's, PCA's and MX's (27 Nov
    // 2026: "Disable always-on", where it had opened on every app open). An admin who is not a doctor is never sent.
    // Someone not on the users list has nowhere to note it, so is not sent either; a failed read counts as seen.
    const seenBy = doctor ? String(doctor.id) : isAdmin(user.sub) ? null : viewer.userId;
    const seen = seenBy ? tutorialSeen(pool, seenBy) : Promise.resolve(true);
    if (doctor) {
      // The holidays over the days a doctor can book (60, a year for an admin), for the calendar: the same list the server action checks.
      const [mine, { holidays, unlisted }] = await Promise.all([
        // The doctor's own bookings, HN included: theirs to see.
        listCasesBy(pool, doctor.id, day.today),
        holidaysBetween(day.today, addDays(day.today, bookAheadDays(isAdmin(user.sub)))),
      ]);
      adding = {
        doctor: { name: fullName(doctor), subtype: doctor.subtype },
        today: day.today,
        // An admin books from today at any hour, a year ahead (Pong, 27 Nov 2026: "No restriction").
        earliest: firstBookingDay(isAdmin(user.sub), day.today, day.minutes, holidays),
        admin: isAdmin(user.sub),
        holidays,
        unlisted,
        mine,
        onAdd: addCase,
        onEdit: editCase,
        onRemove: deleteCase,
        onRestore: undoCancel,
        onDay: dayBookings,
      };
    }
    // The cookie the tutorial sets on a start or skip counts too: the row may not be written yet, or could not be.
    const tutorialDue = !(await seen) && (await cookies()).get(TUTORIAL_COOKIE)?.value !== seenBy;
    // MX and admins see every HN (lib/roles.ts), and they are the ones who upload.
    return { board, adding, canUpload: viewer.allHn, tutorialDue };
  } catch (error) {
    console.error("[board] cases unavailable:", (error as Error).message);
    return null;
  }
}

/**
 * The demo schedule's board (lib/demo-schedule.ts): made-up cases in every open room of the day, through the board's own
 * rules, seen as an admin sees a day (every HN). Nothing is read from or written to the database, and there is no
 * booking form, so a booking can never be made from made-up rows. Its badge comes first in the strip.
 */
function demoBoard(day: BoardDay, periods: RepairPeriods): { board: BoardView; notices: BoardNotice[] } {
  const built = demoBoardRows(day.boardDate, periods, { allHn: true, userId: null });
  const board: BoardView = {
    date: day.boardDate,
    rows: built.rows,
    uploaded: built.uploaded,
    mismatchCount: built.mismatchCount,
    mismatchByRoom: built.mismatchByRoom,
  };
  return { board, notices: [DEMO_NOTICE] };
}

/**
 * The simulated bookings' board (lib/sim-bookings.ts; Pong, 22 Nov 2026): the day's stored HOSxP list with bookings
 * made up from it, through the board's own rules, seen as an admin sees a day (every HN). The day's real bookings are
 * not read and nothing is written, and there is no booking form. Its badge comes first in the strip; a day with no list
 * has the no-upload badge after it. Null on a database problem, as loadBoard.
 */
async function simBoard(day: BoardDay, periods: RepairPeriods): Promise<{ board: BoardView; notices: BoardNotice[] } | null> {
  try {
    const workbook = await workbookForDay(await db(), day.boardDate);
    const cases = workbook?.cases ?? null;
    const bookings = cases ? simulatedBookings(cases, day.boardDate, periods) : [];
    const built = buildBoardRows({ date: day.boardDate, periods, workbook: cases, bookings, viewer: { allHn: true, userId: null } });
    const board: BoardView = {
      date: day.boardDate,
      rows: built.rows,
      uploaded: built.uploaded,
      mismatchCount: built.mismatchCount,
      mismatchByRoom: built.mismatchByRoom,
      offBoard: built.offBoard,
    };
    return { board, notices: [SIM_NOTICE, ...boardNotices({ missingUpload: cases ? null : day.boardDate, offBoard: built.offBoard })] };
  } catch (error) {
    console.error("[board] simulated bookings unavailable:", (error as Error).message);
    return null;
  }
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    room?: string;
    notices?: string;
    demo?: string | string[];
    sim?: string | string[];
    half?: string | string[];
    date?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  // Every time decision goes through the app's clock (lib/clock.ts), so the tests can set it.
  const at = now();
  // The full name of the user the number (or the doctor's email sign-in) has claimed, read on every request (a corrected
  // name shows without signing out).
  const [profile, day, periods] = await Promise.all([
    profileFor(user, user.name),
    // The day the board shows: today until 16:00, then the next workday, skipping weekends and Thai holidays.
    loadBoardDay(at),
    // The repair's dates as an admin set them, read on every request so a change shows at once.
    currentRepairPeriods(),
  ]);
  // The days the date picker offers (1 Jan 2026, the first half's first day, to the repair's last day), with the
  // holidays it closes: the address of a picked day is checked against them.
  const range = pickRange(day.today, periods);
  const { holidays: closed, unlisted } = await holidaysBetween(range.min, range.max);
  // Another day picked on the board (?date=YYYY-MM-DD, Pong, 15 Nov 2026), when it is one the picker offers; else the
  // board's own day. Picking the board's own day is the same as picking none.
  const picked = pickedDay(params.date, day.today, periods, closed);
  const admin = isAdmin(user.sub);
  // /admin opens the demo schedule for a half (?half=1 or 2): it goes on as the day of that half the board shows, so the
  // address holds only the day from then on, and the date picker moves between days of the demo as on the board.
  if (params.demo === "1" && admin && (params.half === "1" || params.half === "2")) {
    const shown = demoDay(params.half === "1" ? 1 : 2, { today: day.today, boardDate: day.boardDate, max: range.max, periods, holidays: closed });
    // A half with no day left (over, or only a weekend or holidays to go) goes back to /admin, where its button now
    // says so by the same rule, rather than to a day of the other half.
    redirect(!shown ? "/admin" : shown !== day.boardDate ? `${BOARD_PATH}?demo=1&date=${shown}` : `${BOARD_PATH}?demo=1`);
  }
  const view: BoardDay =
    picked && picked !== day.boardDate ? { ...day, boardDate: picked, relation: relationTo(picked, day.today) } : day;
  // The demo schedule, for admins only (Pong, 15 Nov 2026): /?demo=1 fills every room of the day shown with made-up
  // cases (/admin opens it on a day of either half; the date picker keeps it on). Anyone else gets the real board.
  // The simulated bookings, for admins only (Pong, 22 Nov 2026): /?sim=1 shows the day's real HOSxP list with bookings
  // made up from it (/admin opens it on 1 Oct 2026; the date picker and the swipe keep it on).
  const demoOn = params.demo === "1" && admin;
  const simOn = !demoOn && params.sim === "1" && admin;
  const demo = demoOn ? demoBoard(view, periods) : simOn ? await simBoard(view, periods) : null;
  const loaded =
    demoOn || simOn ? demo && { board: demo.board, adding: null, canUpload: true, tutorialDue: false } : await loadBoard(user, view, periods, view !== day);
  // Outside the try of loadBoard: redirect() works by throwing.
  if (!loaded) redirect(unavailablePath("server", await requestPath()));
  // Someone who has not seen the tutorial yet starts there, once (components/tutorial.tsx): starting or skipping it
  // notes it seen.
  if (loaded.tutorialDue) redirect("/tutorial?first=1");
  const { board, adding, canUpload } = loaded;
  // Test mode, for admins only (Pong, 15 Nov 2026): /?notices=all puts every kind of notice in the strip at once, to see
  // how they look together. Anyone else gets the board's own notices; the rooms and bookings are the real ones.
  // The demo's own badge stays first whatever else the strip shows, so made-up cases are never taken for real ones.
  const allNotices = params.notices === "all" && admin ? everyNotice(view.boardDate) : null;
  const testNotices = demo ? [demo.notices[0], ...(allNotices ?? demo.notices.slice(1))] : (allNotices ?? undefined);
  // The days the top bar's calendar offers, which a swipe across the plan moves between too.
  const datePick = { today: day.today, current: day.boardDate, ...range, holidays: closed, unlisted };

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
        adminHref={admin ? "/admin" : null}
        uploadHref={canUpload ? "/upload" : null}
        // The doctors' tutorial (Pong, 19 Nov 2026), and the staff's for everyone else (Pong, 27 Nov 2026).
        helpHref="/tutorial"
        datePick={datePick}
        // One tap to รพ.ท่าฉลอม's board on the same day (Pong, 26 Nov 2026: "seamless navigation between 2 places").
        place={{ current: "skh" }}
      />
      <SuiteBoard
        board={board}
        today={day.today}
        periods={periods}
        roomId={params.room ?? null}
        adding={adding}
        notices={testNotices}
        swipe={datePick}
      />
    </div>
  );
}
