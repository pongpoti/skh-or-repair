import Link from "next/link";
import { BoardDatePicker, type DatePick } from "@/components/board-date-picker";
import { BrandMark } from "@/components/brand-mark";
import { PlaceTabs, type PlaceSwitch } from "@/components/place-tabs";
import { ProfileAvatar } from "@/components/profile-avatar";
import { SignOutButton } from "@/components/sign-out-button";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { thaiDate } from "@/lib/days";
import { BOARD_PATH } from "@/lib/places";

/**
 * A gear, for the admin's settings (Pong, 15 Nov 2026: a gear, not people). Lucide "settings" (https://lucide.dev, ISC
 * licence, Copyright (c) Lucide Contributors).
 */
const ADMIN_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

/** Lucide "circle-help" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */
const HELP_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

/** Lucide "history" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors): the booking log. */
const LOG_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

/** Lucide "upload" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */
const UPLOAD_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5" />
    <path d="M12 3v12" />
  </svg>
);

/** Lucide "hospital" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors): the hospitals' page. */
const HEADING = "text-[0.9375rem] leading-6 font-bold text-ink min-[400px]:text-base sm:text-lg";

/**
 * One bar: the mark, the board's date as the page heading, the upload page for MX and admins, the admin page for
 * admins, and the account menu behind the avatar.
 */
export function TopBar({
  name,
  role = null,
  phone,
  image,
  date,
  eyebrow = "ตารางผ่าตัดวันนี้",
  pathname = BOARD_PATH,
  showAccount = true,
  adminHref = null,
  logHref = null,
  uploadHref = null,
  helpHref = null,
  datePick = null,
  place = null,
}: {
  /** The person's full name (claimed user, else the LINE name). */
  name: string;
  /** Type and subtype in Thai ("แพทย์ · ออร์โธปิดิกส์"), shown under the name in the account menu. */
  role?: string | null;
  /** The signed-in mobile number as shown (081-234-5678), under the name in the account menu. */
  phone?: string;
  /** LINE profile picture; only https *.line-scdn.net is shown, otherwise the name's first letter. */
  image?: string | null;
  /** The board's date, YYYY-MM-DD: today until 16:00, then the next workday (lib/board-day.ts), or the day picked. */
  date: string;
  /** The line above the date, saying how it stands to today (lib/board-day.ts boardEyebrow). */
  eyebrow?: string;
  pathname?: string;
  showAccount?: boolean;
  /** The admin page, shown only to admins. */
  adminHref?: string | null;
  /** The booking log (ประวัติการจอง) in the account menu, shown only to admins (Pong, 28 Nov 2026). */
  logHref?: string | null;
  /** The HOSxP upload page, shown only to MX and admins. */
  uploadHref?: string | null;
  /** The tutorial (วิธีใช้งาน) in the account menu: the doctors' for doctors and admins, the staff's for everyone else. */
  helpHref?: string | null;
  /** When given, the date is a button that opens a calendar to show the board of another day (BoardDatePicker). */
  datePick?: DatePick | null;
  /** On a hospital's board: the switch to the other hospital's board (PlaceTabs). */
  place?: PlaceSwitch | null;
}) {
  const src = avatarSrc(image);
  const initial = initialOf(name);
  // Each button beside the date takes 56px from it, so the month is abbreviated up to a wider screen with each one.
  // With both, the name beside the avatar (from 640px) leaves too little room for the long month until 768px.
  const buttons = (adminHref ? 1 : 0) + (uploadHref ? 1 : 0);
  const shortDate = buttons === 2 ? "md:hidden" : buttons === 1 ? "min-[480px]:hidden" : "min-[400px]:hidden";
  const longDate = buttons === 2 ? "hidden md:inline" : buttons === 1 ? "hidden min-[480px]:inline" : "hidden min-[400px]:inline";
  const when = (
    <time dateTime={date}>
      {/* The month is abbreviated on narrow phones so the whole date, year included, fits beside the avatar (and the
          upload and admin buttons, which take another 56px each). */}
      <span className={shortDate}>{thaiDate(date, "short")}</span>
      <span className={longDate}>{thaiDate(date)}</span>
    </time>
  );

  return (
    <header className="appbar z-30">
      {/* With the hospitals' switch, the bar wraps on a phone: the switch takes a second line (order-last), and the date's
          zero basis keeps the first line whole. */}
      <div className="mx-auto flex w-full max-w-[120rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 lg:flex-nowrap pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:pt-[max(0.625rem,env(safe-area-inset-top))] sm:pb-2.5">
        <Link href={pathname} className="flex min-h-11 shrink-0 items-center rounded-xl" aria-label="ORSKH.APP หน้าแรก">
          <BrandMark className="h-10 w-10 rounded-xl transition-[filter] hover:brightness-115" />
        </Link>
        <div className="relative min-w-0 flex-1">
          <p className="flex items-center gap-0.5 text-xs leading-5 font-medium text-muted">
            <span className="truncate" data-testid="board-eyebrow">
              {eyebrow}
            </span>
            {/* The date picker's sign sits on this short line, so it never takes room from the date and its year. */}
            {datePick ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
                data-testid="board-date-chevron"
              >
                {/* Lucide "chevron-down" (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors). */}
                <path d="m6 9 6 6 6-6" />
              </svg>
            ) : null}
          </p>
          {datePick ? (
            <BoardDatePicker date={date} pick={datePick} pathname={pathname} headingClassName={HEADING}>
              {when}
            </BoardDatePicker>
          ) : (
            <h1 className={`truncate ${HEADING}`}>{when}</h1>
          )}
        </div>
        {place ? (
          // A line of its own under 1024px (at most 26rem wide, centred on a tablet), beside the date from 1024px.
          <div className="order-last basis-full lg:order-none lg:basis-auto">
            <PlaceTabs
              {...place}
              // A day picked in the calendar or by a swipe goes along; the boards' own day is the same at both.
              pickedDate={datePick && date !== datePick.current ? date : null}
              className="mx-auto max-w-[26rem] lg:max-w-none"
            />
          </div>
        ) : null}
        {uploadHref ? (
          // Like the admin button: the account menu's link stands in below 390px, and below 450px when the admin
          // button is there too, so the date keeps its year. The label needs a wider screen with two buttons.
          <Link
            href={uploadHref}
            className={`btn btn-ghost hidden size-11 min-h-0 shrink-0 p-0 ${adminHref ? "min-[450px]:inline-flex xl:w-auto xl:px-3.5" : "min-[390px]:inline-flex md:w-auto md:px-3.5"}`}
            aria-label="อัปโหลดตาราง"
            title="อัปโหลดตาราง HOSxP"
            data-testid="upload-button"
          >
            {UPLOAD_ICON}
            <span className={`hidden text-sm ${adminHref ? "xl:inline" : "md:inline"}`}>อัปโหลดตาราง</span>
          </Link>
        ) : null}
        {adminHref ? (
          // Below 390px the button would cut the year off the date, so narrow phones use the account menu's link.
          // Its label shows from 768px; between 640px and 768px the wider date needs the room.
          <Link
            href={adminHref}
            className="btn btn-ghost hidden size-11 min-h-0 shrink-0 p-0 min-[390px]:inline-flex md:w-auto md:px-3.5"
            aria-label="จัดการระบบ"
            title="จัดการระบบ: ช่วงปิดซ่อม ผู้จัดการตาราง และรายชื่อทั้งหมด"
            data-testid="admin-button"
          >
            {ADMIN_ICON}
            <span className="hidden text-sm md:inline">จัดการระบบ</span>
          </Link>
        ) : null}
        {showAccount ? (
          <AccountMenu
            name={name}
            role={role}
            phone={phone}
            image={image}
            uploadHref={uploadHref}
            adminHref={adminHref}
            logHref={logHref}
            helpHref={helpHref}
          />
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            <ProfileAvatar src={src} initial={initial} />
            <span className="sr-only sm:not-sr-only sm:block sm:max-w-44 sm:truncate sm:text-sm sm:font-medium sm:text-ink-2">{name}</span>
          </span>
        )}
      </div>
    </header>
  );
}

/**
 * The avatar and its account menu (a popover, so a tap outside or Escape closes it without any script): who is signed
 * in, the pages the person may open, and sign-out.
 */
function AccountMenu({
  name,
  role = null,
  phone,
  image,
  uploadHref = null,
  adminHref = null,
  logHref = null,
  helpHref = null,
}: {
  name: string;
  role?: string | null;
  phone?: string;
  image?: string | null;
  uploadHref?: string | null;
  adminHref?: string | null;
  logHref?: string | null;
  helpHref?: string | null;
}) {
  const src = avatarSrc(image);
  const initial = initialOf(name);
  return (
    <>
      <button
        type="button"
        popoverTarget="account-menu"
        aria-label={`บัญชี ${name}`}
        data-testid="user-menu"
        className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full sm:pr-3 sm:pl-1 sm:hover:bg-white/70"
      >
        <ProfileAvatar src={src} initial={initial} />
        <span className="hidden max-w-56 truncate text-sm font-medium text-ink-2 sm:block" data-testid="user-name">
          {name}
        </span>
      </button>
      <div
        id="account-menu"
        popover="auto"
        data-testid="account-menu"
        className="menu fixed inset-auto top-[calc(max(0.5rem,env(safe-area-inset-top))+3.5rem)] right-4 sm:right-[max(1.5rem,calc((100vw-120rem)/2+1.5rem))] m-0 w-[min(18rem,calc(100vw-2rem))] p-2 sm:top-[calc(max(0.625rem,env(safe-area-inset-top))+3.75rem)]"
      >
        <div className="flex items-center gap-3 px-2 pt-1.5 pb-3">
          <ProfileAvatar src={src} initial={initial} size={40} />
          <div className="min-w-0">
            <p className="text-sm leading-snug font-semibold break-words text-ink" data-testid="account-name">
              {name}
            </p>
            {role ? (
              <p className="text-xs leading-snug text-ink-2" data-testid="account-role">
                {role}
              </p>
            ) : null}
            {phone ? (
              // The whole number, never cut off: it is what the session is bound to.
              <p className="text-xs leading-snug whitespace-nowrap text-muted tabular-nums" data-testid="account-phone">
                {phone}
              </p>
            ) : null}
          </div>
        </div>
        {uploadHref ? (
          <Link href={uploadHref} className="btn btn-ghost mb-2 w-full" data-testid="account-upload-link">
            {UPLOAD_ICON}
            อัปโหลดตาราง
          </Link>
        ) : null}
        {adminHref ? (
          <Link href={adminHref} className="btn btn-ghost mb-2 w-full" data-testid="account-admin-link">
            {ADMIN_ICON}
            จัดการระบบ
          </Link>
        ) : null}
        {logHref ? (
          <Link href={logHref} className="btn btn-ghost mb-2 w-full" data-testid="account-log-link">
            {LOG_ICON}
            ประวัติการจอง
          </Link>
        ) : null}
        {helpHref ? (
          <Link href={helpHref} className="btn btn-ghost mb-2 w-full" data-testid="account-help-link">
            {HELP_ICON}
            วิธีใช้งาน
          </Link>
        ) : null}
        <SignOutButton showLabel />
      </div>
      <div className="no-popover-only shrink-0">
        <SignOutButton />
      </div>
    </>
  );
}
