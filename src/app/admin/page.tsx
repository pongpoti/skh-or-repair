import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { MxMembers } from "@/components/mx-members";
import { HosxpResetSection } from "@/components/hosxp-reset-section";
import { RepairPeriodsForm } from "@/components/repair-periods-form";
import { StaffList } from "@/components/staff-list";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { avatarSrc } from "@/lib/avatar";
import { addStaff, grantMx, resetHosxpDay, revokeMx, saveRepair } from "./actions";
import { loadListedDays, loadPeople, loadRepairView } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "จัดการระบบ · ORSKH.APP" };

/**
 * The admin page: the repair's dates, the MX members (who upload the HOSxP workbook), everyone on the staff list and
 * the reset of a day's HOSxP lists. The demo schedule, the simulated bookings and the test notices went on 28 Nov 2026
 * (Pong: "On admin setting: remove ตารางตัวอย่าง การจองจำลอง and โหมดทดสอบ"), with the board's modes they opened. Every
 * section starts closed, its buttons greyed out until it is opened (Pong, 16 Nov 2026; components/admin-section.tsx).
 * Each section shows a notice when its data cannot be read, so the others still open.
 */
export default async function AdminPage() {
  const user = await requireUser();
  // Admins are listed by LINE user id (the session's sub). Anyone else gets the same page as a mistyped address.
  if (!isAdmin(user.sub)) notFound();

  const [name, repair, people, listed] = await Promise.all([
    displayNameFor(user, user.name),
    loadRepairView(),
    loadPeople(),
    loadListedDays(),
  ]);

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
          {/* One day's HOSxP lists reset, bookings kept (Pong, 27 Nov 2026: "Add option for admin to reset OR schedule of
              specific date (reset only for hosxp case)"). It took the place of the past days' import, which went with the
              past days ("Disable past day view and clear pastday data for both places"). */}
          <HosxpResetSection initial={listed} onReset={resetHosxpDay} />
        </div>
      </main>
    </div>
  );
}
