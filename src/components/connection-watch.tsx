"use client";

import { useState } from "react";
import { OutageLanding } from "@/components/outage-landing";
import { useHere, useOnline } from "@/components/use-connection";

/**
 * Lost connection (Pong, 17 Nov 2026): once the device goes offline, the outage landing for "network" covers the page (a
 * new page cannot be loaded without a connection, so it is shown in place rather than by going to /unavailable). It
 * stays until the landing reloads the page when the device is back online, so what the page shows is current again.
 */
export function ConnectionWatch() {
  const online = useOnline();
  const here = useHere();
  const [covered, setCovered] = useState(false);
  // Latched (React's "adjust state while rendering"): coming back online must not unmount the landing before it
  // reloads the page.
  if (!online && !covered) setCovered(true);
  if (!covered) return null;
  return (
    <div className="fixed inset-0 z-[1000] bg-canvas" data-testid="offline-cover">
      <OutageLanding reason="network" retryHref={here} />
    </div>
  );
}
