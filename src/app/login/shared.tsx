/** Pieces shared by the sign-in steps (/login/verify, /login/claim, /login/doctor). Isomorphic: no hooks. */

const ICONS = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M12 3.5l9 15.5H3z" />
      <path d="M12 10v4.2M12 17.2h.01" />
    </>
  ),
} as const;

const TONES = {
  wait: "bg-brand-tint text-brand ring-line-strong",
  ok: "bg-live-tint text-live ring-[rgb(21_127_61/0.25)]",
  bad: "bg-[rgb(253_236_234)] text-[var(--stop)] ring-[rgb(192_57_43/0.22)]",
} as const;

/** A round status icon above a state's heading; the heading says the same in words. */
export function StateIcon({ icon, tone }: { icon: keyof typeof ICONS; tone: keyof typeof TONES }) {
  return (
    <div className={`mx-auto mb-3 grid size-14 place-items-center rounded-full ring-1 ${TONES[tone]}`}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[icon]}
      </svg>
    </div>
  );
}

export const H2 = "text-base leading-snug font-semibold text-ink";
export const HELP = "mt-1 text-sm leading-6 text-muted";
export const LABEL = "mb-1.5 block text-sm font-semibold text-ink-2";
export const EXPIRED_MESSAGE = "หมดเวลายืนยันตัวตน กรุณาเริ่มใหม่";

/**
 * Said wherever a name cannot be picked (not on the list, or taken): names come only from the staff list, so the way
 * on is the administrator, who adds a missing name to `users` or frees a taken one.
 */
export const ASK_ADMIN = "ไม่พบชื่อ หรือชื่อมีผู้เลือกแล้ว? กรุณาติดต่อผู้ดูแล";

export function AskAdmin({ className = "", testId = "ask-admin" }: { className?: string; testId?: string }) {
  return (
    <p className={`text-[0.8125rem] leading-5 text-muted ${className}`} data-testid={testId}>
      {ASK_ADMIN}
    </p>
  );
}

/** Back to the start (LINE again, then the position and another number), e.g. after verifying the wrong number. */
export function OtherPhone() {
  return (
    <a className="text-btn mt-2" href="/api/auth/line/start" data-testid="other-phone">
      ใช้เบอร์อื่น
    </a>
  );
}

export function Chevron() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-muted"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
