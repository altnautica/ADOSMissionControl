"use client";

// Inline artificial horizon SVG, bound to live attitude from telemetry-store.
//
// `pitchDeg` and `rollDeg` are nullable on purpose. They used to default to 0,
// which meant that with no attitude telemetry the instrument drew a perfectly
// wings-level horizon — the one reading a pilot must never be shown when the
// aircraft's attitude is unknown. Absent attitude now raises a failure flag
// over a blanked ball, the way an EFIS does, so the instrument says it does
// not know rather than inventing straight and level.

export interface HorizonSvgProps {
  /** Live pitch in degrees, or null when attitude is unknown. */
  pitchDeg?: number | null;
  /** Live roll in degrees, or null when attitude is unknown. */
  rollDeg?: number | null;
  size?: number;
}

export function HorizonSvg({ pitchDeg, rollDeg, size = 200 }: HorizonSvgProps) {
  const hasAttitude =
    typeof pitchDeg === "number" &&
    Number.isFinite(pitchDeg) &&
    typeof rollDeg === "number" &&
    Number.isFinite(rollDeg);

  // Pitch moves the ladder vertically. 1 deg pitch = 4 px shift.
  const pitchOffset = hasAttitude ? pitchDeg * 4 : 0;
  const rollTransform = hasAttitude ? `rotate(${-rollDeg} 100 100)` : undefined;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className="drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]"
      role="img"
      aria-label={hasAttitude ? "Artificial horizon" : "Artificial horizon — attitude unavailable"}
    >
      <defs>
        <clipPath id="hud-horizon-clip">
          <circle cx="100" cy="100" r="90" />
        </clipPath>
      </defs>

      {hasAttitude ? (
        <g clipPath="url(#hud-horizon-clip)">
          <g transform={rollTransform}>
            <g transform={`translate(0 ${pitchOffset})`}>
              <rect x="-100" y="-200" width="400" height="300" fill="#1e3a5f" />
              <rect x="-100" y="100" width="400" height="300" fill="#5a3a1e" />
              <line x1="-100" y1="100" x2="300" y2="100" stroke="#ffffff" strokeWidth="1.5" />
              <line x1="40" y1="60" x2="160" y2="60" stroke="#ffffff" strokeWidth="1" />
              <line x1="60" y1="80" x2="140" y2="80" stroke="#ffffff" strokeWidth="1" />
              <line x1="60" y1="120" x2="140" y2="120" stroke="#ffffff" strokeWidth="1" />
              <line x1="40" y1="140" x2="160" y2="140" stroke="#ffffff" strokeWidth="1" />
            </g>
          </g>
        </g>
      ) : (
        // Blanked ball plus the failure flag. No ground, no sky, no ladder —
        // nothing that could be read as an attitude.
        <g clipPath="url(#hud-horizon-clip)" data-testid="horizon-attitude-flag">
          <rect x="0" y="0" width="200" height="200" fill="#141414" />
          <line x1="40" y1="40" x2="160" y2="160" stroke="#e5484d" strokeWidth="3" />
          <line x1="160" y1="40" x2="40" y2="160" stroke="#e5484d" strokeWidth="3" />
          <text
            x="100"
            y="150"
            textAnchor="middle"
            fill="#e5484d"
            fontSize="18"
            fontFamily="monospace"
            letterSpacing="1"
          >
            ATT
          </text>
        </g>
      )}

      <circle cx="100" cy="100" r="90" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
      {/* The fixed aircraft reference stays in both states: it is the airframe,
          not a reading, and removing it would leave an empty circle. */}
      <line x1="70" y1="100" x2="90" y2="100" stroke="#dff140" strokeWidth="3" />
      <line x1="110" y1="100" x2="130" y2="100" stroke="#dff140" strokeWidth="3" />
      <circle cx="100" cy="100" r="2" fill="#dff140" />
    </svg>
  );
}
