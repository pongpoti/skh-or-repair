import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { AdminSection } from "@/components/admin-section";
import { MxMembers } from "@/components/mx-members";
import { PastListsSection } from "@/components/past-lists-section";
import { RepairPeriodsForm } from "@/components/repair-periods-form";
import { StaffList } from "@/components/staff-list";
import { TestModeSection } from "@/components/test-mode-section";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { avatarSrc } from "@/lib/avatar";
import { loadBoardDay, pickRange } from "@/lib/board-day";
import { now } from "@/lib/clock";
import { DEMO_MIN_CASES, demoDay } from "@/lib/demo-schedule";
import { holidaysBetween } from "@/lib/holidays";
import { BOARD_PATH } from "@/lib/places";
import { shortThaiDate } from "@/lib/repair";
import { XLS_MESSAGE, XLSX_LIMITS } from "@/lib/xlsx";
import { addStaff, grantMx, importPastLists, revokeMx, saveRepair } from "./actions";
import { loadPastListView, loadPeople, loadRepairView } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "จัดการระบบ · ORSKH.APP" };

const HALF_NAME = { 1: "ครึ่งแรก", 2: "ครึ่งหลัง" } as const;

/** The first day the simulated bookings open on (Pong asked for October 2026). */
const SIM_START = "2026-10-01";

/**
 * The admin page: the repair's dates, the MX members (who upload the HOSxP workbook), everyone on the staff list, the
 * demo schedule, the import of past days' HOSxP lists, the simulated bookings and the test notices. Every section starts closed, its buttons greyed out until it is opened (Pong,
 * 16 Nov 2026; components/admin-section.tsx). Each section shows a notice when its data cannot be read, so the others
 * still open.
 */
export default async function AdminPage() {
  const user = await requireUser();
  // Admins are listed by LINE user id (the session's sub). Anyone else gets the same page as a mistyped address.
  if (!isAdmin(user.sub)) notFound();

  const [name, repair, people, day, past] = await Promise.all([
    displayNameFor(user, user.name),
    loadRepairView(),
    loadPeople(),
    loadBoardDay(now()),
    loadPastListView(),
  ]);
  // The day the demo schedule would open on for each half, by the board's own rule (lib/demo-schedule.ts demoDay), so a
  // half with no day left is shown as such here rather than sending the admin to a day of the other half.
  const range = pickRange(day.today, repair.periods);
  const { holidays } = await holidaysBetween(range.min, range.max);
  const demoOn = (half: 1 | 2) =>
    demoDay(half, { today: day.today, boardDate: day.boardDate, max: range.max, periods: repair.periods, holidays });

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar
        title="จัดการระบบ"
        name={name}
        // AdminBar hands the picture straight to the avatar, so only LINE's CDN is let through (as on the board).
        image={avatarSrc(user.picture)}
      />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
          <RepairPeriodsForm initial={repair} onSave={saveRepair} />
          <MxMembers initial={people.mx} onAdd={grantMx} onRemove={revokeMx} />
          {/* Everyone on the staff list, by type (Pong, 16 Nov 2026), in place of the old surgeon list. */}
          <StaffList initial={people.staff} onAdd={addStaff} />
          {/* The demo schedule (Pong, 15 Nov 2026: "create a dummy OR schedule cases on all rooms, each room has at least
              10 cases. Do it for first half and second half. Add section on admin setting to select which part to
              see."): the board picks the day of the half (/?demo=1&half=N, lib/demo-schedule.ts demoDay). */}
          <AdminSection
            id="demo"
            title="ตารางตัวอย่าง"
            summary={`เคสสมมติอย่างน้อย ${DEMO_MIN_CASES} เคสในทุกห้อง เลือกช่วงที่จะดู ไม่บันทึก และไม่แตะการจองหรือตาราง HOSxP จริง เห็นเฉพาะผู้ดูแลระบบ`}
            testId="demo-section"
          >
            <div className="grid grid-cols-2 gap-2 p-4 sm:gap-3 sm:p-5">
              {([1, 2] as const).map((half) => {
                const { from, to } = half === 1 ? repair.periods.half1 : repair.periods.half2;
                // A half with no day left to show (the board only goes from today on, on workdays).
                return demoOn(half) === null ? (
                  <span key={half} className="btn btn-secondary cursor-not-allowed flex-col gap-0.5 py-2.5 opacity-55" aria-disabled="true" data-testid={`demo-half-${half}`}>
                    <span>{HALF_NAME[half]}</span>
                    <span className="text-xs font-medium">{to < day.today ? "จบแล้ว" : "ไม่มีวันทำการเหลือ"}</span>
                  </span>
                ) : (
                  <Link key={half} href={`${BOARD_PATH}?demo=1&half=${half}`} className="btn btn-secondary flex-col gap-0.5 py-2.5" data-testid={`demo-half-${half}`}>
                    <span>{HALF_NAME[half]}</span>
                    {/* Each date whole on its line when the two do not fit side by side. */}
                    <span className="text-center text-xs font-medium tabular-nums">
                      <span className="whitespace-nowrap">{shortThaiDate(from)} –</span> <span className="whitespace-nowrap">{shortThaiDate(to)}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </AdminSection>
          {/* Past days' HOSxP lists for the board's calendar (Pong, 19 Nov 2026: "No case shown on Jan, why ?"). */}
          <PastListsSection initial={past} rules={{ maxBytes: XLSX_LIMITS.maxFileBytes, xlsMessage: XLS_MESSAGE }} onImport={importPastLists} />
          {/* Simulated bookings on the imported lists (Pong, 22 Nov 2026: "Try create booking case of each day on Oct 2026
              using similar hosxp cases"): the board's /?sim=1, from 1 Oct 2026 (lib/sim-bookings.ts). */}
          <AdminSection
            id="sim"
            title="การจองจำลอง"
            summary="จองสมมติจากรายการ HOSxP ที่นำเข้า ดูการจับคู่และการจัดห้อง ไม่บันทึก และไม่แตะการจองจริง เห็นเฉพาะผู้ดูแลระบบ"
            testId="sim-section"
          >
            <div className="flex flex-col gap-2 p-4 sm:p-5">
              <Link href={`${BOARD_PATH}?sim=1&date=${SIM_START}`} className="btn btn-secondary flex-col gap-0.5 self-start py-2.5" data-testid="sim-october">
                <span>ต.ค. 2569</span>
                <span className="text-xs font-medium">เริ่ม {shortThaiDate(SIM_START)}</span>
              </Link>
              <p className="text-sm text-ink-2">เลือกวันอื่นในปฏิทิน หรือปัดแผนผัง ก็ยังเป็นการจองจำลอง แตะโลโก้เพื่อกลับตารางจริง</p>
            </div>
          </AdminSection>
          <TestModeSection href={`${BOARD_PATH}?notices=all`} />
        </div>
      </main>
    </div>
  );
}
