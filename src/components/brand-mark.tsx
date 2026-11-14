/**
 * The app's mark: an OR surgeon in scrub cap, surgical mask and scrubs on the brown tile. Size and corner radius come
 * from className; the drawing scales with the tile, which clips the shoulders. src/app/icon.svg, apple-icon.png and
 * favicon.ico are the same drawing.
 */
export function BrandMark({ className = "h-9 w-9 rounded-[10px]" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`logo-mark ${className}`}>
      <Surgeon className="h-full w-full" />
    </span>
  );
}

const SCRUBS = "#7fbfb7";
const MASK = "#eaf4f5";
const PLEAT = "#a7c9cf";

export function Surgeon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} focusable="false">
      {/* scrubs with a V-neck */}
      <path d="M7 48 C7.5 40.5 14 37 24 37 C34 37 40.5 40.5 41 48 Z" fill={SCRUBS} />
      <path d="M19.5 37.4 L24 43 L28.5 37.4 Z" fill="var(--brand)" opacity="0.55" />
      {/* face */}
      <circle cx="24" cy="24" r="10.6" fill="var(--brand-tint)" />
      {/* scrub cap */}
      <path d="M12.9 22.6 C12.2 9.8 35.8 9.8 35.1 22.6 Q24 19.6 12.9 22.6 Z" fill={SCRUBS} />
      {/* eyes */}
      <circle cx="20.2" cy="23.6" r="1.25" fill="var(--ink)" />
      <circle cx="27.8" cy="23.6" r="1.25" fill="var(--ink)" />
      {/* surgical mask with pleats */}
      <path d="M13.8 26 Q24 24.4 34.2 26 L33.2 30.6 Q24 37.2 14.8 30.6 Z" fill={MASK} />
      <path
        d="M17 28.3 Q24 27.4 31 28.3 M17.6 30.6 Q24 29.8 30.4 30.6"
        fill="none"
        stroke={PLEAT}
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
