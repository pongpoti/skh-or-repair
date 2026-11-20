import type { CSSProperties } from "react";
import { MASK, PLEAT, SCRUBS } from "@/components/brand-mark";

/**
 * The tutorial's guide (Pong, 20 Nov 2026: "Create animated mascot surgeon display during tutorial"): the app's own
 * surgeon (components/brand-mark.tsx Surgeon, same drawing and colours) brought to life with gloved hands. It blinks,
 * sways, and its mask moves while it "talks" a bubble's text. It waves hello, points up at what to tap, and cheers with
 * both arms and happy eyes when a booking is made and at the end. All the movement is CSS (.mascot in globals.css), so
 * a new key restarts it, and with less motion asked for it holds still in its pose.
 */
export type MascotMood = "idle" | "talk" | "wave" | "point" | "cheer";

const GLOVE = "#a9d3ea";
const GLOVE_LINE = "#5e9cbf";
const SLEEVE_LINE = "#5c9f97";

/** A sleeve rising from below the tile to the wrist at (0, 0). */
function Sleeve() {
  return <path d="M-3.4 0.4 L-4.4 20 L4.4 20 L3.4 0.4 Z" fill={SCRUBS} stroke={SLEEVE_LINE} strokeWidth="0.5" strokeLinejoin="round" />;
}

/** An open gloved hand, palm out, thumb towards the body (negative x), from the wrist at (0, 0). */
function OpenHand() {
  return (
    <g className="m-hand-open">
      <path d="M-2.7 -2.4 Q-5.1 -3.2 -5 -5.3 Q-4.7 -6.5 -3.4 -5.7 L-2.8 -4.8 Z" fill={GLOVE} stroke={GLOVE_LINE} strokeWidth="0.45" strokeLinejoin="round" />
      <path d="M-2.6 0 L-2.9 -5.2 Q-3 -8.6 0 -8.8 Q3 -8.6 2.9 -5.2 L2.6 0 Z" fill={GLOVE} stroke={GLOVE_LINE} strokeWidth="0.45" strokeLinejoin="round" />
      <path d="M-1 -8.3 L-1 -5.8 M1 -8.3 L1 -5.8" fill="none" stroke={GLOVE_LINE} strokeWidth="0.45" strokeLinecap="round" />
      <rect x="-2.9" y="-0.7" width="5.8" height="1.6" rx="0.8" fill={GLOVE} stroke={GLOVE_LINE} strokeWidth="0.45" />
    </g>
  );
}

/** A gloved hand pointing up with its index finger, from the wrist at (0, 0). */
function PointingHand() {
  return (
    <g className="m-hand-point">
      <path d="M-2.7 -5.4 L-2.7 -11 Q-2.7 -12.4 -1.4 -12.4 Q-0.1 -12.4 -0.1 -11 L-0.1 -5.6 Z" fill={GLOVE} stroke={GLOVE_LINE} strokeWidth="0.45" strokeLinejoin="round" />
      <path d="M-2.7 0 L-2.9 -4.8 Q-2.9 -6.4 -1.3 -6.4 L1.6 -6.4 Q3 -6.4 3 -4.8 L2.7 0 Z" fill={GLOVE} stroke={GLOVE_LINE} strokeWidth="0.45" strokeLinejoin="round" />
      <path d="M0.1 -6.2 L0.1 -4.6 M1.6 -6.2 L1.6 -4.6" fill="none" stroke={GLOVE_LINE} strokeWidth="0.45" strokeLinecap="round" />
      <rect x="-2.9" y="-0.7" width="5.8" height="1.6" rx="0.8" fill={GLOVE} stroke={GLOVE_LINE} strokeWidth="0.45" />
    </g>
  );
}

export function Mascot({
  mood = "talk",
  look,
  talk = 10,
  className = "h-full w-full",
}: {
  mood?: MascotMood;
  /** Where the eyes go: up at a target above, down at one below. */
  look?: "up" | "down";
  /** How many times the mask moves while talking (an even number ends with it at rest). */
  talk?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={`mascot is-${mood}${look ? ` look-${look}` : ""} ${className}`}
      style={{ "--talk": talk } as CSSProperties}
      focusable="false"
      aria-hidden="true"
      data-mood={mood}
      data-testid="mascot"
    >
      <g className="m-figure">
        {/* scrubs with a V-neck, reaching below the tile so a jump never shows their hem */}
        <path d="M7 54 L7 48 C7.5 40.5 14 37 24 37 C34 37 40.5 40.5 41 48 L41 54 Z" fill={SCRUBS} />
        <path d="M19.5 37.4 L24 43 L28.5 37.4 Z" fill="var(--brand)" opacity="0.55" />
        <g className="m-head">
          {/* face */}
          <circle cx="24" cy="24" r="10.6" fill="var(--brand-tint)" />
          {/* scrub cap */}
          <path d="M12.9 22.6 C12.2 9.8 35.8 9.8 35.1 22.6 Q24 19.6 12.9 22.6 Z" fill={SCRUBS} />
          {/* eyes: open (they blink and look), or happy arcs when cheering */}
          <g className="m-eyes">
            <g className="m-eyes-open">
              <circle cx="20.2" cy="23.6" r="1.25" fill="var(--ink)" />
              <circle cx="27.8" cy="23.6" r="1.25" fill="var(--ink)" />
            </g>
            <path
              className="m-eyes-happy"
              d="M18.8 24.2 Q20.2 22.2 21.6 24.2 M26.4 24.2 Q27.8 22.2 29.2 24.2"
              fill="none"
              stroke="var(--ink)"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
          </g>
          {/* surgical mask with pleats: it moves as the surgeon talks */}
          <g className="m-mask">
            <path d="M13.8 26 Q24 24.4 34.2 26 L33.2 30.6 Q24 37.2 14.8 30.6 Z" fill={MASK} />
            <path d="M17 28.3 Q24 27.4 31 28.3 M17.6 30.6 Q24 29.8 30.4 30.6" fill="none" stroke={PLEAT} strokeWidth="0.8" strokeLinecap="round" />
          </g>
        </g>
        {/* arms: below the tile at rest, up to wave, point or cheer; the left one mirrored */}
        <g transform="translate(10.5 36) scale(-1 1)">
          <g className="m-arm m-arm-l">
            <Sleeve />
            <g className="m-hand">
              <OpenHand />
            </g>
          </g>
        </g>
        <g transform="translate(37.5 36)">
          <g className="m-arm m-arm-r">
            <Sleeve />
            <g className="m-hand">
              <OpenHand />
              <PointingHand />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}

/** How long the mascot talks for a bubble: about a mouth move per four characters, an even count, 6 to 18. */
export function talkFor(text: string): number {
  const count = Math.max(6, Math.min(18, Math.round(text.length / 4)));
  return count % 2 === 0 ? count : count + 1;
}
