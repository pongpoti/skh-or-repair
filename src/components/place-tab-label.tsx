"use client";

import { useLinkStatus } from "next/link";

/**
 * The other hospital's name in the bar's switch, lit at once on a tap while its board loads (useLinkStatus), so the
 * switch answers the finger before the new page is there.
 */
export function PlaceTabLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className="place-tab-label" data-pending={pending ? "true" : undefined}>
      {children}
    </span>
  );
}
