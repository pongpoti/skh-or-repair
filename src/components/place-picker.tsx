import Link from "next/link";
import { SamutSakhonArt, ThaChalomArt } from "@/components/place-art";
import { PLACES, type PlaceId } from "@/lib/places";

const ART: Record<PlaceId, (props: { className?: string }) => React.ReactNode> = {
  skh: SamutSakhonArt,
  "tha-chalom": ThaChalomArt,
};

/**
 * The two hospitals' cards (Pong, 26 Nov 2026: "display two place cards to allow user to first select place"): each a
 * picture of the hospital (components/place-art.tsx), its name and its ORs, the whole card one link. Pong, 26 Nov 2026:
 * "Place card size are inconsistent and too large": two small tiles side by side on every screen, the same size on a
 * phone as on a computer, in a column as wide as the sign-in card (24rem).
 */
export function PlacePicker() {
  return (
    <div className="flex min-h-full w-full flex-col">
      <div className="m-auto w-full max-w-[24rem] px-4 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <ul className="grid grid-cols-2 gap-3" data-testid="places">
          {PLACES.map((place) => {
            const Art = ART[place.id];
            return (
              <li key={place.id}>
                <Link href={place.href} className="place-card" data-testid="place-card" data-place={place.id}>
                  <span className="place-art">
                    <Art className="h-full w-full" />
                  </span>
                  <span className="flex items-center gap-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] leading-6 font-bold text-ink" data-testid="place-name">
                        {place.name}
                      </span>
                      <span className="block truncate text-xs leading-5 text-muted" data-testid="place-detail">
                        {place.detail}
                      </span>
                    </span>
                    <span className="place-go" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
