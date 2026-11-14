import { BrandMark } from "@/components/brand-mark";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-bold tracking-[-0.01em] text-ink ${className}`}>
      ORSKH<span className="font-medium text-muted">.APP</span>
    </span>
  );
}

const NOTICE_ICON = {
  warning: (
    <>
      <path d="M12 3.5l9 15.5H3z" />
      <path d="M12 10v4.2M12 17.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.7 2.7L16 9.6" />
    </>
  ),
} as const;

/** An inline message with an icon, so its meaning does not rest on colour. */
export function Notice({
  tone = "info",
  role,
  className = "",
  children,
}: {
  tone?: keyof typeof NOTICE_ICON;
  role?: "alert" | "status";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`notice notice-${tone} ${className}`} role={role}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {NOTICE_ICON[tone]}
      </svg>
      <div>{children}</div>
    </div>
  );
}

/**
 * Shared frame for the sign-in, SMS-code, access-request and error pages: a plain card on the warm canvas, the mark,
 * and the step's own title as the one headline (the app's name sits quietly under the card). <main> is the page's
 * scroller; the sticky name search (.claim-search in globals.css) cancels its top padding, so keep the two in step.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex h-dvh overflow-y-auto overscroll-contain bg-canvas px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="m-auto w-full max-w-[24rem]">
        <div className="auth-card px-6 pt-7 pb-6 sm:px-7">
          <div className="flex flex-col items-center text-center">
            <BrandMark className="h-12 w-12 rounded-[14px]" />
            <h1 className="mt-4 text-xl leading-snug font-bold text-balance text-ink">{title}</h1>
            {description ? <p className="mt-1 text-sm leading-6 text-pretty text-muted">{description}</p> : null}
          </div>
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          <Wordmark className="text-xs" /> · ตารางห้องผ่าตัด
        </p>
      </div>
    </main>
  );
}

/**
 * Who is signing in: the LINE picture and name in a small pill under the title, and, once verified, the number.
 * The LINE display name is attacker-controlled: rendered as a text node only.
 */
export function LineIdentity({
  name,
  avatar,
  phone,
}: {
  name: string;
  avatar: React.ReactNode;
  phone?: string;
}) {
  return (
    <div className="flex justify-center">
      <div
        className="inline-flex max-w-full items-center gap-2.5 rounded-full border border-line bg-surface-2 py-1 pr-3.5 pl-1"
        data-testid={phone ? "request-identity" : "line-identity"}
      >
        {avatar}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm leading-5">
          <span className="min-w-0 font-semibold break-words text-ink" data-testid="line-name">
            {name}
          </span>
          {phone ? (
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink-2 tabular-nums">
              <span data-testid="request-phone">{phone}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-live" role="img" aria-label="ยืนยันแล้ว">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
