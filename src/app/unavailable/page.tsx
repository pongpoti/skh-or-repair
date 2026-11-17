import type { Metadata } from "next";
import { OutageLanding } from "@/components/outage-landing";
import { safeNextPath } from "@/lib/security";
import { isOutagePage, outageReason } from "@/lib/unavailable";

export const metadata: Metadata = { title: "ระบบขัดข้องชั่วคราว" };

/**
 * Where a server, database or connection error sends the user (Pong, 17 Nov 2026): /unavailable?reason=server|network
 * &from=/path (lib/unavailable.ts). No session and no database: it must open while they are down (src/proxy.ts lets
 * it through without signing in).
 */
export default async function UnavailablePage({ searchParams }: { searchParams: Promise<{ reason?: string; from?: string }> }) {
  const params = await searchParams;
  const back = safeNextPath(params.from);
  return <OutageLanding reason={outageReason(params.reason)} retryHref={isOutagePage(back) ? "/" : back} />;
}
