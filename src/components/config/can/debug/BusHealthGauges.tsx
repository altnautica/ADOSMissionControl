"use client";

/**
 * @module BusHealthGauges
 * @description Compact bus-health gauges for the debug drawer. Top row:
 * frames-per-second (with sparkline), errors-per-second, and bus-off event
 * count. Bottom row: tx queue depth, rx queue depth, lost frames. No
 * transport reports bus-off, queue depths or lost frames yet, so those
 * gauges read "—" rather than a 0 that would read as healthy.
 *
 * The panel snapshots store state every 250 ms so the numbers update at
 * a steady 4 Hz, decoupled from the much higher frame ingest rate.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";
import { useDroneCanBusStore } from "@/stores/dronecan/bus-store";

interface Snapshot {
  fps: number;
  errorsPs: number;
}

const POLL_MS = 250;
const HISTORY = 32;

/** Shown for metrics no transport reports yet. */
const NOT_MEASURED = "—";

export function BusHealthGauges() {
  const t = useTranslations("canConfig.debug.busHealthGauges");

  const [snap, setSnap] = useState<Snapshot>({ fps: 0, errorsPs: 0 });
  const fpsHistRef = useRef<number[]>([]);
  const [fpsHistSig, setFpsHistSig] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      // Pull from `getState()` so we avoid forcing re-renders on every
      // single frame push; the polling cadence governs the UI.
      const c = useDroneCanBusStore.getState().counters;
      const fps = c.fps;
      setSnap({ fps, errorsPs: c.errorsPs });

      const hist = fpsHistRef.current;
      hist.push(fps);
      if (hist.length > HISTORY) hist.splice(0, hist.length - HISTORY);
      setFpsHistSig((s) => (s + 1) & 0xffff);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const sparkData = fpsHistRef.current.map((v, i) => ({ i, v }));
  void fpsHistSig; // referenced to keep the chart in sync with polling

  return (
    <div className="flex flex-col">
      <div className="px-2 py-1.5 border-b border-border-default">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">
          {t("title")}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 px-2 py-2">
        <FpsMeter label={t("framesPerSec")} value={snap.fps} data={sparkData} />
        <BigMeter label={t("errorsPerSec")} value={String(snap.errorsPs)} testId="bus-health-errors-ps" />
        <BigMeter label={t("busOffEvents")} value={NOT_MEASURED} testId="bus-health-bus-off" />
      </div>

      <div className="grid grid-cols-3 gap-2 px-2 pb-2">
        <SmallMeter label={t("txQueue")} value={NOT_MEASURED} testId="bus-health-tx-queue" />
        <SmallMeter label={t("rxQueue")} value={NOT_MEASURED} testId="bus-health-rx-queue" />
        <SmallMeter label={t("lostFrames")} value={NOT_MEASURED} testId="bus-health-lost-frames" />
      </div>
    </div>
  );
}

function BigMeter({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div
      className="bg-bg-primary border border-border-default rounded p-1.5"
      data-testid={testId}
    >
      <div className="text-[9px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="text-sm font-mono text-text-primary mt-0.5">{value}</div>
    </div>
  );
}

function FpsMeter({ label, value, data }: { label: string; value: number; data: { i: number; v: number }[] }) {
  return (
    <div
      className="bg-bg-primary border border-border-default rounded p-1.5"
      data-testid="bus-health-fps"
    >
      <div className="text-[9px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="flex items-center gap-2">
        <div className="text-sm font-mono text-text-primary mt-0.5">{value}</div>
        {data.length > 1 && (
          <div className="flex-1 h-5">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <YAxis hide domain={[0, "dataMax"]} />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="currentColor"
                  className="text-accent-primary"
                  dot={false}
                  isAnimationActive={false}
                  strokeWidth={1}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function SmallMeter({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div
      className="bg-bg-primary border border-border-default rounded p-1.5 flex items-center justify-between"
      data-testid={testId}
    >
      <span className="text-[9px] uppercase tracking-wider text-text-tertiary">{label}</span>
      <span className="text-xs font-mono text-text-primary">{value}</span>
    </div>
  );
}
