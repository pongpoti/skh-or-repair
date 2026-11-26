/**
 * รพ.ท่าฉลอม's OR suite, floor 5, as Pong drew it (26 Nov 2026, "Below is SVG layout of OR ท่าฉลอม ... Just simply show
 * layout. Do nothing for now"): four ORs round the corridor, the scrub areas (gridded), the small rooms and the sterile
 * supply. Nothing on it is tapped yet. The colours are the board's plan's own (globals.css .tcp-*); the classes are
 * prefixed, so the drawing's names (room, frame) never meet the app's.
 */

type Or = { id: string; number: string; d: string; x: number; ringY: number };

/** Each OR: its chamfered outline, and where its number sits (the white ring, the number, OR under it). */
const ORS: readonly Or[] = [
  { id: "or-1", number: "1", d: "M153,62 H262 L280,80 V219 L262,237 H153 L135,219 V80 Z", x: 207.5, ringY: 131.5 },
  { id: "or-2", number: "2", d: "M401,62 H504 L522,80 V227 L504,245 H401 L383,227 V80 Z", x: 452.5, ringY: 135.5 },
  { id: "or-3", number: "3", d: "M544,62 H666 L684,80 V227 L666,245 H544 L526,227 V80 Z", x: 605, ringY: 135.5 },
  { id: "or-4", number: "4", d: "M514,358 H670 L688,376 V492 L670,510 H514 L496,492 V376 Z", x: 592, ringY: 416 },
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

export function ThaChalomPlan({ className }: { className?: string }) {
  return (
    <svg
      viewBox="104.5 31.5 614 578.25"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label="แปลนห้องผ่าตัด รพ.ท่าฉลอม ชั้น 5: ห้องผ่าตัด 1 ถึง 4"
      data-testid="tha-chalom-plan"
    >
      <defs>
        <pattern id="tcp-grid" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#fbf7f1" />
          <path d="M8 0H0V8" fill="none" stroke="#e3dace" strokeWidth="1" />
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
        <g key={or.id} className="tcp-or" data-room={or.id}>
          <path className="tcp-or-shape" d={or.d} />
          <circle className="tcp-or-ring" cx={or.x} cy={or.ringY} r="30" />
          <text className="tcp-or-num" x={or.x} y={or.ringY + 12.2}>
            {or.number}
          </text>
          <text className="tcp-or-label" x={or.x} y={or.ringY + 58}>
            OR
          </text>
        </g>
      ))}
    </svg>
  );
}
