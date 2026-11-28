import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminBar } from "@/components/admin-bar";
import { BookingLog } from "@/components/booking-log";
import { isAdmin } from "@/lib/admin";
import { displayNameFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { avatarSrc } from "@/lib/avatar";
import type { LogEntry } from "@/lib/booking-log";
import { loadBookingLog } from "@/lib/booking-log-store";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ประวัติการจอง · ORSKH.APP" };

/**
 * The admin's booking log (Pong, 28 Nov 2026: "Create logged booking cases dashboard, opened from admin profile"): every
 * booking made on the board or by the calendar API at both hospitals, who booked it and when, and what happened to it
 * since (components/booking-log.tsx). Opened from the account menu on the board; admins only (the proxy's /admin gate
 * answers 404 to anyone else, and so does this page).
 */
export default async function BookingLogPage() {
  const user = await requireUser();
  if (!isAdmin(user.sub)) notFound();

  const [name, log] = await Promise.all([
    displayNameFor(user, user.name),
    db()
      .then((pool) => loadBookingLog(pool))
      .catch((error: unknown) => {
        console.error("[booking-log] read failed:", error instanceof Error ? error.message : error);
        return null;
      }),
  ]);
  const entries: LogEntry[] | null = log?.entries ?? null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="ประวัติการจอง" name={name} image={avatarSrc(user.picture)} />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-5xl">
          <BookingLog entries={entries} truncated={log?.truncated ?? false} />
        </div>
      </main>
    </div>
  );
}
