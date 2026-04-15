"use client";

// Inline artificial horizon SVG. Phase 2 Wave B renders a static level
// horizon with a pitch ladder. Wave C binds pitchDeg / rollDeg to live
// attitude from telemetry-store.

export interface HorizonSvgProps {
  pitchDeg?: number;
  rollDeg?: number;
  size?: number;
}

export function HorizonSvg({ pitchDeg = 0, rollDeg = 0, size = 200 }: HorizonSvgProps) {
  // Pitch moves the ladder vertically. 1 deg pitch = 4 px shift.
  const pitchOffset = pitchDeg * 4;
  const rollTransform = `rotate(${-rollDeg} 100 100)`;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className="drop-shadow-[0_0_2px_rgba(0,0,0,0.8)]"
      aria-label="Artificial horizon"
    >
      <defs>
        <clipPath id="hud-horizon-clip">
          <circle cx="100" cy="100" r="90" />
        </clipPath>
      </defs>

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

      <circle cx="100" cy="100" r="90" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
      <line x1="70" y1="100" x2="90" y2="100" stroke="#dff140" strokeWidth="3" />
      <line x1="110" y1="100" x2="130" y2="100" stroke="#dff140" strokeWidth="3" />
      <circle cx="100" cy="100" r="2" fill="#dff140" />
    </svg>
  );
}
