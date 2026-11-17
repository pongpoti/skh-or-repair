/**
 * "No HOSxP table yet" (Pong, 16 Nov 2026): a database filled solid white, with one slash across it for "not working",
 * outlined in the red of an alert (Pong, 17 Nov 2026: "red alert theme"; it was black). The notice badge, its bubble and the header of each OR room card show it. The database is
 * Lucide's (https://lucide.dev, ISC licence, Copyright (c) Lucide Contributors); the slash has a white edge so it reads
 * apart from the outline it crosses.
 */
export function NoTableIcon({ size = 16, label }: { size?: number; label?: string }) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#c62828"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="no-table-icon"
      data-icon="no-table"
      {...a11y}
    >
      {label ? <title>{label}</title> : null}
      <path d="M3 5V19A9 3 0 0 0 21 19V5" fill="#fff" />
      <path d="M3 12A9 3 0 0 0 21 12" />
      <ellipse cx="12" cy="5" rx="9" ry="3" fill="#fff" />
      <path d="M2.5 2.5 21.5 21.5" stroke="#fff" strokeWidth="5" />
      <path d="M2.5 2.5 21.5 21.5" />
    </svg>
  );
}
