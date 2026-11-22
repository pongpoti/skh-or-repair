import { AdminBar } from "@/components/admin-bar";

/** The admin page's sections, in order, as their closed heading rows show them (components/admin-section.tsx). */
const SECTIONS = [
  { title: "ตารางผ่าตัดและช่วงปิดซ่อม", summary: "w-56", action: null },
  { title: "ผู้จัดการตาราง (MX)", summary: "w-40", action: "w-[6.5rem]" },
  { title: "รายชื่อทั้งหมด", summary: "w-44", action: null },
  { title: "ตารางตัวอย่าง", summary: "w-64", action: null },
  { title: "ตารางย้อนหลังจาก HOSxP", summary: "w-60", action: null },
  { title: "การจองจำลอง", summary: "w-64", action: null },
  { title: "โหมดทดสอบ", summary: "w-60", action: "w-[9.5rem]" },
] as const;

/**
 * Shown the moment the admin link is tapped. The page itself waits for the sign-in check and the database (which
 * sleeps when idle and can take a second to wake), so without this the tap seemed to do nothing until it arrived.
 * Every section starts closed, so this is their heading rows.
 */
export default function AdminLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="จัดการระบบ" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 sm:gap-6" role="status" aria-label="กำลังโหลด…">
          {SECTIONS.map((section) => (
            <section key={section.title} className="card overflow-hidden" aria-busy="true">
              <div className="flex items-center gap-3 p-4 sm:p-5">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-ink sm:text-lg">{section.title}</h2>
                  <span className={`skeleton mt-1.5 h-4 max-w-full rounded-md ${section.summary}`} />
                </div>
                {section.action ? <span className={`skeleton h-11 shrink-0 opacity-45 ${section.action}`} /> : null}
                <span className="skeleton size-5 shrink-0 rounded-md" />
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
