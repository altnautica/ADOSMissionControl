"use client";

// HUD bottom bar. Heading + altitude tape readouts plus the artificial
// horizon. All values come from the telemetry-store ring buffers.

import { HorizonSvg } from "./HorizonSvg";
import { useTelemetryStore } from "@/stores/telemetry-store";

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

export function BottomBar() {
  useTelemetryStore((s) => s._version);

  const attitude = useTelemetryStore((s) => s.attitude.latest());
  const vfr = useTelemetryStore((s) => s.vfr.latest());

  const pitchDeg = attitude?.pitch ?? 0;
  const rollDeg = attitude?.roll ?? 0;
  const headingDeg = vfr ? fmt(vfr.heading, 0) : "--";
  const altitudeM = vfr ? fmt(vfr.alt, 0) : "--";

  return (
    <div className="absolute bottom-0 left-0 right-0 h-48 px-6 pb-4 flex items-end justify-between pointer-events-none">
      <div className="flex flex-col items-center gap-1 bg-black/40 backdrop-blur-sm px-3 py-2 rounded">
        <span className="text-[10px] uppercase tracking-wider text-white/60 font-mono">HDG</span>
        <span className="text-xl font-mono text-white">{headingDeg}</span>
      </div>

      <div className="flex flex-col items-center">
        <HorizonSvg pitchDeg={pitchDeg} rollDeg={rollDeg} size={180} />
      </div>

      <div className="flex flex-col items-center gap-1 bg-black/40 backdrop-blur-sm px-3 py-2 rounded">
        <span className="text-[10px] uppercase tracking-wider text-white/60 font-mono">ALT</span>
        <span className="text-xl font-mono text-white">{altitudeM}</span>
        <span className="text-[10px] uppercase tracking-wider text-white/60 font-mono">m</span>
      </div>
    </div>
  );
}
