import { notFound } from "next/navigation";
import type { StaffView } from "@/app/admin/data";
import { AdminBar } from "@/components/admin-bar";
import { MxMembers } from "@/components/mx-members";
import { RepairPeriodsForm } from "@/components/repair-periods-form";
import { StaffList } from "@/components/staff-list";
import { TestModeSection } from "@/components/test-mode-section";
import { todayIso } from "@/lib/days";
import { DEFAULT_REPAIR_PERIODS } from "@/lib/repair";
import { roleLabel, subtypeLabel, type UserType } from "@/lib/user-labels";

export const dynamic = "force-dynamic";

/** Invented people for the MX picker and the all-names list (no database here); the first two are already MX. */
const PREVIEW_PEOPLE: Array<[name: string, type: UserType, subtype: string]> = [
  ["ปราณี สายบุญ", "RN", "OR"],
  ["วิไล แสงทอง", "RN", "ANES"],
  ["สุดา คำดี", "PN", "OR"],
  ["อรุณี ศรีสุข", "RN", "OR"],
  ["บุญมี ใจซื่อ", "PCA", "OR"],
  ["กมล ทองดี", "DR", "OBGYN"],
  ["ชัยวัฒน์ มีสุข", "DR", "GENSX"],
  ["ณัฐพล วงศ์ใหญ่", "DR", "NEPHRO"],
  ["สมใจ ใจเย็น", "DR", "URO"],
  ["ประเสริฐ กล้าหาญ", "DR", "ORTHO"],
];
const PREVIEW_USERS = PREVIEW_PEOPLE.map(([name, type, subtype], index) => ({ id: String(index + 1), name, role: roleLabel(type, subtype) }));
const PREVIEW_STAFF: StaffView[] = PREVIEW_PEOPLE.map(([name, type, subtype], index) => ({
  id: String(index + 1),
  name,
  type,
  subtype,
  subtypeName: subtypeLabel(type, subtype) ?? subtype,
}));

/**
 * Development only: the admin page with the planned repair dates, invented MX members and an invented staff list.
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
          <StaffList initial={PREVIEW_STAFF} />
          <TestModeSection href="/preview?notices=all" />
        </div>
      </main>
    </div>
  );
}
