import { notFound } from "next/navigation";
import { ThaChalomBoard } from "@/components/tha-chalom-board";
import { TopBar } from "@/components/top-bar";
import { boardDayAt, relationTo } from "@/lib/board-day";
import { thaChalomEyebrow, thaChalomPickedDay, thaChalomPickRange } from "@/lib/tha-chalom-schedule";

export const dynamic = "force-dynamic";

/**
 * รพ.ท่าฉลอม's board without signing in, in development only, as an invented nurse sees it: today's day by the real clock
 * (no holidays), or ?date=YYYY-MM-DD within the next 60 days.
 */
export default async function PreviewThaChalomPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const day = boardDayAt(new Date(), []);
  const range = thaChalomPickRange(day.today);
  const date = thaChalomPickedDay(params.date, day.today, []) ?? day.boardDate;
  const datePick = { today: day.today, current: day.boardDate, ...range, holidays: [], unlisted: [] };
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar
        date={date}
        eyebrow={thaChalomEyebrow(relationTo(date, day.today))}
        name="ปราณี สายบุญ"
        role="พยาบาล · ห้องผ่าตัด"
        phone="081-234-5678"
        image={null}
        pathname="/preview/tha-chalom"
        placesHref="/preview/places"
        datePick={datePick}
      />
      <ThaChalomBoard date={date} pick={datePick} pathname="/preview/tha-chalom" />
    </div>
  );
}
