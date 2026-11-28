import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BoardRefresh } from "@/components/board-refresh";
import { SuiteBoard, type BoardView, type CaseAdding } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { addDays, bookAheadDays, booksOffDays, firstBookingDay, firstOffDay, isOffDay } from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requestPath, requireUser } from "@/lib/auth/server";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, pickedDay, pickRange, relationTo, type BoardDay } from "@/lib/board-day";
import { buildBoardRows } from "@/lib/board-rows";
import { bookedDaysBetween, doctorFor, listCasesBy, listCasesOn } from "@/lib/cases";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import type { RepairPeriods } from "@/lib/repair";
import { currentRepairPeriods } from "@/lib/repair-store";
import { boardViewer } from "@/lib/roles";
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
        // CVT and admins book Sundays and holidays too, in OR 13 (Pong, 28 Nov 2026).
        offFrom: booksOffDays(doctor.subtype, "skh", isAdmin(user.sub)) ? firstOffDay(isAdmin(user.sub), day.today, day.minutes) : null,
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

/** The days that hold a booking at รพ.สมุทรสาคร from `from` to `to`; none when the database cannot say (the board then fails on its own read). */
async function bookedDays(from: string, to: string): Promise<string[]> {
  try {
    return await bookedDaysBetween(await db(), from, to, "skh");
  } catch (error) {
    console.error("[board] booked days unavailable:", (error as Error).message);
    return [];
  }
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    room?: string;
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
  const [{ holidays: closed, unlisted }, booked] = await Promise.all([holidaysBetween(range.min, range.max), bookedDays(range.min, range.max)]);
  // The Sundays and holidays CVT booked (OR 13, Pong, 28 Nov 2026): the picker offers them too.
  const openDays = booked.filter((iso) => isOffDay(iso, closed));
  // Another day picked on the board (?date=YYYY-MM-DD, Pong, 15 Nov 2026), when it is one the picker offers; else the
  // board's own day. Picking the board's own day is the same as picking none.
  const picked = pickedDay(params.date, day.today, periods, closed, openDays);
  const admin = isAdmin(user.sub);
  const view: BoardDay =
    picked && picked !== day.boardDate ? { ...day, boardDate: picked, relation: relationTo(picked, day.today) } : day;
  // The admin's demo schedule (?demo=1), simulated bookings (?sim=1) and test notices (?notices=all) went on 28 Nov 2026
  // (Pong: "On admin setting: remove ตารางตัวอย่าง การจองจำลอง and โหมดทดสอบ"): such an address shows the real board.
  const loaded = await loadBoard(user, view, periods, view !== day);
  // Outside the try of loadBoard: redirect() works by throwing.
  if (!loaded) redirect(unavailablePath("server", await requestPath()));
  // Someone who has not seen the tutorial yet starts there, once (components/tutorial.tsx): starting or skipping it
  // notes it seen.
  if (loaded.tutorialDue) redirect("/tutorial?first=1");
  const { board, adding, canUpload } = loaded;
  // The days the top bar's calendar offers, which a swipe across the plan moves between too.
  const datePick = { today: day.today, current: day.boardDate, ...range, holidays: closed, unlisted, openDays };

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
        // The booking log, for admins only (Pong, 28 Nov 2026: "logged booking cases dashboard, opened from admin profile").
        logHref={admin ? "/admin/bookings" : null}
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
        swipe={datePick}
      />
    </div>
  );
}
