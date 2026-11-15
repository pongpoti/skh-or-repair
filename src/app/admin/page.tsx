import type { Metadata } from "next";
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
import { listSurgeons } from "@/lib/surgeon-store";
import { grantMx, removeSurgeon, revokeMx, saveRepair, saveSurgeon } from "./actions";
import { loadMxData, loadRepairView } from "./data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "จัดการระบบ · ORSKH.APP" };

/**
 * The admin page, saved to the database: the repair's dates and the MX members (who upload the HOSxP workbook) above the
 * surgeon list. Each section shows a notice when its data cannot be read, so the others still open.
 */
export default async function AdminPage() {
  const user = await requireUser();
  // Admins are listed by LINE user id (the session's sub). Anyone else gets the same page as a mistyped address.
  if (!isAdmin(user.sub)) notFound();

  const [surgeons, name, repair, mx] = await Promise.all([
    // The surgeon list goes through Neon's HTTP driver (src/db): when it cannot be read, the repair's dates and the MX
    // list above it still open.
    listSurgeons().catch((error: unknown) => {
      console.error(`[admin] the surgeon list is unavailable (${error instanceof Error ? error.name : typeof error})`);
      return null;
    }),
    displayNameFor(user, user.name),
    loadRepairView(),
    loadMxData(),
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
        </div>
      </main>
    </div>
  );
}
