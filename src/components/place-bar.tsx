import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/top-bar";
import { PLACES_PATH } from "@/lib/places";

export type Account = { name: string; role: string | null; phone?: string; image: string | null };

/**
 * The bar of the hospitals' pages (the choice of hospital, รพ.ท่าฉลอม's plan): the mark, the page's heading, a way back
 * when there is one, and the account menu, as the board's bar has them.
 */
export function PlaceBar({
  eyebrow,
  title,
  back = null,
  account,
}: {
  eyebrow: string;
  title: string;
  /** The page a back arrow goes to, with its name (shown beside the arrow from 640px). */
  back?: { href: string; label: string } | null;
  account: Account;
}) {
  return (
    <header className="appbar z-30">
      <div className="mx-auto flex w-full max-w-[120rem] items-center gap-3 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 sm:px-6 sm:pt-[max(0.625rem,env(safe-area-inset-top))] sm:pb-2.5">
        <Link href={PLACES_PATH} className="flex min-h-11 shrink-0 items-center rounded-xl" aria-label="ORSKH.APP หน้าแรก">
          <BrandMark className="h-10 w-10 rounded-xl transition-[filter] hover:brightness-115" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs leading-5 font-medium text-muted" data-testid="place-eyebrow">
            {eyebrow}
          </p>
          <h1 className="truncate text-[0.9375rem] leading-6 font-bold text-ink min-[400px]:text-base sm:text-lg" data-testid="place-title">
            {title}
          </h1>
        </div>
        {back ? (
          <Link href={back.href} className="btn btn-ghost shrink-0 px-3 text-sm sm:px-3.5" aria-label={back.label} data-testid="place-back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="hidden sm:inline">{back.label}</span>
          </Link>
        ) : null}
        <AccountMenu name={account.name} role={account.role} phone={account.phone} image={account.image} />
      </div>
    </header>
  );
}
