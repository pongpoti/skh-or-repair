import type { DatePick } from "@/components/board-date-picker";
import { DaySwipe } from "@/components/day-swipe";
import { RoomPill, type RoomPillPart } from "@/components/room-pill";
import { THA_CHALOM_PATH } from "@/lib/places";
import { openRoomCount, thaChalomDay, usageText, type ThaChalomRoomDay, type ThaChalomUse } from "@/lib/tha-chalom-schedule";
import { ThaChalomPlan } from "@/components/tha-chalom-plan";

/** A free room's badge: the plan's light floor, with dark text. */
const FREE_COLOR = "#E6DCCF";
/** OR 3 under works: the board's closed-room taupe. */
const CLOSED_COLOR = "#B4A594";

function partOf(use: ThaChalomUse, part: string | null): RoomPillPart {
  const color = use.kind === "dept" ? use.dept.color : use.kind === "closed" ? CLOSED_COLOR : FREE_COLOR;
  return { part, color, name: usageText(use) };
}

function partsOf(entry: ThaChalomRoomDay): RoomPillPart[] {
  return entry.split ? [partOf(entry.am, "เช้า"), partOf(entry.pm, "บ่าย")] : [partOf(entry.am, null)];
}

/**
 * รพ.ท่าฉลอม's day (Pong, 26 Nov 2026: the hospital's weekly table, lib/tha-chalom-schedule.ts): the floor plan with each
 * OR in its department's colour, which a sideways swipe moves to the workday before or after as on รพ.สมุทรสาคร's board,
 * and the list of rooms with their departments, the Scope room included (it is not on the plan). The list sits under the
 * plan on a phone and beside it from 1024px, where รพ.สมุทรสาคร's board has its list of open rooms. No cases and no
 * bookings yet: nothing on it is tapped.
 */
export function ThaChalomBoard({ date, pick, pathname = THA_CHALOM_PATH }: { date: string; pick: DatePick | null; pathname?: string }) {
  const day = thaChalomDay(date);
  const open = openRoomCount(day);
  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
        <DaySwipe day={date} pick={pick} pathname={pathname} className="flex min-h-0 flex-1 overflow-hidden px-3 pt-3 pb-2 sm:px-6 sm:pt-5 lg:p-0">
          <ThaChalomPlan day={day} className="h-full max-h-full w-full max-w-[64rem]" />
        </DaySwipe>
        <section className="tc-rooms shrink-0 lg:flex lg:h-full lg:w-[26rem] lg:flex-col xl:w-[30rem] 2xl:w-[34rem]" aria-labelledby="tc-rooms-heading" data-testid="tc-rooms">
          <div className="flex items-center gap-2.5 px-4 pt-3 pb-1 sm:px-6 lg:border-b lg:border-line lg:px-5 lg:pt-4 lg:pb-3.5">
            <h2 id="tc-rooms-heading" className="text-base leading-snug font-bold text-ink lg:text-xl">
              ห้องผ่าตัด
            </h2>
            <span className="count-tag" data-testid="tc-open-count">
              เปิด <span className="tabular-nums">{open}</span> ห้อง
            </span>
            <span className="ml-auto text-xs text-muted lg:text-sm">เฉพาะในเวลาราชการ</span>
          </div>
          <ul className="grid grid-cols-1 gap-x-3 gap-y-1.5 px-4 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[560px]:grid-cols-2 sm:px-6 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-0 lg:overflow-y-auto lg:px-0 lg:py-1.5">
            {day.map((entry) => (
              <li key={entry.room.id} className="flex min-w-0 lg:px-5 lg:py-2.5" data-testid="tc-room" data-room={entry.room.id}>
                <RoomPill
                  prefix={entry.room.prefix}
                  number={entry.room.number}
                  label={entry.room.name}
                  parts={partsOf(entry)}
                  testId={`tc-pill-${entry.room.id}`}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
