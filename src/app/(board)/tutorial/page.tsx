import { redirect } from "next/navigation";
import { Tutorial } from "@/components/tutorial";
import { addDays, BOOK_AHEAD_DAYS, earliestBookingDay } from "@/lib/added-cases";
import { isAdmin } from "@/lib/admin";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { doctorFor } from "@/lib/cases";
import { bangkokParts, now } from "@/lib/clock";
import { db } from "@/lib/db";
import { holidaysBetween } from "@/lib/holidays";
import { currentRepairPeriods } from "@/lib/repair-store";
import { practiceSubtype } from "@/lib/tutorial";
import { fullName } from "@/lib/user-list";

export const dynamic = "force-dynamic";

/**
 * The doctors' tutorial (Pong, 19 Nov 2026: "interactive tutorial guide with dummy example (just like start of mobile
 * game app) ... for DR role only"): the real board on a made-up day, the first day the doctor could book, with the coach
 * walking through it (components/tutorial.tsx). A doctor's first visit to the board comes here once (?first=1); the
 * account menu's วิธีใช้งาน opens it again. Admins may look at it too, as a made-up general surgeon when they are not a
 * doctor. Nothing on this page reads or writes a real case.
 */
export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const admin = isAdmin(user.sub);
  let doctor: { name: string; subtype: string | null } | null = null;
  try {
    const found = await doctorFor(await db(), user);
    if (found) doctor = { name: fullName(found), subtype: found.subtype };
  } catch (error) {
    console.error("[tutorial] doctor lookup failed:", (error as Error).message);
  }
  if (!doctor && !admin) redirect("/");
  const profile = await profileFor(user, user.name);
  const [periods, { date: today, minutes }] = await Promise.all([currentRepairPeriods(), Promise.resolve(bangkokParts(now()))]);
  const { holidays, unlisted } = await holidaysBetween(today, addDays(today, BOOK_AHEAD_DAYS));
  // The made-up day is the first day the doctor could book, the day the booking form starts on.
  const day = earliestBookingDay(today, minutes, holidays);
  const name = doctor?.name ?? profile.name;
  const subtype = practiceSubtype(doctor?.subtype ?? "GENSX", day, periods);

  return (
    <Tutorial
      first={params.first === "1" && doctor !== null}
      doctor={{ name, subtype }}
      ownSubtype={doctor?.subtype ?? null}
      profile={{ name: profile.name, role: profile.role, image: user.picture ?? null }}
      today={today}
      day={day}
      holidays={holidays}
      unlisted={unlisted}
      periods={periods}
    />
  );
}
