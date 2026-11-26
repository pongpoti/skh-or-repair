import Link from "next/link";
import { PlaceTabLabel } from "@/components/place-tab-label";
import { PLACES, placeHref, type PlaceId } from "@/lib/places";

/** Which hospital a board is (and, on the dev previews, where each hospital's board is). */
export type PlaceSwitch = { current: PlaceId; hrefs?: Partial<Record<PlaceId, string>> };

/**
 * The two hospitals in the boards' bar (Pong, 26 Nov 2026: "Try create seamless navigation between 2 places"): one tap
 * on the other hospital opens its board on the same day, with no stop at the choice of hospital. The board's own
 * hospital is the lit one. Under the bar's first line on a phone, beside the date from 1024px.
 */
export function PlaceTabs({ current, hrefs, pickedDate, className = "" }: PlaceSwitch & { pickedDate: string | null; className?: string }) {
  return (
    <nav aria-label="โรงพยาบาล" className={`place-tabs ${className}`} data-testid="place-tabs">
      {PLACES.map((place) =>
        place.id === current ? (
          <span key={place.id} className="place-tab" aria-current="page" data-place={place.id} data-testid="place-tab">
            {place.name}
          </span>
        ) : (
          <Link key={place.id} href={placeHref(hrefs?.[place.id] ?? place.href, pickedDate)} className="place-tab" data-place={place.id} data-testid="place-tab">
            <PlaceTabLabel>{place.name}</PlaceTabLabel>
          </Link>
        ),
      )}
    </nav>
  );
}
