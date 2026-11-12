/**
 * The app's mark: an operating-room surgical light (ceiling mount, jointed arm and a lamp head of seven light cells) on
 * the brown tile. Size and corner radius come from className; the drawing scales with the tile. src/app/icon.svg,
 * apple-icon.png and favicon.ico are the same drawing.
 */
export function BrandMark({ className = "h-9 w-9 rounded-[10px]" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`logo-mark ${className}`}>
      <SurgicalLight className="h-full w-full" />
    </span>
  );
}

const CX = 21;
const CY = 28;
/** The six outer light cells, 7.4 units from the centre at 60 degree steps. */
const RING = [0, 60, 120, 180, 240, 300].map((deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [Math.round((CX + 7.4 * Math.cos(a)) * 100) / 100, Math.round((CY + 7.4 * Math.sin(a)) * 100) / 100] as const;
});

export function SurgicalLight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} focusable="false">
      <rect x="34" y="6" width="10" height="2.8" rx="1.4" fill="var(--accent-light)" />
      <path
        d="M39 8 V13 L30.5 19"
        fill="none"
        stroke="var(--accent-light)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="39" cy="13" r="2" fill="var(--accent-light)" />
      <circle cx={CX} cy={CY} r="13" fill="var(--brand-tint)" stroke="var(--accent-light)" strokeWidth="1.8" />
      <g fill="#fff" stroke="#b8976b" strokeWidth="0.9">
        <circle cx={CX} cy={CY} r="3.4" />
        {RING.map(([x, y]) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r="2.8" />
        ))}
      </g>
    </svg>
  );
}
