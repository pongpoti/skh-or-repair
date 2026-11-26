import type { CSSProperties } from "react";
import { readableTextOn } from "@/lib/allocation";

/** One part of a room's badge: a half day's name in its colour (`part` is เช้า or บ่าย in a split room). */
export type RoomPillPart = { part: string | null; color: string; name: string };

/**
 * A room's badge in a list of rooms (Pong, 18 Nov 2026: "merge room number & name", style A of the samples): one capsule,
 * the room's number ("OR 9", or "Scope") in a darker part of the first colour, then each part's name in its colour. A
 * room split between two departments shows เช้า and บ่าย parts. A name too long for the line ends in an ellipsis; the
 * badge's title holds it in full. Shared by both hospitals' boards (globals.css .room-pill).
 */
export function RoomPill({
  prefix,
  number,
  label,
  parts,
  testId,
}: {
  /** Small text before the number ("OR"), or none. */
  prefix: string | null;
  number: string;
  /** The room's name, read out in place of the prefix and number ("OR 9"). */
  label: string;
  parts: readonly RoomPillPart[];
  testId?: string;
}) {
  const title = parts.map(({ part, name }) => (part ? `${part} ${name}` : name)).join(" · ");
  return (
    <span
      className={`room-pill ${parts.length > 1 ? "room-pill-split" : ""}`}
      title={`${label} · ${title}`}
      style={{ "--room": parts[0].color, "--room-pm": parts[parts.length - 1].color } as CSSProperties}
      data-testid={testId}
    >
      <span className="room-pill-no" style={{ color: readableTextOn(parts[0].color) }} aria-hidden>
        {prefix ? <span className="room-pill-or">{prefix}</span> : null}
        {number}
      </span>
      <span className="sr-only">{label}</span>
      {parts.map(({ part, color, name }) => (
        <span key={part ?? "day"} className="room-pill-dept" style={{ color: readableTextOn(color) }}>
          {part ? <span className="room-pill-part">{part}</span> : null}
          <span className="room-pill-name">{name}</span>
        </span>
      ))}
    </span>
  );
}
