import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { Notice } from "@/components/auth-shell";
import { MxMembers } from "@/components/mx-members";
import { PhysicianAdmin } from "@/components/physician-admin";
import { RepairPeriodsForm } from "@/components/repair-periods-form";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { avatarSrc } from "@/lib/avatar";
import { loadBoardDay, pickRange } from "@/lib/board-day";
import { now } from "@/lib/clock";
import { DEMO_MIN_CASES, demoDay } from "@/lib/demo-schedule";
import { holidaysBetween } from "@/lib/holidays";
import { shortThaiDate } from "@/lib/repair";
import { listSurgeons } from "@/lib/surgeon-store";
import { grantMx, removeSurgeon, revokeMx, saveRepair, saveSurgeon } from "./actions";
import { loadMxData, loadRepairView } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "จัดการระบบ · ORSKH.APP" };

const HALF_NAME = { 1: "ครึ่งแรก", 2: "ครึ่งหลัง" } as const;

/**
 * The admin page, saved to the database: the repair's dates and the MX members (who upload the HOSxP workbook) above the
 * surgeon list. Each section shows a notice when its data cannot be read, so the others still open.
 */
export default async function AdminPage() {
  const user = await requireUser();
  // Admins are listed by LINE user id (the session's sub). Anyone else gets the same page as a mistyped address.
  if (!isAdmin(user.sub)) notFound();

  const [surgeons, name, repair, mx, day] = await Promise.all([
    // The surgeon list goes through Neon's HTTP driver (src/db): when it cannot be read, the repair's dates and the MX
    // list above it still open.
    listSurgeons().catch((error: unknown) => {
      console.error(`[admin] the surgeon list is unavailable (${error instanceof Error ? error.name : typeof error})`);
      return null;
    }),
    displayNameFor(user, user.name),
    loadRepairView(),
    loadMxData(),
    loadBoardDay(now()),
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
          <MxMembers initial={mx} onAdd={grantMx} onRemove={revokeMx} />
          {surgeons ? (
            <PhysicianAdmin initial={surgeons} onSave={saveSurgeon} onRemove={removeSurgeon} />
          ) : (
            <section className="card overflow-hidden" aria-labelledby="physician-list-title">
              <div className="flex flex-col gap-3 p-4 sm:p-5">
                <h2 id="physician-list-title" className="text-base font-bold text-ink sm:text-lg">
                  รายชื่อแพทย์
                </h2>
                <Notice tone="warning" role="alert">
                  อ่านรายชื่อแพทย์จากระบบไม่ได้ ลองโหลดหน้านี้ใหม่
                </Notice>
              </div>
            </section>
          )}
          {/* The demo schedule (Pong, 15 Nov 2026: "create a dummy OR schedule cases on all rooms, each room has at least
              10 cases. Do it for first half and second half. Add section on admin setting to select which part to
              see."): the board picks the day of the half (/?demo=1&half=N, lib/demo-schedule.ts demoDay). */}
          <section className="card overflow-hidden" aria-labelledby="demo-title" data-testid="demo-section">
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="min-w-0">
                <h2 id="demo-title" className="text-base font-bold text-ink sm:text-lg">
                  ตารางตัวอย่าง
                </h2>
                <p className="mt-1 text-sm text-ink-2">
                  เคสสมมติอย่างน้อย {DEMO_MIN_CASES} เคสในทุกห้อง เลือกช่วงที่จะดู ไม่บันทึก และไม่แตะการจองหรือตาราง HOSxP จริง
                  เห็นเฉพาะผู้ดูแลระบบ
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {([1, 2] as const).map((half) => {
                  const { from, to } = half === 1 ? repair.periods.half1 : repair.periods.half2;
                  const dates = `${shortThaiDate(from)} – ${shortThaiDate(to)}`;
                  // A half with no day left to show (the board only goes from today on, on workdays).
                  return demoOn(half) === null ? (
                    <span key={half} className="btn btn-secondary cursor-not-allowed flex-col gap-0.5 py-2.5 opacity-55" aria-disabled="true" data-testid={`demo-half-${half}`}>
                      <span>{HALF_NAME[half]}</span>
                      <span className="text-xs font-medium">{to < day.today ? "จบแล้ว" : "ไม่มีวันทำการเหลือ"}</span>
                    </span>
                  ) : (
                    <Link key={half} href={`/?demo=1&half=${half}`} className="btn btn-secondary flex-col gap-0.5 py-2.5" data-testid={`demo-half-${half}`}>
                      <span>{HALF_NAME[half]}</span>
                      <span className="text-xs font-medium tabular-nums">{dates}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
          {/* Test mode (Pong, 15 Nov 2026): every kind of notice in the board's strip at once, seen by admins only. */}
          <section className="card overflow-hidden" aria-labelledby="test-mode-title">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <h2 id="test-mode-title" className="text-base font-bold text-ink sm:text-lg">
                  โหมดทดสอบ
                </h2>
                <p className="mt-1 text-sm text-ink-2">แสดงการแจ้งเตือนทุกแบบพร้อมกันในแถบเหนือแผนผัง เห็นเฉพาะผู้ดูแลระบบ</p>
              </div>
              <Link href="/?notices=all" className="btn btn-secondary shrink-0" data-testid="test-notices-link">
                ดูการแจ้งเตือนทุกแบบ
              </Link>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
