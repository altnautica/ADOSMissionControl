"use client";

// HUD bottom bar. Heading + altitude tape readouts plus the artificial
// horizon. All values come from the telemetry-store ring buffers, freshness-
// gated: the ring keeps its last sample forever, so an ungated read left the
// kiosk showing a heading, an altitude, and an attitude from a link that had
// been gone for hours.

import { useTranslations } from "next-intl";
import { HorizonSvg } from "./HorizonSvg";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockTick } from "@/lib/agent/freshness";
import { freshOnly } from "@/lib/telemetry/freshness";

function fmt(n: number | undefined | null, digits = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

export function BottomBar() {
  const t = useTranslations("cockpit");

  useTelemetryStore((s) => s._version);
  // Time-passing signal: on link loss `_version` stops changing, so without
  // this the last frame would stay on screen indefinitely.
  useClockTick();

  const buffers = useTelemetryStore.getState();
  const now = Date.now();
  const attitude = freshOnly(buffers.attitude.latest(), now);
  const vfr = freshOnly(buffers.vfr.latest(), now);

  // Null, not zero. Zero is a wings-level attitude, and the horizon drew it
  // whenever attitude was missing — a fabricated flight instrument.
  const pitchDeg = attitude?.pitch ?? null;
  const rollDeg = attitude?.roll ?? null;
  const headingDeg = vfr ? fmt(vfr.heading, 0) : "--";
  const altitudeM = vfr ? fmt(vfr.alt, 0) : "--";

  return (
    <div className="absolute bottom-0 left-0 right-0 h-48 px-6 pb-4 flex items-end justify-between pointer-events-none">
      <div className="flex flex-col items-center gap-1 bg-black/40 backdrop-blur-sm px-3 py-2 rounded">
        <span className="text-[10px] uppercase tracking-wider text-white/60 font-mono">{t("strip.hdg")}</span>
        <span className="text-xl font-mono text-white">{headingDeg}</span>
      </div>

      <div className="flex flex-col items-center">
        <HorizonSvg pitchDeg={pitchDeg} rollDeg={rollDeg} size={180} />
      </div>

      <div className="flex flex-col items-center gap-1 bg-black/40 backdrop-blur-sm px-3 py-2 rounded">
        <span className="text-[10px] uppercase tracking-wider text-white/60 font-mono">{t("strip.alt")}</span>
        <span className="text-xl font-mono text-white">{altitudeM}</span>
        <span className="text-[10px] uppercase tracking-wider text-white/60 font-mono">m</span>
      </div>
    </div>
  );
}
