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
import { BOARD_PATH } from "@/lib/places";
import { currentRepairPeriods } from "@/lib/repair-store";
import { practiceSubtype, tutorialBack, type TutorialAudience } from "@/lib/tutorial";
import { boardViewer } from "@/lib/roles";
import { fullName } from "@/lib/user-list";

export const dynamic = "force-dynamic";

/**
 * The doctors' tutorial (Pong, 19 Nov 2026: "interactive tutorial guide with dummy example (just like start of mobile
 * game app) ... for DR role only"): the real board on a made-up day, the first day the doctor could book, with the coach
 * walking through it (components/tutorial.tsx). A doctor's first visit to the board comes here once (?first=1); the
 * account menu's วิธีใช้งาน opens it again. Admins may look at it too, as a made-up general surgeon when they are not a
 * doctor. Nothing on this page reads or writes a real case.
 *
 * Everyone else (RN, PN, PCA and MX) gets the staff's version (Pong, 27 Nov 2026: "Create tutorial for non-DR users,
 * similar to DR except booking"): the same day with no booking, which the board opens on their first visit, once, as a
 * doctor's (?first=1, with ?back=tha-chalom when sent from รพ.ท่าฉลอม's board; the same evening Pong turned it from every
 * app open to once: "Disable always-on"). An admin sees it with ?as=staff.
 */
export default async function TutorialPage({ searchParams }: { searchParams: Promise<{ first?: string; back?: string; as?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const admin = isAdmin(user.sub);
  let doctor: { id: string; name: string; subtype: string | null } | null = null;
  // The users.id the first visit notes as seen (lib/tutorial-store.ts), for the staff too.
  let userId: string | null = null;
  let mx = false;
  let failed = false;
  try {
    const pool = await db();
    const [found, viewer] = await Promise.all([doctorFor(pool, user), boardViewer(pool, user)]);
    if (found) doctor = { id: String(found.id), name: fullName(found), subtype: found.subtype };
    // MX sees every HN on the board (lib/roles.ts); an admin does too, but looks at the staff's version as RN, PN or PCA.
    mx = viewer.allHn && !admin;
    userId = viewer.userId;
  } catch (error) {
    failed = true;
    console.error("[tutorial] doctor lookup failed:", (error as Error).message);
  }
  // A failed lookup is not taken for a member of staff: the board, which has its own outage page.
  if (failed && !admin) redirect(BOARD_PATH);
  const audience: TutorialAudience = doctor ? (admin && params.as === "staff" ? "staff" : "doctor") : admin && params.as !== "staff" ? "doctor" : "staff";
  const back = tutorialBack(params.back);
  const profile = await profileFor(user, user.name);
  const [periods, { date: today, minutes }] = await Promise.all([currentRepairPeriods(), Promise.resolve(bangkokParts(now()))]);
  const { holidays, unlisted } = await holidaysBetween(today, addDays(today, BOOK_AHEAD_DAYS));
  // The made-up day is the first day the doctor could book, the day the booking form starts on.
  const day = earliestBookingDay(today, minutes, holidays);
  const name = doctor?.name ?? profile.name;
  const subtype = audience === "staff" ? practiceSubtype("GENSX", day, periods) : practiceSubtype(doctor?.subtype ?? "GENSX", day, periods);
  const staffFirst = audience === "staff" && !doctor && !admin && params.first === "1";

  return (
    <Tutorial
      audience={audience}
      mx={mx}
      back={back}
      first={audience === "staff" ? staffFirst : params.first === "1" && doctor !== null}
      seenKey={audience === "staff" ? (staffFirst ? userId : null) : (doctor?.id ?? null)}
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
