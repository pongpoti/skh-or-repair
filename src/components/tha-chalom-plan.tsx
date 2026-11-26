import type { CSSProperties } from "react";
import { readableTextOn } from "@/lib/allocation";
import { roomDayText, type ThaChalomRoomDay, type ThaChalomUse } from "@/lib/tha-chalom-schedule";

/**
 * รพ.ท่าฉลอม's OR suite as Pong drew it (26 Nov 2026, "Below is SVG layout of OR ท่าฉลอม"): four ORs round the corridor,
 * the scrub areas (gridded), the small rooms and the sterile supply. Given a day of the weekly schedule
 * (lib/tha-chalom-schedule.ts), each OR takes its department's colour and label, as on รพ.สมุทรสาคร's plan: split
 * between morning (above) and afternoon (below) when they differ, the board's closed-room stripes for OR 3 while it is
 * turned into an intervention room, and plain for a room no one has (ว่าง). Without a day the ORs keep Pong's brown and
 * "OR". Nothing on it is tapped. The colours are the board's plan's own (globals.css .tcp-*); the classes are prefixed,
 * so the drawing's names (room, frame) never meet the app's.
 */

/**
 * One unit of this drawing in รพ.สมุทรสาคร's plan's units (components/floor-plan.tsx): Pong drew these ORs about 166
 * units across, รพ.สมุทรสาคร's are about 196. The board draws the plan at รพ.สมุทรสาคร's scale times this, so an OR here
 * is as big on the screen as one there (Pong, 27 Nov 2026: "Layout size of ท่าฉลอม is too large"; globals.css .tc-plan),
 * and the ring, number and label below are รพ.สมุทรสาคร's sizes divided by it, so they read the same too.
 */
const SKH_UNITS = 1.18;
/** รพ.สมุทรสาคร's ring 47 and number 56, or 36 and 44 in a short or split room; its department label 40. */
const RING = 47 / SKH_UNITS;
const RING_SMALL = 36 / SKH_UNITS;
const NUMBER = 56 / SKH_UNITS;
const NUMBER_SMALL = 44 / SKH_UNITS;
/** A room this much shorter than รพ.สมุทรสาคร's 191 takes the small ring, as its short OR 7 does (OR 4 here). */
const SHORT = 160;

type Or = {
  id: string;
  number: string;
  d: string;
  /** Where the number's ring sits, as drawn. */
  x: number;
  ringY: number;
  /** The OR's top and bottom edges, for the bands of a split room. */
  top: number;
  bottom: number;
};

/** Each OR: its chamfered outline, and where its number sits (the white ring, the number, its label under it). */
const ORS: readonly Or[] = [
  { id: "or-1", number: "1", d: "M153,62 H262 L280,80 V219 L262,237 H153 L135,219 V80 Z", x: 207.5, ringY: 131.5, top: 62, bottom: 237 },
  { id: "or-2", number: "2", d: "M401,62 H504 L522,80 V227 L504,245 H401 L383,227 V80 Z", x: 452.5, ringY: 135.5, top: 62, bottom: 245 },
  { id: "or-3", number: "3", d: "M544,62 H666 L684,80 V227 L666,245 H544 L526,227 V80 Z", x: 605, ringY: 135.5, top: 62, bottom: 245 },
  { id: "or-4", number: "4", d: "M514,358 H670 L688,376 V492 L670,510 H514 L496,492 V376 Z", x: 592, ringY: 416, top: 358, bottom: 510 },
];

/** The other rooms, as drawn: `grid` is a scrub area (the gridded floor). */
const ROOMS: readonly { x: number; y: number; w: number; h: number; grid?: true; id?: string }[] = [
  { x: 285, y: 62, w: 95, h: 46, grid: true },
  { x: 285, y: 110, w: 46, h: 64 },
  { x: 333, y: 110, w: 47, h: 64 },
  { x: 285, y: 176, w: 95, h: 78, grid: true, id: "scrub-1-2" },
  { x: 590, y: 256, w: 46, h: 98, grid: true, id: "scrub-3-4" },
  { x: 640, y: 256, w: 48, h: 74 },
  { x: 400, y: 358, w: 93, h: 76 },
  { x: 400, y: 437, w: 93, h: 73 },
  { x: 612, y: 514, w: 76, h: 66, id: "sterile-supply" },
  { x: 135, y: 290, w: 80, h: 58 },
  { x: 135, y: 352, w: 80, h: 48 },
  { x: 135, y: 404, w: 80, h: 56 },
  { x: 135, y: 465, w: 50, h: 45 },
  { x: 135, y: 513, w: 50, h: 50 },
  { x: 190, y: 465, w: 80, h: 98 },
];

/** A room no one has: the board's empty-room floor. */
const FREE_FILL = "var(--fp-or)";

/** A half's floor colour: the department's, the closed stripes, or the plain floor. */
function fillOf(use: ThaChalomUse): string {
  if (use.kind === "dept") return use.dept.color;
  return use.kind === "closed" ? "url(#tcp-closed)" : FREE_FILL;
}

/** The label under the number: the department's short label (ORTHO, VAS), ปรับปรุง, or ว่าง. */
function Label({ use, x, y }: { use: ThaChalomUse; x: number; y: number }) {
  if (use.kind === "dept") {
    return (
      <text className="tcp-or-dept" x={x} y={y} style={{ fill: readableTextOn(use.dept.color) }}>
        {use.dept.label}
      </text>
    );
  }
  return (
    <text className={use.kind === "closed" ? "tcp-or-thai tcp-closed-text" : "tcp-or-thai"} x={x} y={y}>
      {use.kind === "closed" ? "ปรับปรุง" : "ว่าง"}
    </text>
  );
}

/** The white ring with the room's number, as รพ.สมุทรสาคร's badge. */
function Ring({ or, y, small }: { or: Or; y: number; small: boolean }) {
  return (
    <>
      <circle className="tcp-or-ring" cx={or.x} cy={y} r={small ? RING_SMALL : RING} />
      <text className="tcp-or-num" x={or.x} y={y} dy="0.35em" style={{ fontSize: small ? NUMBER_SMALL : NUMBER }}>
        {or.number}
      </text>
    </>
  );
}

function OrRoom({ or, entry }: { or: Or; entry: ThaChalomRoomDay | null }) {
  if (!entry) {
    return (
      <g className="tcp-or" data-room={or.id}>
        <path className="tcp-or-shape" d={or.d} />
        <circle className="tcp-or-ring" cx={or.x} cy={or.ringY} r="30" />
        <text className="tcp-or-num" x={or.x} y={or.ringY + 12.2}>
          {or.number}
        </text>
        <text className="tcp-or-label" x={or.x} y={or.ringY + 58}>
          OR
        </text>
      </g>
    );
  }

  const state = entry.am.kind === "closed" ? "closed" : entry.am.kind === "free" && entry.pm.kind === "free" ? "free" : "open";
  const fill = entry.split ? `url(#tcp-split-${or.id})` : fillOf(entry.am);
  const middle = (or.top + or.bottom) / 2;
  // As on รพ.สมุทรสาคร's plan: a split room's small ring on the seam, half way down, with the morning's label above it
  // and the afternoon's below; otherwise the ring a little above the middle and the label under it (closer together in
  // a short room).
  const short = or.bottom - or.top < SHORT;
  const ringY = entry.split ? middle : middle - (short ? 30 : 36) / SKH_UNITS;
  const labelY = middle + (short ? 44 : 54) / SKH_UNITS;
  return (
    <g
      className={`tcp-or is-${state}${entry.split ? " is-split" : ""}`}
      data-room={or.id}
      data-state={state}
      role="img"
      aria-label={roomDayText(entry)}
      style={{ "--tcp-fill": fill } as CSSProperties}
    >
      {entry.split ? (
        <defs>
          <linearGradient id={`tcp-split-${or.id}`} x1="0" y1={or.top} x2="0" y2={or.bottom} gradientUnits="userSpaceOnUse">
            <stop offset="0.5" style={{ stopColor: entry.am.kind === "dept" ? entry.am.dept.color : FREE_FILL }} />
            <stop offset="0.5" style={{ stopColor: entry.pm.kind === "dept" ? entry.pm.dept.color : FREE_FILL }} />
          </linearGradient>
        </defs>
      ) : null}
      <path className="tcp-or-shape" d={or.d} />
      <Ring or={or} y={ringY} small={entry.split || short} />
      {entry.split ? (
        <>
          <Label use={entry.am} x={or.x} y={(or.top + ringY - RING_SMALL) / 2} />
          <Label use={entry.pm} x={or.x} y={(ringY + RING_SMALL + or.bottom) / 2} />
        </>
      ) : (
        <Label use={entry.am} x={or.x} y={labelY} />
      )}
    </g>
  );
}

/** The plan sits at the top of its box, as รพ.สมุทรสาคร's does (components/floor-plan.tsx), centred across it; .tc-plan sizes it. */
export function ThaChalomPlan({ className, day = null }: { className?: string; day?: readonly ThaChalomRoomDay[] | null }) {
  const byId = new Map((day ?? []).map((entry) => [entry.room.id as string, entry]));
  return (
    <svg
      viewBox="104.5 31.5 614 578.25"
      preserveAspectRatio="xMidYMin meet"
      className={className}
      role={day ? "group" : "img"}
      aria-label="แปลนห้องผ่าตัด รพ.ท่าฉลอม: ห้องผ่าตัด 1 ถึง 4"
      data-testid="tha-chalom-plan"
    >
      <defs>
        <pattern id="tcp-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#fbf7f1" />
          <path d="M8 0H0V8" fill="none" stroke="#e3dace" strokeWidth="1" />
        </pattern>
        {/* A room closed for works: the board's muted taupe stripes (floor-plan.tsx fp-closed), at this plan's scale. */}
        <pattern id="tcp-closed" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="var(--fp-closed)" />
          <line x1="0" y1="0" x2="0" y2="12" stroke="var(--fp-closed-line)" strokeWidth="3" />
        </pattern>
      </defs>
      <rect className="tcp-frame" x="108" y="35" width="607" height="571.25" rx="4" />
      <path className="tcp-corridor" d="M280,256 H688 V356 H398 V580 H280 Z" />
      {ROOMS.map((room) => (
        <rect
          key={`${room.x}-${room.y}`}
          id={room.id ? `tcp-${room.id}` : undefined}
          className={room.grid ? "tcp-grid-box" : "tcp-room"}
          x={room.x}
          y={room.y}
          width={room.w}
          height={room.h}
        />
      ))}
      {ORS.map((or) => (
        <OrRoom key={or.id} or={or} entry={day ? (byId.get(or.id) ?? null) : null} />
      ))}
    </svg>
  );
}
