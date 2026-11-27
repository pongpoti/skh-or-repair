import type { CSSProperties } from "react";
import { readableTextOn } from "@/lib/allocation";
import { roomDayText, type ThaChalomRoomDay, type ThaChalomUse } from "@/lib/tha-chalom-schedule";

/**
 * รพ.ท่าฉลอม's OR suite as Pong drew it (26 Nov 2026, "Below is SVG layout of OR ท่าฉลอม"), turned a quarter clockwise
 * (Pong, 27 Nov 2026: "Rotate ท่าฉลอม layout 90 degree clockwise"), so ORs 1 to 3 stand down the right and OR 4 at the
 * foot on the left: four ORs round the corridor, the Scope room (Pong, 27 Nov 2026), the scrub areas (gridded), the small
 * rooms and the sterile supply. A point (x, y) of Pong's drawing is at (641.25 − y, x) here; the text stays upright. Given a day of the weekly schedule
 * (lib/tha-chalom-schedule.ts), each OR takes its department's colour and label, as on รพ.สมุทรสาคร's plan: split
 * between morning (above) and afternoon (below) when they differ, the board's closed-room stripes for OR 3 while it is
 * turned into an intervention room, and plain for a room no one has (ว่าง). Without a day the ORs keep Pong's brown and
 * "OR". Nothing on it is tapped. The colours are the board's plan's own (globals.css .tcp-*); the classes are prefixed,
 * so the drawing's names (room, frame) never meet the app's.
 */

/**
 * One unit of this drawing on a phone, in รพ.สมุทรสาคร's plan's units (components/floor-plan.tsx): both plans fill the
 * screen's width there (Pong, 27 Nov 2026: "same screen margin like สมุทรสาคร"), this one 590.25 units wide, that one 1207,
 * each with its frame the same way in from the edge.
 */
const SKH_UNITS = 1207 / 590.25;
/**
 * The ring, number and labels a third bigger than รพ.สมุทรสาคร's on the screen, as Pong saw them when the ORs here were a
 * third bigger than there (27 Nov 2026): รพ.สมุทรสาคร's sizes divided by SCALE.
 */
const ZOOM = 4 / 3;
const SCALE = SKH_UNITS / ZOOM;
/** รพ.สมุทรสาคร's ring 47 and number 56, or 36 and 44 in a short or split room; its department label 40 (globals.css). */
const RING = 47 / SCALE;
const RING_SMALL = 36 / SCALE;
const NUMBER = 56 / SCALE;
const NUMBER_SMALL = 44 / SCALE;
/** A room shorter than this on a phone, in รพ.สมุทรสาคร's units, takes the small ring, as its short OR 7 does. */
const SHORT = 170;

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
  { id: "or-1", number: "1", d: "M422.25,135 H561.25 L579.25,153 V262 L561.25,280 H422.25 L404.25,262 V153 Z", x: 491.75, ringY: 189.5, top: 135, bottom: 280 },
  { id: "or-2", number: "2", d: "M414.25,383 H561.25 L579.25,401 V504 L561.25,522 H414.25 L396.25,504 V401 Z", x: 487.75, ringY: 434.5, top: 383, bottom: 522 },
  { id: "or-3", number: "3", d: "M414.25,526 H561.25 L579.25,544 V666 L561.25,684 H414.25 L396.25,666 V544 Z", x: 487.75, ringY: 587, top: 526, bottom: 684 },
  { id: "or-4", number: "4", d: "M149.25,496 H265.25 L283.25,514 V670 L265.25,688 H149.25 L131.25,670 V514 Z", x: 207.25, ringY: 574, top: 496, bottom: 688 },
];

/** The other rooms, as drawn: `grid` is a scrub area (the gridded floor). */
const ROOMS: readonly { x: number; y: number; w: number; h: number; grid?: true; id?: string }[] = [
  { x: 533.25, y: 285, w: 46, h: 95, grid: true },
  { x: 467.25, y: 285, w: 64, h: 46 },
  { x: 467.25, y: 333, w: 64, h: 47 },
  { x: 387.25, y: 285, w: 78, h: 95, grid: true, id: "scrub-1-2" },
  { x: 287.25, y: 590, w: 98, h: 46, grid: true, id: "scrub-3-4" },
  { x: 311.25, y: 640, w: 74, h: 48 },
  { x: 207.25, y: 400, w: 76, h: 93 },
  { x: 131.25, y: 400, w: 73, h: 93 },
  { x: 61.25, y: 612, w: 66, h: 76, id: "sterile-supply" },
  { x: 293.25, y: 135, w: 58, h: 80 },
  { x: 241.25, y: 135, w: 48, h: 80 },
  { x: 181.25, y: 135, w: 56, h: 80 },
  { x: 131.25, y: 135, w: 45, h: 50 },
  { x: 78.25, y: 135, w: 50, h: 50 },
];

/**
 * The Scope room, the square by the corridor's foot in Pong's drawing, at the top left once turned (Pong, 27 Nov 2026:
 * "The circle room is scope", circled on the plan): coloured by its department as the ORs, with "Scope" on a white tag
 * where an OR has its number.
 */
const SCOPE = { x: 78.25, y: 190, w: 98, h: 80 };
/** The tag's text and the department's label in the Scope room, smaller than an OR's: the room is half as wide. */
const SCOPE_TAG = 17;

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
  const short = (or.bottom - or.top) * SKH_UNITS < SHORT;
  const ringY = entry.split ? middle : middle - (short ? 30 : 36) / SCALE;
  const labelY = middle + (short ? 44 : 54) / SCALE;
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

function ScopeRoom({ entry }: { entry: ThaChalomRoomDay | null }) {
  const x = SCOPE.x + SCOPE.w / 2;
  const tagY = SCOPE.y + SCOPE.h * 0.36;
  const labelY = SCOPE.y + SCOPE.h * 0.72;
  const tag = (
    <>
      <rect className="tcp-scope-tag" x={x - 34} y={tagY - 12.5} width={68} height={25} rx={12.5} />
      <text className="tcp-scope-name" x={x} y={tagY} style={{ fontSize: SCOPE_TAG }}>
        Scope
      </text>
    </>
  );
  if (!entry) {
    return (
      <g className="tcp-scope" data-room="scope">
        <rect className="tcp-or-shape" x={SCOPE.x} y={SCOPE.y} width={SCOPE.w} height={SCOPE.h} />
        {tag}
      </g>
    );
  }
  const use = entry.am;
  const state = use.kind === "closed" ? "closed" : use.kind === "free" ? "free" : "open";
  return (
    <g
      className={`tcp-scope is-${state}`}
      data-room="scope"
      data-state={state}
      role="img"
      aria-label={roomDayText(entry)}
      style={{ "--tcp-fill": fillOf(use) } as CSSProperties}
    >
      <rect className="tcp-or-shape" x={SCOPE.x} y={SCOPE.y} width={SCOPE.w} height={SCOPE.h} />
      {tag}
      <Label use={use} x={x} y={labelY} />
    </g>
  );
}

/**
 * The plan fills its box as far as it can, at the top and centred across it, as รพ.สมุทรสาคร's does (components/floor-plan.tsx):
 * the whole width on a phone, the whole height beside the room list.
 */
export function ThaChalomPlan({ className, day = null }: { className?: string; day?: readonly ThaChalomRoomDay[] | null }) {
  const byId = new Map((day ?? []).map((entry) => [entry.room.id as string, entry]));
  return (
    <svg
      viewBox="25.5 98.5 590.25 626"
      preserveAspectRatio="xMidYMin meet"
      className={className}
      role={day ? "group" : "img"}
      aria-label="แปลนห้องผ่าตัด รพ.ท่าฉลอม: ห้องผ่าตัด 1 ถึง 4 และห้อง Scope"
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
      <rect className="tcp-frame" x="35" y="108" width="571.25" height="607" rx="4" />
      <path className="tcp-corridor" d="M385.25,280 V688 H285.25 V398 H61.25 V280 Z" />
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
      <ScopeRoom entry={day ? (byId.get("scope") ?? null) : null} />
    </svg>
  );
}
