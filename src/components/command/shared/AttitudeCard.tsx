"use client";

import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface AttitudeCardProps {
  className?: string;
}

/** Clamp a value between min and max */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Convert radians to degrees */
function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/** Normalize heading to 0–360 */
function normalizeHeading(deg: number) {
  return ((deg % 360) + 360) % 360;
}

/** SVG Artificial Horizon Indicator */
function ArtificialHorizon({ roll, pitch, size = 120 }: { roll: number; pitch: number; size?: number }) {
  const r = size / 2;
  // Pitch: 1° = 1.5px shift, clamped to ±40°
  const pitchShift = clamp(pitch, -40, 40) * 1.5;
  const rollDeg = clamp(toDeg(roll), -90, 90);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <defs>
        <clipPath id="adi-clip">
          <circle cx={r} cy={r} r={r - 1} />
        </clipPath>
      </defs>

      {/* Clipped circle */}
      <g clipPath="url(#adi-clip)">
        {/* Sky + Ground rotated by roll, shifted by pitch */}
        <g transform={`rotate(${-rollDeg}, ${r}, ${r})`}>
          {/* Sky */}
          <rect x={-size} y={-size * 2 + pitchShift} width={size * 3} height={size * 2 + r} fill="#1E40AF" />
          {/* Ground */}
          <rect x={-size} y={r + pitchShift} width={size * 3} height={size * 2} fill="#78350F" />
          {/* Horizon line */}
          <line x1={-size} y1={r + pitchShift} x2={size * 3} y2={r + pitchShift} stroke="white" strokeWidth={1.5} opacity={0.8} />

          {/* Pitch ladder lines */}
          {[-20, -10, 10, 20].map((deg) => {
            const y = r + pitchShift - deg * 1.5;
            const w = deg % 20 === 0 ? 24 : 16;
            return (
              <g key={deg}>
                <line x1={r - w / 2} y1={y} x2={r + w / 2} y2={y} stroke="white" strokeWidth={0.8} opacity={0.5} />
                <text x={r + w / 2 + 3} y={y + 3} fill="white" fontSize={7} opacity={0.5}>{Math.abs(deg)}</text>
              </g>
            );
          })}
        </g>

        {/* Fixed aircraft reference (center crosshair) */}
        <g stroke="#FCD34D" strokeWidth={2} fill="none">
          <line x1={r - 20} y1={r} x2={r - 8} y2={r} />
          <line x1={r + 8} y1={r} x2={r + 20} y2={r} />
          <circle cx={r} cy={r} r={3} />
        </g>

        {/* Roll indicator triangle at top */}
        <polygon
          points={`${r},4 ${r - 4},12 ${r + 4},12`}
          fill="#FCD34D"
        />
      </g>

      {/* Outer ring */}
      <circle cx={r} cy={r} r={r - 1} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />
    </svg>
  );
}

/** SVG Compass Rose */
function CompassRose({ heading, size = 120 }: { heading: number; size?: number }) {
  const r = size / 2;
  const innerR = r - 12;
  const hdg = normalizeHeading(heading);

  const cardinals = [
    { label: "N", angle: 0, color: "#EF4444" },
    { label: "E", angle: 90, color: "#9CA3AF" },
    { label: "S", angle: 180, color: "#9CA3AF" },
    { label: "W", angle: 270, color: "#9CA3AF" },
  ];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* Background circle */}
      <circle cx={r} cy={r} r={r - 1} fill="#111827" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />

      {/* Rotating compass */}
      <g transform={`rotate(${-hdg}, ${r}, ${r})`}>
        {/* Tick marks every 10° */}
        {Array.from({ length: 36 }, (_, i) => {
          const angle = i * 10;
          const isMajor = angle % 30 === 0;
          const len = isMajor ? 8 : 4;
          const rad = (angle * Math.PI) / 180;
          const x1 = r + (innerR + len) * Math.sin(rad);
          const y1 = r - (innerR + len) * Math.cos(rad);
          const x2 = r + innerR * Math.sin(rad);
          const y2 = r - innerR * Math.cos(rad);
          return (
            <line
              key={angle}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isMajor ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)"}
              strokeWidth={isMajor ? 1.5 : 0.8}
            />
          );
        })}

        {/* Cardinal labels */}
        {cardinals.map(({ label, angle, color }) => {
          const rad = (angle * Math.PI) / 180;
          const labelR = innerR - 10;
          const x = r + labelR * Math.sin(rad);
          const y = r - labelR * Math.cos(rad);
          return (
            <text
              key={label}
              x={x} y={y + 4}
              textAnchor="middle"
              fill={color}
              fontSize={11}
              fontWeight="bold"
            >
              {label}
            </text>
          );
        })}
      </g>

      {/* Fixed heading pointer (top triangle) */}
      <polygon
        points={`${r},3 ${r - 5},13 ${r + 5},13`}
        fill="#FCD34D"
      />

      {/* Center dot */}
      <circle cx={r} cy={r} r={2} fill="#FCD34D" />
    </svg>
  );
}

export function AttitudeCard({ className }: AttitudeCardProps) {
  useTelemetryStore((s) => s._version);
  const attitude = useTelemetryStore((s) => s.attitude);
  const position = useTelemetryStore((s) => s.position);
  const latestAtt = attitude.latest();
  const latestPos = position.latest();

  const roll = latestAtt?.roll ?? 0;
  const pitch = latestAtt?.pitch ?? 0;
  const yaw = latestAtt?.yaw ?? 0;
  const heading = latestPos?.heading ?? normalizeHeading(toDeg(yaw));

  const fmt = (v: number | undefined) =>
    v !== undefined ? toDeg(v).toFixed(1) : "--.-";
  const fmtRate = (v: number | undefined) =>
    v !== undefined ? v.toFixed(2) : "--.--";
  const fmtHdg = (v: number) => v.toFixed(0).padStart(3, "0");

  const hasData = !!latestAtt;

  return (
    <div className={cn("border border-border-default rounded-lg p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">Attitude</span>
        </div>
        {hasData && (
          <span className="text-[10px] font-mono text-text-tertiary">
            HDG {fmtHdg(heading)}°
          </span>
        )}
      </div>

      {/* Top: ADI left, Compass right */}
      <div className="flex items-center justify-center gap-3 mb-2">
        <ArtificialHorizon roll={roll} pitch={pitch} size={100} />
        <CompassRose heading={heading} size={100} />
      </div>

      {/* Bottom: compact numeric values */}
      <div className="grid grid-cols-4 gap-x-2 text-center border-t border-border-default pt-2">
        {([
          { label: "Roll", value: fmt(latestAtt?.roll) + "°" },
          { label: "Pitch", value: fmt(latestAtt?.pitch) + "°" },
          { label: "Yaw", value: fmt(latestAtt?.yaw) + "°" },
          { label: "Hdg", value: fmtHdg(heading) + "°" },
        ] as const).map(({ label, value }) => (
          <div key={label}>
            <div className="text-[9px] text-text-tertiary uppercase tracking-wide">{label}</div>
            <div className="text-xs font-mono text-text-primary">{value}</div>
          </div>
        ))}
      </div>

      {!hasData && (
        <div className="text-[10px] text-text-tertiary text-center mt-2">
          Waiting for telemetry...
        </div>
      )}
    </div>
  );
}
