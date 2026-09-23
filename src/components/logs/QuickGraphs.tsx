"use client";

/**
 * @module QuickGraphs
 * @description Quick telemetry graphs — altitude, battery, climb rate,
 * vibration levels (X/Y/Z with thresholds), and RC inputs (ch1-4).
 * Uses TimeSeriesChart and MultiSeriesChart from shared components.
 * Reads from telemetry-store ring buffers.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { Mountain, Battery, TrendingUp, Activity, Radio } from "lucide-react";
import { TimeSeriesChart } from "@/components/shared/TimeSeriesChart";
import { MultiSeriesChart } from "@/components/shared/MultiSeriesChart";
import type { PositionData, BatteryData, VibrationData, RcData } from "@/lib/types";
import type { RingBuffer } from "@/lib/ring-buffer";

type TelemetryState = ReturnType<typeof useTelemetryStore.getState>;

/**
 * A value that changes only when the selected ring gains a sample. Charts
 * key their series on it, so a sample on one channel rebuilds that chart
 * alone instead of every chart on every telemetry push.
 */
function useRingStamp(select: (s: TelemetryState) => RingBuffer<{ timestamp: number }>): string {
  return useTelemetryStore((s) => {
    const ring = select(s);
    return `${ring.length}:${ring.latest()?.timestamp ?? 0}`;
  });
}

// ── Altitude chart ──────────────────────────────────────────────

function AltitudeChart() {
  const positionRing = useTelemetryStore((s) => s.position);
  const stamp = useRingStamp((s) => s.position);

  const data = useMemo(() => {
    void stamp; // the ring mutates in place; the stamp is the trigger
    const arr = positionRing.toArray() as PositionData[];
    return arr.flatMap((p) => (p.relativeAlt !== undefined ? [{ t: p.timestamp, v: p.relativeAlt }] : []));
  }, [positionRing, stamp]);

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <Mountain size={12} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          Altitude
        </span>
      </div>
      <TimeSeriesChart data={data} color="var(--accent-primary)" label="Alt" unit="m" />
    </div>
  );
}

// ── Battery chart ───────────────────────────────────────────────

function BatteryChart() {
  const batteryRing = useTelemetryStore((s) => s.battery);
  const stamp = useRingStamp((s) => s.battery);

  const { voltageData, currentData } = useMemo(() => {
    void stamp; // the ring mutates in place; the stamp is the trigger
    const arr = batteryRing.toArray() as BatteryData[];
    return {
      voltageData: arr.map((b) => ({ t: b.timestamp, v: b.voltage })),
      currentData: arr.flatMap((b) => (b.current !== undefined ? [{ t: b.timestamp, v: b.current }] : [])),
    };
  }, [batteryRing, stamp]);

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <Battery size={12} className="text-status-warning" />
        <span className="text-xs font-semibold text-text-primary">
          Battery
        </span>
      </div>
      <TimeSeriesChart
        data={voltageData}
        color="#f59e0b"
        label="Voltage"
        unit="V"
        secondaryData={currentData}
        secondaryColor="#ef4444"
        secondaryLabel="Current"
        secondaryUnit="A"
      />
    </div>
  );
}

// ── Climb rate chart ────────────────────────────────────────────

function ClimbRateChart() {
  const positionRing = useTelemetryStore((s) => s.position);
  const stamp = useRingStamp((s) => s.position);

  const data = useMemo(() => {
    void stamp; // the ring mutates in place; the stamp is the trigger
    const arr = positionRing.toArray() as PositionData[];
    return arr.flatMap((p) => (p.climbRate !== undefined ? [{ t: p.timestamp, v: p.climbRate }] : []));
  }, [positionRing, stamp]);

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp size={12} className="text-status-success" />
        <span className="text-xs font-semibold text-text-primary">
          Climb Rate
        </span>
      </div>
      <TimeSeriesChart data={data} color="#22c55e" label="VSpd" unit="m/s" />
    </div>
  );
}

// ── Vibration chart (X/Y/Z with threshold lines) ───────────────

function VibrationChart() {
  const vibrationRing = useTelemetryStore((s) => s.vibration);
  const stamp = useRingStamp((s) => s.vibration);

  const { xData, yData, zData } = useMemo(() => {
    void stamp; // the ring mutates in place; the stamp is the trigger
    const arr = vibrationRing.toArray() as VibrationData[];
    return {
      xData: arr.map((v) => ({ t: v.timestamp, v: v.vibrationX })),
      yData: arr.map((v) => ({ t: v.timestamp, v: v.vibrationY })),
      zData: arr.map((v) => ({ t: v.timestamp, v: v.vibrationZ })),
    };
  }, [vibrationRing, stamp]);

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <Activity size={12} className="text-status-error" />
        <span className="text-xs font-semibold text-text-primary">
          Vibration
        </span>
      </div>
      <MultiSeriesChart
        series={[
          { data: xData, color: "#ef4444", label: "X" },
          { data: yData, color: "#22c55e", label: "Y" },
          { data: zData, color: "#3b82f6", label: "Z" },
        ]}
        unit=" m/s\u00B2"
        thresholds={[
          { value: 30, color: "#f59e0b", label: "30 warn" },
          { value: 60, color: "#ef4444", label: "60 crit" },
        ]}
        fixedYMin={0}
      />
    </div>
  );
}

// ── RC inputs chart (channels 1-4) ─────────────────────────────

function RcInputChart() {
  const rcRing = useTelemetryStore((s) => s.rc);
  const stamp = useRingStamp((s) => s.rc);

  const { ch1, ch2, ch3, ch4 } = useMemo(() => {
    void stamp; // the ring mutates in place; the stamp is the trigger
    const arr = rcRing.toArray() as RcData[];
    // A channel the receiver did not report is a gap, not a centred stick.
    return {
      ch1: arr.map((r) => ({ t: r.timestamp, v: r.channels[0] ?? null })),
      ch2: arr.map((r) => ({ t: r.timestamp, v: r.channels[1] ?? null })),
      ch3: arr.map((r) => ({ t: r.timestamp, v: r.channels[2] ?? null })),
      ch4: arr.map((r) => ({ t: r.timestamp, v: r.channels[3] ?? null })),
    };
  }, [rcRing, stamp]);
  const latest = rcRing.latest();
  const noInput = latest !== undefined && latest.channels.length === 0;

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <Radio size={12} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          RC Inputs
        </span>
      </div>
      {noInput ? (
        <div className="flex items-center justify-center bg-bg-tertiary/30 rounded" style={{ height: 120 }}>
          <span className="text-[10px] text-text-tertiary">No RC input</span>
        </div>
      ) : (
      <MultiSeriesChart
        series={[
          { data: ch1, color: "#ef4444", label: "Roll" },
          { data: ch2, color: "#22c55e", label: "Pitch" },
          { data: ch3, color: "#f59e0b", label: "Thr" },
          { data: ch4, color: "#8b5cf6", label: "Yaw" },
        ]}
        unit=" PWM"
        fixedYMin={1000}
        fixedYMax={2000}
        centerLine={1500}
      />
      )}
    </div>
  );
}

// ── Composite export ────────────────────────────────────────────

export function QuickGraphs() {
  return (
    <div className="space-y-3">
      <AltitudeChart />
      <BatteryChart />
      <ClimbRateChart />
      <VibrationChart />
      <RcInputChart />
    </div>
  );
}
