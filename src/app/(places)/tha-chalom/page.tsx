import { BoardRefresh } from "@/components/board-refresh";
import { ThaChalomBoard } from "@/components/tha-chalom-board";
import { TopBar } from "@/components/top-bar";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { boardEyebrow, loadBoardDay, nextBoardRefresh, relationTo } from "@/lib/board-day";
import { doctorFor } from "@/lib/cases";
import { now } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import { formatPhone } from "@/lib/phone";
import { THA_CHALOM_PATH } from "@/lib/places";
import { canUpload } from "@/lib/roles";
import { thaChalomPickedDay, thaChalomPickRange } from "@/lib/tha-chalom-schedule";
import type { SessionUser } from "@/lib/tokens";

export const dynamic = "force-dynamic";

/**
 * รพ.ท่าฉลอม's board (Pong, 26 Nov 2026: first its plan alone, "Just simply show layout", then the hospital's weekly
 * table): the day's OR schedule on Pong's plan, with the list of rooms (components/tha-chalom-board.tsx). The day turns
 * over at 16:00 as on รพ.สมุทรสาคร's board (lib/board-day.ts), skipping weekends and holidays, and the date in the bar
 * picks another (?date=YYYY-MM-DD, today to 60 days ahead), as a swipe across the plan does. The bar's switch goes to
 * รพ.สมุทรสาคร's board on the same day. The bar has รพ.สมุทรสาคร's buttons for the same people (Pong, 27 Nov 2026:
 * "Arrange component of ท่าฉลอม exact same as สมทุรสาคร"): จัดการระบบ for admins, อัปโหลดตาราง for MX and admins, and
 * วิธีใช้งาน in the account menu of doctors and admins. No cases and no bookings yet.
 */
async function barLinks(user: SessionUser): Promise<{ upload: boolean; doctor: boolean }> {
  // A database problem leaves the two links out rather than the board: nothing else here reads it.
  try {
    const pool = await db();
    const [upload, doctor] = await Promise.all([canUpload(pool, user), doctorFor(pool, user)]);
    return { upload, doctor: doctor !== null };
  } catch (error) {
    console.error("[tha-chalom] bar links unavailable:", (error as Error).message);
    return { upload: false, doctor: false };
  }
}

export default async function ThaChalomPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const user = await requireUser();
  const params = await searchParams;
  // Every time decision goes through the app's clock (lib/clock.ts), so the tests can set it.
  const at = now();
  const [profile, day, links] = await Promise.all([profileFor(user, user.name), loadBoardDay(at), barLinks(user)]);
  const admin = isAdmin(user.sub);
  const range = thaChalomPickRange(day.today);
  const { holidays, unlisted } = await holidaysBetween(range.min, range.max);
  const picked = thaChalomPickedDay(params.date, day.today, holidays);
  const date = picked ?? day.boardDate;
  const datePick = { today: day.today, current: day.boardDate, ...range, holidays, unlisted };

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
        uploadHref={links.upload ? "/upload" : null}
        helpHref={links.doctor || admin ? "/tutorial" : null}
        datePick={datePick}
        // The switch in the bar names the hospital (Pong, 26 Nov 2026) and goes to รพ.สมุทรสาคร's board on the same day.
        place={{ current: "tha-chalom" }}
      />
      <ThaChalomBoard date={date} pick={datePick} />
    </div>
  );
}
