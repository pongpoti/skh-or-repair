import type { DatePick } from "@/components/board-date-picker";
import { DaySwipe } from "@/components/day-swipe";
import { RoomPill, type RoomPillPart } from "@/components/room-pill";
import { THA_CHALOM_PATH } from "@/lib/places";
import { openRooms, thaChalomDay, usageText, type ThaChalomRoomDay, type ThaChalomUse } from "@/lib/tha-chalom-schedule";
import { ThaChalomPlan } from "@/components/tha-chalom-plan";

/** A free half's badge: the plan's light floor, with dark text. */
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
 * รพ.ท่าฉลอม's day (Pong, 26 Nov 2026: the hospital's weekly table, lib/tha-chalom-schedule.ts), laid out as รพ.สมุทรสาคร's
 * board is (Pong, 27 Nov 2026: "Arrange component of ท่าฉลอม exact same as สมทุรสาคร"; components/suite-board.tsx): the
 * floor plan alone on a phone, each OR in its department's colour, which a sideways swipe moves to the workday before or
 * after; from 1024px the list of the day's open rooms beside it, on the same glass card as รพ.สมุทรสาคร's ห้องที่เปิด, the
 * Scope room among them on the days it is in use. No cases and no bookings yet: nothing on it
 * is tapped.
 */
export function ThaChalomBoard({ date, pick, pathname = THA_CHALOM_PATH }: { date: string; pick: DatePick | null; pathname?: string }) {
  const day = thaChalomDay(date);
  const open = openRooms(day);
  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-[120rem] flex-1 flex-col overflow-hidden sm:px-3 lg:flex-row lg:gap-6 lg:px-6 lg:pt-3 lg:pb-4">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:overflow-visible">
          <DaySwipe day={date} pick={pick} pathname={pathname} className="flex min-h-0 flex-1 overflow-hidden p-1 lg:p-0">
            {/* Filling the box as รพ.สมุทรสาคร's plan does, with the same margins (globals.css .tc-plan). */}
            <ThaChalomPlan day={day} className="tc-plan" />
          </DaySwipe>
        </div>
        <aside
          aria-labelledby="tc-rooms-heading"
          className="room-sheet hidden min-h-0 flex-col overflow-hidden lg:static lg:flex lg:h-full lg:w-[26rem] lg:shrink-0 xl:w-[30rem] 2xl:w-[34rem]"
          data-testid="tc-rooms"
        >
          <div className="shrink-0 border-b border-line px-5 pt-4 pb-3.5">
            <div className="flex min-h-11 items-center gap-2.5">
              <h2 id="tc-rooms-heading" className="text-xl leading-snug font-bold text-ink">
                ห้องที่เปิด
              </h2>
              <span className="count-tag" data-testid="tc-open-count">
                <span className="tabular-nums">{open.length}</span> ห้อง
              </span>
            </div>
            {/* The hospital's table is for office hours only. */}
            <p className="mt-0.5 text-sm text-muted">เฉพาะในเวลาราชการ</p>
          </div>
          {open.length > 0 ? (
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5">
              {open.map((entry) => (
                <li key={entry.room.id} className="flex min-w-0 items-center gap-3 px-5 py-2.5" data-testid="tc-room" data-room={entry.room.id}>
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
          ) : (
            <p className="flex flex-1 items-center justify-center px-8 text-center text-sm font-medium text-muted">ไม่มีห้องที่เปิด</p>
          )}
        </aside>
      </div>
    </main>
  );
}
