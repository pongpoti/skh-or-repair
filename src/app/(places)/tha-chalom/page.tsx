import { redirect } from "next/navigation";
import { BoardRefresh } from "@/components/board-refresh";
import type { BoardView, CaseAdding } from "@/components/suite-board";
import { ThaChalomBoard } from "@/components/tha-chalom-board";
import { TopBar } from "@/components/top-bar";
import { addDays, BOOK_AHEAD_DAYS, earliestBookingDay } from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requestPath, requireUser } from "@/lib/auth/server";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, relationTo, type BoardDay } from "@/lib/board-day";
import { buildThaChalomRows } from "@/lib/board-rows";
import { doctorFor, listCasesBy, listCasesOn } from "@/lib/cases";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import { THA_CHALOM_PATH } from "@/lib/places";
import { currentRepairPeriods } from "@/lib/repair-store";
import { boardViewer } from "@/lib/roles";
import { thaChalomPickedDay, thaChalomPickRange } from "@/lib/tha-chalom-schedule";
import type { SessionUser } from "@/lib/tokens";
import { unavailablePath } from "@/lib/unavailable";
import { fullName } from "@/lib/user-list";
import { workbookFor, workbookForDay } from "@/lib/workbook-store";
import { addThaChalomCase, deleteThaChalomCase, editCase, thaChalomDayBookings, undoThaChalomCancel } from "@/app/(board)/actions";

export const dynamic = "force-dynamic";

/**
 * รพ.ท่าฉลอม's board (Pong, 26 Nov 2026: first its plan alone, "Just simply show layout", then the hospital's weekly
 * table): the day's OR schedule on Pong's plan, with the list of rooms (components/tha-chalom-board.tsx). The day turns
 * over at 16:00 as on รพ.สมุทรสาคร's board (lib/board-day.ts), skipping weekends and holidays, and the date in the bar
 * picks another (?date=YYYY-MM-DD, today to 60 days ahead), as a swipe across the plan does. The bar's switch goes to
 * รพ.สมุทรสาคร's board on the same day. The bar has รพ.สมุทรสาคร's buttons for the same people (Pong, 27 Nov 2026:
 * "Arrange component of ท่าฉลอม exact same as สมทุรสาคร"): จัดการระบบ for admins, อัปโหลดตาราง for MX and admins, and
 * วิธีใช้งาน in the account menu of doctors and admins. Its doctors book its rooms (Pong, 27 Nov 2026: "Add booking btn on
 * ท่าฉลอม also"), and MX's HOSxP upload holds its cases too (Pong, 27 Nov 2026: "Excel file include both place on one
 * sheet"): its rooms' cases are the two matched, as on รพ.สมุทรสาคร's board.
 */

/**
 * The day's HOSxP cases and bookings as rows (lib/board-rows.ts buildThaChalomRows), with an HN only for who may see it
 * (the doctor who booked, MX and admins), the booking form's needs for a doctor, and whether the viewer may upload. The
 * HOSxP list is รพ.สมุทรสาคร's board's: the latest upload of the cycle for the board's own day, the latest for the day
 * whichever cycle made it for a day picked (`picked`), each only from an upload that kept this hospital's cases. A
 * database problem returns null, and the page goes to the outage page, as รพ.สมุทรสาคร's board does.
 */
async function loadBoard(
  user: SessionUser,
  date: string,
  day: BoardDay,
  picked: boolean,
): Promise<{ board: Omit<BoardView, "date" | "mismatchCount">; adding: CaseAdding | null; upload: boolean } | null> {
  try {
    const pool = await db();
    const [doctor, bookings, workbook, viewer] = await Promise.all([
      doctorFor(pool, user),
      listCasesOn(pool, date, "tha-chalom"),
      picked ? workbookForDay(pool, date, "tha-chalom") : workbookFor(pool, day.cycleDay, day.boardDate, "tha-chalom"),
      boardViewer(pool, user),
    ]);
    const built = buildThaChalomRows({ date, workbook: workbook?.cases ?? null, bookings, viewer });
    const board = { rows: built.rows, uploaded: built.uploaded, mismatchByRoom: built.mismatchByRoom, offBoard: built.offBoard };
    let adding: CaseAdding | null = null;
    if (doctor) {
      const [mine, { holidays, unlisted }] = await Promise.all([
        // The doctor's own bookings here, HN included: theirs to see.
        listCasesBy(pool, doctor.id, day.today, "tha-chalom"),
        holidaysBetween(day.today, addDays(day.today, BOOK_AHEAD_DAYS)),
      ]);
      adding = {
        doctor: { name: fullName(doctor), subtype: doctor.subtype },
        today: day.today,
        earliest: earliestBookingDay(day.today, day.minutes, holidays),
        holidays,
        unlisted,
        mine,
        onAdd: addThaChalomCase,
        onEdit: editCase,
        onRemove: deleteThaChalomCase,
        onRestore: undoThaChalomCancel,
        onDay: thaChalomDayBookings,
      };
    }
    // MX and admins see every HN (lib/roles.ts), and they are the ones who upload.
    return { board, adding, upload: viewer.allHn };
  } catch (error) {
    console.error("[tha-chalom] cases unavailable:", (error as Error).message);
    return null;
  }
}

export default async function ThaChalomPage({ searchParams }: { searchParams: Promise<{ date?: string | string[]; room?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  // Every time decision goes through the app's clock (lib/clock.ts), so the tests can set it.
  const at = now();
  const [profile, day, periods] = await Promise.all([profileFor(user, user.name), loadBoardDay(at), currentRepairPeriods()]);
  const admin = isAdmin(user.sub);
  const range = thaChalomPickRange(day.today);
  const { holidays, unlisted } = await holidaysBetween(range.min, range.max);
  const picked = thaChalomPickedDay(params.date, day.today, holidays);
  const date = picked ?? day.boardDate;
  const datePick = { today: day.today, current: day.boardDate, ...range, holidays, unlisted };
  // Picking the board's own day counts as no pick, as on รพ.สมุทรสาคร's board.
  const loaded = await loadBoard(user, date, day, date !== day.boardDate);
  // Outside the try of loadBoard: redirect() works by throwing.
  if (!loaded) redirect(unavailablePath("server", await requestPath()));

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* At 16:00 and at midnight the day changes by itself, as on รพ.สมุทรสาคร's board. */}
      <BoardRefresh renderId={crypto.randomUUID()} delayMs={nextBoardRefresh(at).getTime() - at.getTime()} />
      <TopBar
        date={date}
        eyebrow={boardEyebrow(relationTo(date, day.today))}
        name={profile.name}
        role={profile.role}
        phone={user.phone ? formatPhone(user.phone) : undefined}
        image={user.picture}
        pathname={THA_CHALOM_PATH}
        adminHref={admin ? "/admin" : null}
        uploadHref={loaded.upload ? "/upload" : null}
        helpHref={loaded.adding || admin ? "/tutorial" : null}
        datePick={datePick}
        // The switch in the bar names the hospital (Pong, 26 Nov 2026) and goes to รพ.สมุทรสาคร's board on the same day.
        place={{ current: "tha-chalom" }}
      />
      <ThaChalomBoard
        date={date}
        pick={datePick}
        board={loaded.board}
        roomId={typeof params.room === "string" ? params.room : null}
        adding={loaded.adding}
        periods={periods}
      />
    </div>
  );
}
