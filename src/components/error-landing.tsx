"use client";

import { useEffect, useState } from "react";
import { OutageLanding } from "@/components/outage-landing";
import { useHere, useOnline } from "@/components/use-connection";
import { isOutagePage, unavailablePath } from "@/lib/unavailable";

/**
 * What app/error.tsx and app/global-error.tsx show (Pong, 17 Nov 2026): a page that failed to render goes to the outage
 * page /unavailable, instead of the framework's English error page. Offline, a new page cannot load, so the landing
 * for "network" shows in place and goes back by itself once online. The error itself is logged on the server.
 */
export function ErrorLanding({ error }: { error: Error & { digest?: string } }) {
  const online = useOnline();
  const here = useHere();
  // Latched like components/connection-watch.tsx: once offline, the network landing stays until it reloads the page.
  const [offline, setOffline] = useState(false);
  if (!online && !offline) setOffline(true);

  useEffect(() => {
    console.error("[error]", error.digest ?? error.message);
  }, [error]);

  useEffect(() => {
    if (!offline && navigator.onLine && !isOutagePage(here)) window.location.replace(unavailablePath("server", here));
  }, [offline, here]);

  return <OutageLanding reason={offline ? "network" : "server"} retryHref={isOutagePage(here) ? "/" : here} />;
}
