import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { MxMembers } from "@/components/mx-members";
import { PhysicianAdmin } from "@/components/physician-admin";
import { RepairPeriodsForm } from "@/components/repair-periods-form";
import { SURGEONS } from "@/data/surgeons";
import { todayIso } from "@/lib/days";
import { DEFAULT_REPAIR_PERIODS } from "@/lib/repair";

export const dynamic = "force-dynamic";

/** Invented people for the MX picker (no database here); two of them are already MX. */
const PREVIEW_USERS = [
  { id: "1", name: "ปราณี สายบุญ", role: "พยาบาล · ห้องผ่าตัด" },
  { id: "2", name: "วิไล แสงทอง", role: "พยาบาล · วิสัญญี" },
  { id: "3", name: "สุดา คำดี", role: "ผู้ช่วยพยาบาล · ห้องผ่าตัด" },
  { id: "4", name: "อรุณี ศรีสุข", role: "พยาบาล · ห้องผ่าตัด" },
];

/**
 * Development only: the admin page with the planned repair dates, invented MX members and the supplied surgeons.
 * Changes stay in the page and are not saved.
 */
export default function PreviewAdminPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  const members = PREVIEW_USERS.slice(0, 2).map((user) => ({ userId: user.id, name: user.name, role: user.role, active: true, addedOn: "14 พ.ย. 2569" }));

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="จัดการระบบ" name="สมหญิง ไลน์" boardHref="/preview" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6">
          <RepairPeriodsForm initial={{ periods: DEFAULT_REPAIR_PERIODS, changed: null, fallback: false, today: todayIso() }} />
          <MxMembers initial={{ members, users: PREVIEW_USERS }} />
          <PhysicianAdmin initial={SURGEONS.map((person, index) => ({ id: index + 1, ...person }))} />
        </div>
      </main>
    </div>
  );
}
