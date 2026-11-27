"use client";

import type { CSSProperties } from "react";
import { FloorScenery } from "@/components/floor-scenery";
import {
  allocationFor,
  allocationText,
  DEPARTMENTS,
  INSTRUMENT_ROOM,
  readableTextOn,
  RECOVERY_ROOM,
  type Department,
  type RoomAllocation,
} from "@/lib/allocation";
import { INSTRUMENT_USE, RECOVERY_USE, repairOn, type RepairPeriods } from "@/lib/repair";
import { recoveryAreaClosed, roomBounds, roomLabel, roomOutline, ROOMS, roomUse, type Room, type RoomUse } from "@/lib/rooms";
import type { RoomMark } from "@/lib/schedule";

/** A room the schedule gives to no department: the list's "unknown department" gray. */
export const UNALLOCATED_FILL = DEPARTMENTS.UNK.color;

const MARK_LABEL: Record<Exclude<RoomMark, null>, string> = {
  active: "กำลังใช้งาน",
  delayed: "มีเคสเลื่อน",
};

/** Read out with a room whose cases do not match the bookings (lib/board-rows.ts flags). */
export const MISMATCH_LABEL = "ข้อมูลไม่ตรงกับการจอง";

/**
 * Where the repair zone's tag sits in each half: in a corridor inside the zone, clear of every room's number, so the
 * tag never hides what it explains. Large, as on the repair plan images (Pong, 15 Nov 2026), so the closed area reads
 * at a glance; a label it would cover moves below it (`RecoveryAreaLabel`).
 */
const ZONE_TAG: Record<1 | 2, { x: number; y: number; scale: number }> = {
  // First half: smaller, in the corridor between OR 2 to 4 and RR 2, which stays a recovery room outside the zone
  // (Pong, 27 Nov 2026), so the tag hides neither RR 2 nor the rooms' ปิด.
  1: { x: 603.5, y: 301, scale: 0.6 },
  2: { x: 603.5, y: 1275, scale: 1 },
};
const ZONE_TAG_WIDTH = 700;
const ZONE_TAG_HEIGHT = 150;
/** The tag's white outline, which adds half its width around the tag. */
const ZONE_TAG_OUTLINE = 8;

/** Every OR takes the colour of the department the schedule gives it that day, whether or not it has cases. */
function floorFill(room: Room, allocation: RoomAllocation | null): string | undefined {
  if (!allocation) return undefined;
  if (allocation.split) return `url(#fp-split-${room.id})`;
  return allocation.am?.color ?? UNALLOCATED_FILL;
}

/** Every department label is drawn at this size; the labels are five characters at most, so all fit the narrowest room. */
const DEPT_SIZE = 40;

/** Rough advance of a bold label glyph, in em: capitals are wide, lowercase and Thai are narrower. */
function advance(text: string): number {
  return /^[A-Z]+$/.test(text) ? 0.72 : 0.58;
}

/** Largest font size, up to `max`, at which `text` still fits `width`. */
function fitSize(text: string, width: number, max: number, min: number): number {
  return Math.max(min, Math.min(max, width / (advance(text) * text.length)));
}

function DeptText({
  x,
  y,
  dept,
  width,
}: {
  x: number;
  y: number;
  dept: Department | null;
  width: number;
}) {
  const text = dept ? dept.label : "ไม่จัดสรร";
  return (
    <text
      className="fp-dept"
      x={x}
      y={y}
      dy="0.35em"
      style={{ fontSize: dept ? DEPT_SIZE : fitSize(text, width, 34, 28), fill: readableTextOn(dept?.color ?? UNALLOCATED_FILL) }}
    >
      {text}
    </text>
  );
}

/**
 * Room number in a white badge, with the owning department(s) beside it, ปิด for a closed room, or RR (เครื่องมือ) for a
 * room used as a recovery room (the instrument room) during the ventilation repair.
 */
function RoomLabel({
  room,
  allocation,
  use,
  suiteOpen,
}: {
  room: Room;
  allocation: RoomAllocation | null;
  use: RoomUse;
  /** The suite runs a list today (not a weekend or holiday), so rooms take their colour. */
  suiteOpen: boolean;
}) {
  const { minX, maxX, minY, maxY } = roomBounds(room);
  const { labelX: x, labelY: y } = room;
  const width = maxX - minX - 48;

  if (use !== "open") {
    const short = maxY - minY < 170;
    const badgeY = y - (short ? 30 : 36);
    const closed = use === "closed";
    const text = closed ? "ปิด" : use === "instrument" ? INSTRUMENT_USE.label : RECOVERY_USE.label;
    return (
      <>
        <circle className="fp-badge" cx={x} cy={badgeY} r={short ? 36 : 47} />
        <text className="fp-label" x={x} y={badgeY} dy="0.35em" style={short ? { fontSize: 44 } : undefined}>
          {room.number}
        </text>
        <text
          className={closed ? "fp-dept fp-closed-text" : "fp-dept"}
          x={x}
          y={y + (short ? 44 : 54)}
          dy="0.35em"
          // A recovery room is mint with dark green text, the instrument room light tan, on working days; on a
          // closed day both are plain, like every room. The instrument room's Thai label is longer than a code, so it
          // is drawn at 34px, as on the repair plan images.
          style={{
            fontSize: use === "instrument" ? 34 : text.length > 5 ? fitSize(text, width, DEPT_SIZE, 28) : DEPT_SIZE,
            fill: closed ? undefined : !suiteOpen ? "var(--fp-ink)" : use === "recovery" ? RECOVERY_ROOM.ink : INSTRUMENT_ROOM.ink,
          }}
        >
          {text}
        </text>
      </>
    );
  }

  if (allocation?.split) {
    // Two bands (morning above, afternoon below) with the badge on the seam.
    const radius = 36;
    return (
      <>
        <DeptText x={x} y={(minY + (y - radius)) / 2} dept={allocation.am} width={width} />
        <DeptText x={x} y={(y + radius + maxY) / 2} dept={allocation.pm} width={width} />
        <circle className="fp-badge" cx={x} cy={y} r={radius} />
        <text className="fp-label" x={x} y={y} dy="0.35em" style={{ fontSize: 44 }}>
          {room.number}
        </text>
      </>
    );
  }

  // OR 7 is shorter than the others, so its badge and label sit closer together.
  const short = maxY - minY < 170;
  const badgeY = allocation ? y - (short ? 30 : 36) : y;
  return (
    <>
      <circle className="fp-badge" cx={x} cy={badgeY} r={short ? 36 : 47} />
      <text className="fp-label" x={x} y={badgeY} dy="0.35em" style={short ? { fontSize: 44 } : undefined}>
        {room.number}
      </text>
      {allocation ? (
        <DeptText x={x} y={y + (short ? 44 : 54)} dept={allocation.am} width={width} />
      ) : null}
    </>
  );
}

/** Live is a circle and delayed is a diamond, so the two differ by shape as well as by colour. */
function StatusMark({ kind, cx, cy }: { kind: Exclude<RoomMark, null>; cx: number; cy: number }) {
  if (kind === "active") return <circle className="fp-mark fp-mark-active" cx={cx} cy={cy} r={16} />;
  const d = 20;
  return <path className="fp-mark fp-mark-delayed" d={`M${cx} ${cy - d}L${cx + d} ${cy}L${cx} ${cy + d}L${cx - d} ${cy}Z`} />;
}

/**
 * A room with cases that do not match the bookings: an amber triangle with "!" in the corner the status mark leaves
 * free, a third shape, so it reads apart from both status marks without its colour.
 */
function MismatchMark({ cx, cy }: { cx: number; cy: number }) {
  // Small enough to stay clear of the number badge in the narrowest rooms (OR 10 and 11).
  const r = 19;
  return (
    <g className="fp-mismatch">
      <path className="fp-mark fp-mark-mismatch" d={`M${cx} ${cy - r}L${cx + r * 0.95} ${cy + r * 0.7}L${cx - r * 0.95} ${cy + r * 0.7}Z`} />
      <text className="fp-mismatch-text" x={cx} y={cy + 3} dy="0.35em">
        !
      </text>
    </g>
  );
}

/**
 * The area closed for the works in the running half (lib/repair.ts zone), drawn as on the repair plan images (Pong,
 * 15 Nov 2026): dark taupe stripes laid under the rooms, so the corridors and service rooms inside it go dark while the
 * closed rooms sit on top in their own muted stripes (`RepairZoneFill`); then, over the rooms, a dashed edge and a tag
 * saying what it is (`RepairZone`). Neither covers a room in use or takes clicks.
 */
function RepairZoneFill({ d }: { d: string }) {
  return <path className="fp-zone-fill" d={d} pointerEvents="none" aria-hidden="true" data-testid="repair-zone-fill" />;
}

function RepairZone({ half, d }: { half: 1 | 2; d: string }) {
  const { x, y, scale } = ZONE_TAG[half];
  const text = "พื้นที่ปิดซ่อม";
  const width = ZONE_TAG_WIDTH;
  const height = ZONE_TAG_HEIGHT;
  return (
    <g className="fp-zone" pointerEvents="none" aria-hidden="true" data-testid="repair-zone" data-half={half}>
      <path className="fp-zone-edge" d={d} />
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <rect className="fp-zone-tag" x={-width / 2} y={-height / 2} width={width} height={height} rx={height / 2} />
        <text className="fp-zone-text" x={0} y={0} dy="0.36em">
          {text}
        </text>
      </g>
    </g>
  );
}

/**
 * The part of the drawing (0 0 1207 1706, its frame 20 in from each edge) the board shows: the frame with 8 units around
 * it, so the plan is a little bigger on the screen, and centred in the room it has (Pong, 27 Nov 2026: "align layout
 * center and slight increase size", once the notice strip had moved into the hospital switch).
 */
const PLAN_VIEW_BOX = "12 12 1183 1682";

/**
 * ปิด on a recovery-area room the repair closes, RR on one it leaves open, as on the repair plan images. Where the
 * zone's tag would cover the label (RR 2 in the first half), the label moves just below the tag, inside the room.
 */
function RecoveryAreaLabel({
  room,
  closed,
  suiteOpen,
  half,
}: {
  room: Room;
  closed: boolean;
  suiteOpen: boolean;
  half: 1 | 2;
}) {
  const tag = ZONE_TAG[half];
  const halfWidth = ((ZONE_TAG_WIDTH + ZONE_TAG_OUTLINE) / 2) * tag.scale;
  const halfHeight = ((ZONE_TAG_HEIGHT + ZONE_TAG_OUTLINE) / 2) * tag.scale;
  const tagLeft = tag.x - halfWidth;
  const tagRight = tag.x + halfWidth;
  const tagTop = tag.y - halfHeight;
  const tagBottom = tag.y + halfHeight;
  // The label's glyphs reach about 0.85em above and 0.35em below its middle (Thai vowels sit high).
  const above = DEPT_SIZE * 0.85;
  const below = DEPT_SIZE * 0.35;
  const covered =
    room.labelX > tagLeft && room.labelX < tagRight && room.labelY - above < tagBottom && room.labelY + below > tagTop;
  const { maxY } = roomBounds(room);
  const moved = tagBottom + above + 4;
  const y = covered && moved + below < maxY ? moved : room.labelY;
  return (
    <text
      className={closed ? "fp-dept fp-closed-text" : "fp-dept"}
      x={room.labelX}
      y={y}
      dy="0.35em"
      style={{ fontSize: DEPT_SIZE, fill: closed ? undefined : suiteOpen ? RECOVERY_ROOM.ink : "var(--fp-ink)" }}
    >
      {closed ? "ปิด" : RECOVERY_USE.label}
    </text>
  );
}

export function FloorPlan({
  selectedId,
  marks,
  cases,
  date,
  day,
  periods,
  mismatches = {},
  onSelect,
}: {
  selectedId: string | null;
  marks: Record<string, RoomMark>;
  /** Number of cases in each room that day. */
  cases: Record<string, number>;
  /** Rows per room that do not match the bookings (lib/board-rows.ts mismatchByRoom). */
  mismatches?: Record<string, number>;
  /** The day whose allocation colours the rooms, or null when the suite is closed and no room is allocated. */
  date: string | null;
  /** The day that decides which rooms are open, closed or recovery rooms (today, even when the suite is closed). */
  day: string;
  /** The repair's dates (lib/repair-store.ts), which decide the rooms' use with `day`. */
  periods: RepairPeriods;
  onSelect: (id: string) => void;
}) {
  const uses: Record<string, RoomUse> = {};
  const allocations: Record<string, RoomAllocation | null> = {};
  for (const room of ROOMS) {
    if (room.kind !== "or") continue;
    uses[room.id] = roomUse(room, day, periods);
    // A closed room, or one used for recovery or instruments, belongs to no department.
    allocations[room.id] = date && uses[room.id] === "open" ? allocationFor(room.id, date, periods) : null;
  }
  // The works go on whatever the day, so the closed zone is drawn on a weekend or holiday too.
  const repair = repairOn(day, periods);

  return (
    <svg viewBox={PLAN_VIEW_BOX} preserveAspectRatio="xMidYMid meet" className="h-full w-auto max-w-none" role="group" aria-label="แปลนห้องผ่าตัด">
      <FloorScenery />
      <defs>
        {/* Closed rooms: muted taupe stripes, as on the repair plan images. */}
        <pattern id="fp-closed" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="28" height="28" fill="var(--fp-closed)" />
          <line x1="0" y1="0" x2="0" y2="28" stroke="var(--fp-closed-line)" strokeWidth="6" />
        </pattern>
        {/* The repair zone: wider, darker stripes the other way, under the rooms. */}
        <pattern id="fp-zone" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect className="fp-zone-bg" width="40" height="40" />
          <line className="fp-zone-stripe" x1="0" y1="0" x2="0" y2="40" strokeWidth="12" />
        </pattern>
        {ROOMS.map((room) => {
          const allocation = allocations[room.id];
          if (!allocation?.split) return null;
          return (
            <linearGradient key={room.id} id={`fp-split-${room.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.5" stopColor={allocation.am?.color ?? UNALLOCATED_FILL} />
              <stop offset="0.5" stopColor={allocation.pm?.color ?? UNALLOCATED_FILL} />
            </linearGradient>
          );
        })}
      </defs>
      {repair ? <RepairZoneFill d={repair.zone} /> : null}
      <g id="fp-rooms">
        {ROOMS.map((room) => {
          const selected = room.id === selectedId;
          const mark = marks[room.id];
          const use = uses[room.id];
          const selectable = use === "open";
          // A recovery-area room (RR 1, 2) inside the repair zone is closed like an OR, though it never opens anyway.
          const closed = use === "closed" || (room.kind === "recovery" && recoveryAreaClosed(room, day, periods));
          // An OR used as a recovery room during the repair: mint, labelled RR, and nothing to open. The instrument room
          // behaves the same way, light tan, labelled เครื่องมือ.
          const recovery = use === "recovery" || use === "instrument";
          // A recovery-area room the repair leaves open (RR 2 in the second half) is mint and labelled RR too, as on
          // the repair plan images (Pong, 15 Nov 2026). Outside the repair it keeps the service-area beige.
          const recoveryArea = room.kind === "recovery" && repair !== null && !closed;
          const allocation = allocations[room.id] ?? null;
          const empty = room.kind === "or" && (cases[room.id] ?? 0) === 0;
          // On a closed day (weekend, holiday) no room takes a colour, a recovery room included.
          const repairFill = use === "recovery" ? RECOVERY_ROOM.color : INSTRUMENT_ROOM.color;
          const fill = closed
            ? "url(#fp-closed)"
            : recovery
              ? date
                ? repairFill
                : undefined
              : recoveryArea
                ? date
                  ? RECOVERY_ROOM.color
                  : undefined
                : floorFill(room, allocation);
          const bounds = roomBounds(room);
          // An OR's corners are rounded (lib/rooms.ts roomOutline); the floor and its wall share the outline.
          const outline = roomOutline(room);
          const parts = [roomLabel(room)];
          if (allocation) parts.push(allocationText(allocation));
          if (empty) parts.push("ไม่มีเคส");
          if (mark && selectable) parts.push(MARK_LABEL[mark]);
          const mismatch = selectable && (mismatches[room.id] ?? 0) > 0;
          if (mismatch) parts.push(MISMATCH_LABEL);
          const staticLabel = closed
            ? `${roomLabel(room)} · ปิด`
            : recovery
              ? `${roomLabel(room)} · ${use === "instrument" ? INSTRUMENT_USE.name : RECOVERY_USE.name}`
              : recoveryArea
                ? `${roomLabel(room)} · ${RECOVERY_USE.name}`
                : undefined;
          return (
            <g
              key={room.id}
              id={room.id}
              data-zone={room.zone}
              data-use={use}
              className={`${room.kind === "or" ? "fp-or" : "fp-recovery"}${selected ? " is-selected" : ""}${selectable ? "" : " is-static"}${closed ? " is-closed" : ""}${recovery || recoveryArea ? " is-rr" : ""}`}
              style={fill ? ({ "--rf": fill } as CSSProperties) : undefined}
            >
              <path
                className="fp-floor"
                d={outline}
                tabIndex={selectable ? 0 : undefined}
                aria-pressed={selectable ? selected : undefined}
                aria-label={selectable ? parts.join(" · ") : staticLabel}
                aria-hidden={selectable || staticLabel ? undefined : true}
                role={selectable ? "button" : staticLabel ? "img" : undefined}
                onClick={selectable ? () => onSelect(room.id) : undefined}
                onKeyDown={
                  selectable
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(room.id);
                        }
                      }
                    : undefined
                }
              />
              {/* A closed recovery-area room takes the full wall, like a closed OR, as on the repair plan images. */}
              <path className={room.kind === "or" || closed ? "fp-wall" : "fp-wall fp-thin"} d={outline} pointerEvents="none" />
              {room.kind === "or" ? (
                <RoomLabel room={room} allocation={allocation} use={use} suiteOpen={date !== null} />
              ) : closed || recoveryArea ? (
                <RecoveryAreaLabel room={room} closed={closed} suiteOpen={date !== null} half={repair?.half ?? 1} />
              ) : null}
              {mark && selectable ? (
                <StatusMark
                  kind={mark}
                  cx={bounds.maxX - 34}
                  cy={allocation?.split ? (bounds.minY + bounds.maxY) / 2 : bounds.minY + 34}
                />
              ) : null}
              {mismatch ? (
                <MismatchMark cx={bounds.minX + 30} cy={allocation?.split ? (bounds.minY + bounds.maxY) / 2 : bounds.minY + 30} />
              ) : null}
            </g>
          );
        })}
      </g>
      <rect className="fp-wall fp-outer" x="20" y="20" width="1167" height="1666" pointerEvents="none" />
      {repair ? <RepairZone half={repair.half} d={repair.zone} /> : null}
    </svg>
  );
}
