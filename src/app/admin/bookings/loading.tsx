import { AdminBar } from "@/components/admin-bar";

/** Shown the moment the account menu's ประวัติการจอง is tapped, while the log is read: the tiles and a few rows. */
export default function BookingLogLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="ประวัติการจอง" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 sm:gap-5" role="status" aria-label="กำลังโหลด…">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="skeleton h-[3.75rem] rounded-[14px]" />
            ))}
          </div>
          <span className="skeleton h-40 rounded-2xl sm:h-32" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="skeleton h-24 rounded-2xl" />
          ))}
        </div>
      </main>
    </div>
  );
}
