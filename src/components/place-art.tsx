/**
 * The two hospitals' pictures on their cards (Pong, 26 Nov 2026: "Use distinct icon to represent each hospital (maybe
 * the main building of each one)"): drawn here, not photos, so they stay sharp and light. รพ.สมุทรสาคร is the large
 * provincial hospital, a tall tower between two wings on warm tan; รพ.ท่าฉลอม the smaller one at the river mouth, a long
 * low block by the water with a fishing boat, on sea green. Both share the app's ink and brown roof caps, so they read as
 * one set. Decorative: the card's text names the hospital.
 */

const INK = "#3f2f24";
const CAP = "#54402f";
const WALL = "#fffaf3";
const WALL_SIDE = "#efe4d4";
const CROSS = "#2f8a7e";

/** The hospital sign: a white plate with a green cross, on a roof. */
function Sign({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 9} y={y} width="18" height="14" rx="3" fill={WALL} stroke={INK} strokeWidth="1.4" />
      <path d={`M${x - 1.6} ${y + 3}h3.2v2.9h2.9v3.2h-2.9v2.9h-3.2v-2.9h-2.9v-3.2h2.9z`} fill={CROSS} />
    </g>
  );
}

/** A grid of windows: `cols` × `rows` panes of `w` × `h`, `gap` apart, from (x, y). */
function Windows({
  x,
  y,
  cols,
  rows,
  w,
  h,
  gapX,
  gapY,
  fill,
}: {
  x: number;
  y: number;
  cols: number;
  rows: number;
  w: number;
  h: number;
  gapX: number;
  gapY: number;
  fill: string;
}) {
  const panes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      panes.push(<rect key={`${r}-${c}`} x={x + c * (w + gapX)} y={y + r * (h + gapY)} width={w} height={h} rx="0.8" fill={fill} />);
    }
  }
  return <g>{panes}</g>;
}

function Tree({ x, y, r, shade = "#8fb38c" }: { x: number; y: number; r: number; shade?: string }) {
  return (
    <g>
      <rect x={x - 1} y={y} width="2" height={r * 0.9} fill="#8a6a50" />
      <circle cx={x} cy={y - r * 0.35} r={r} fill={shade} />
      <circle cx={x - r * 0.35} cy={y - r * 0.6} r={r * 0.45} fill="#a9c8a4" opacity="0.8" />
    </g>
  );
}

/** รพ.สมุทรสาคร: a ten-storey tower over its entrance, a lower wing either side, trees on the forecourt. */
export function SamutSakhonArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 100" className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="pa-skh-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#efdfc8" />
          <stop offset="1" stopColor="#f9f2e8" />
        </linearGradient>
      </defs>
      <rect width="200" height="100" fill="url(#pa-skh-sky)" />
      <circle cx="166" cy="24" r="11" fill="#f5d9ac" opacity="0.75" />
      {/* the forecourt */}
      <rect y="86" width="200" height="14" fill="#e7d6bf" />
      <path d="M0 86H200" stroke="#d3bfa4" strokeWidth="1" />

      {/* left wing */}
      <rect x="27" y="52" width="50" height="34" fill={WALL} stroke={INK} strokeWidth="1.5" />
      <rect x="25" y="48" width="54" height="5" rx="1" fill={CAP} />
      <Windows x={32} y={58} cols={5} rows={3} w={6} h={4.5} gapX={3.2} gapY={4.2} fill="#6b5444" />
      {/* right wing, a floor taller */}
      <rect x="123" y="44" width="50" height="42" fill={WALL} stroke={INK} strokeWidth="1.5" />
      <rect x="121" y="40" width="54" height="5" rx="1" fill={CAP} />
      <Windows x={128} y={50} cols={5} rows={4} w={6} h={4.5} gapX={3.2} gapY={4.2} fill="#6b5444" />

      {/* the tower */}
      <rect x="76" y="20" width="48" height="66" fill={WALL} stroke={INK} strokeWidth="1.5" />
      <rect x="116" y="20.75" width="7.25" height="64.5" fill={WALL_SIDE} />
      <rect x="73" y="15" width="54" height="6" rx="1" fill={CAP} />
      <Windows x={81} y={26} cols={4} rows={8} w={6.5} h={4} gapX={3.5} gapY={2.6} fill="#5e4a3c" />
      <Sign x={100} y={2} />
      {/* the entrance: a canopy over glass doors */}
      <rect x="84" y="76" width="32" height="10" fill="#bfdcd7" stroke={INK} strokeWidth="1.2" />
      <path d="M100 76V86" stroke={INK} strokeWidth="1" />
      <rect x="80" y="72.5" width="40" height="4" rx="1" fill={CAP} />

      <Tree x={14} y={80} r={7} />
      <Tree x={186} y={80} r={7.5} shade="#86ad86" />
    </svg>
  );
}

/** รพ.ท่าฉลอม: a long five-storey block with its stair tower, on the waterfront, a fishing boat going by. */
export function ThaChalomArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 100" className={className} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="pa-tc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d4ece7" />
          <stop offset="1" stopColor="#f0f8f5" />
        </linearGradient>
        <linearGradient id="pa-tc-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fc9c0" />
          <stop offset="1" stopColor="#6fb3a9" />
        </linearGradient>
      </defs>
      <rect width="200" height="100" fill="url(#pa-tc-sky)" />
      {/* gulls */}
      <path d="M22 22q3-3 6 0q3-3 6 0M44 14q2.2-2.2 4.4 0q2.2-2.2 4.4 0" fill="none" stroke="#5b7f79" strokeWidth="1.2" strokeLinecap="round" />

      {/* the block: ribbon windows on five floors */}
      <rect x="30" y="34" width="112" height="44" fill={WALL} stroke={INK} strokeWidth="1.5" />
      <rect x="27" y="29" width="118" height="6" rx="1" fill={CAP} />
      {[40, 47.5, 55, 62.5].map((y) => (
        <rect key={y} x="36" y={y} width="100" height="4.2" rx="0.8" fill="#4f948a" />
      ))}
      {[56, 76, 96, 116].map((x) => (
        <path key={x} d={`M${x} 39V67`} stroke={WALL} strokeWidth="1.6" />
      ))}
      {/* the entrance */}
      <rect x="72" y="69" width="28" height="9" fill="#bfdcd7" stroke={INK} strokeWidth="1.2" />
      <rect x="68" y="66" width="36" height="3.6" rx="1" fill={CAP} />
      {/* the stair tower, with the sign */}
      <rect x="142" y="24" width="24" height="54" fill={WALL} stroke={INK} strokeWidth="1.5" />
      <rect x="158.5" y="24.75" width="6.75" height="52.5" fill={WALL_SIDE} />
      <rect x="140" y="20" width="28" height="5" rx="1" fill={CAP} />
      <rect x="148" y="32" width="5" height="40" rx="1" fill="#bfdcd7" />
      <Sign x={154} y={6} />

      {/* the quay and the water */}
      <rect y="77" width="200" height="5" fill="#e3d4bf" />
      <path d="M0 77H200" stroke={INK} strokeWidth="1.2" />
      <rect y="82" width="200" height="18" fill="url(#pa-tc-sea)" />
      <path
        d="M0 88q5-2.4 10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0t10 0"
        fill="none"
        stroke="#e9f6f3"
        strokeWidth="1.2"
        opacity="0.8"
      />
      <path d="M6 95q5-2 10 0t10 0t10 0M128 95q5-2 10 0t10 0t10 0t10 0t10 0" fill="none" stroke="#e9f6f3" strokeWidth="1" opacity="0.6" />
      {/* a fishing boat */}
      <path d="M150 85H192L186 93H156Z" fill="#c45c3f" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M153 87.5H189.5" stroke={WALL} strokeWidth="1.2" />
      <rect x="168" y="78" width="12" height="7" rx="1" fill={WALL} stroke={INK} strokeWidth="1.2" />
      <path d="M162 85V68" stroke={INK} strokeWidth="1.2" />
      <path d="M162 68.5L170 71.5L162 74.5Z" fill="#e8b04b" />

      <Tree x={16} y={72} r={6.5} />
    </svg>
  );
}
