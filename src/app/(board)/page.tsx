import { BoardRefresh } from "@/components/board-refresh";
import { SuiteBoard, type BoardView, type CaseAdding } from "@/components/suite-board";
import { TopBar } from "@/components/top-bar";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, type BoardDay } from "@/lib/board-day";
import { buildBoardRows } from "@/lib/board-rows";
import { doctorFor, listCasesBy, listCasesOn } from "@/lib/cases";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import type { RepairPeriods } from "@/lib/repair";
import { currentRepairPeriods } from "@/lib/repair-store";
import { boardViewer } from "@/lib/roles";
import type { SessionUser } from "@/lib/tokens";
import { fullName } from "@/lib/user-list";
import { workbookFor } from "@/lib/workbook-store";
import { addCase, deleteCase } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The board's rows for its day: the cycle's latest HOSxP upload matched with the doctors' bookings
 * (lib/board-rows.ts), the add-case form for a doctor, and whether the viewer may upload. The HN is filtered here, on
 * the server: only the doctor who made a booking, MX and admins get it in the page at all. A database problem leaves
 * the rooms empty with a notice and hides the form.
 */
async function loadBoard(user: SessionUser, day: BoardDay, periods: RepairPeriods) {
  try {
    const pool = await db();
    const [doctor, bookings, workbook, viewer] = await Promise.all([
      doctorFor(pool, user),
      listCasesOn(pool, day.boardDate),
      workbookFor(pool, day.cycleDay, day.boardDate),
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
    const adding: CaseAdding | null = doctor
      ? {
          doctor: { name: fullName(doctor), subtype: doctor.subtype },
          today: day.today,
          // The doctor's own bookings, HN included: theirs to see.
          mine: await listCasesBy(pool, doctor.id, day.today),
          onAdd: addCase,
          onRemove: deleteCase,
        }
      : null;
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
  searchParams: Promise<{ room?: string }>;
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
  const { board, adding, canUpload, failed } = await loadBoard(user, day, periods);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* At 16:00 and at midnight the board changes by itself; the delay is by the server's clock, and the id is this
          render's, so a board brought back by Back keeps counting from when it was first seen. */}
      <BoardRefresh renderId={crypto.randomUUID()} delayMs={nextBoardRefresh(at).getTime() - at.getTime()} />
      <TopBar
        date={day.boardDate}
        eyebrow={boardEyebrow(day.relation)}
        name={profile.name}
        role={profile.role}
        phone={user.phone ? formatPhone(user.phone) : undefined}
        image={user.picture}
        // Admins are listed by LINE user id (AUTH_ADMIN_LINE_IDS), the session's sub.
        adminHref={isAdmin(user.sub) ? "/admin" : null}
        uploadHref={canUpload ? "/upload" : null}
      />
      <SuiteBoard
        board={board}
        today={day.today}
        periods={periods}
        roomId={params.room ?? null}
        adding={adding}
        casesUnavailable={failed}
      />
    </div>
  );
}
