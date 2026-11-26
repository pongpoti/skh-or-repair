import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/top-bar";
import { PLACES_PATH } from "@/lib/places";

export type Account = { name: string; role: string | null; phone?: string; image: string | null };

/**
 * The bar of the choice of hospital: the mark, the page's heading and the account menu, as the boards' bar has them.
 */
export function PlaceBar({
  eyebrow,
  title,
  account,
}: {
  eyebrow: string;
  title: string;
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
        <AccountMenu name={account.name} role={account.role} phone={account.phone} image={account.image} />
      </div>
    </header>
  );
}
