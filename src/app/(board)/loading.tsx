import { BrandMark } from "@/components/brand-mark";

/**
 * Shown the moment the board is opened from another page (the admin page's way back, the upload page, the logo).
 * The board waits for the sign-in check, the database and the holiday list, so without this a tap on "ตารางผ่าตัด"
 * seemed to do nothing until it arrived (Pong, 17 Nov 2026: back and forth with จัดการระบบ "lags a lot"). The bar and
 * the plan's place are held, so the board does not jump when it comes. Changing the room or the day on the board keeps
 * the board on screen instead (those are the same page).
 */
export default function BoardLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden" data-testid="board-loading">
      <header className="appbar z-30">
        <div className="mx-auto flex w-full max-w-[120rem] items-center gap-3 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:pt-[max(0.625rem,env(safe-area-inset-top))] sm:pb-2.5">
          <span className="flex min-h-11 shrink-0 items-center">
            <BrandMark className="h-10 w-10 rounded-xl" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="skeleton block h-3.5 w-20 rounded-md" />
            <span className="skeleton mt-1.5 block h-5 w-44 max-w-full rounded-md" />
          </div>
          {/* .skeleton sets its own corners, so the round avatar says so inline. */}
          <span className="skeleton size-[34px] shrink-0" style={{ borderRadius: "9999px" }} aria-hidden />
        </div>
      </header>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden" role="status" aria-label="กำลังโหลด…">
        <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden sm:px-3 lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-1 lg:p-0">
            {/* The plan's own shape (components/floor-plan.tsx, viewBox 1207 × 1706). */}
            <span className="skeleton block h-full max-h-full aspect-[1207/1706] max-w-full rounded-2xl opacity-70" aria-hidden />
          </div>
          <div className="hidden min-h-0 flex-1 flex-col gap-3 px-5 pt-4 lg:flex" aria-hidden>
            <span className="skeleton block h-7 w-40 rounded-md" />
            <span className="skeleton block h-4 w-72 rounded-md" />
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <span key={row} className="skeleton block h-10 w-full rounded-xl opacity-60" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
