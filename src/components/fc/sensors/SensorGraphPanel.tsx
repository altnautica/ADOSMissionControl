"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { VibrationGauges } from "@/components/indicators/VibrationGauges";
import { EkfStatusBars } from "@/components/indicators/EkfStatusBars";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { Activity, Pause, Play } from "lucide-react";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  WaveformChart,
  SOURCE_TABS, TIME_WINDOW_OPTIONS, MAX_SAMPLES, AXIS_COLORS,
  type SourceTab, type TimeWindow, type ImuSample,
} from "./waveform-chart";

export function SensorGraphPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const { firmwareType } = useFirmwareCapabilities();
  const attitudeRing = useTelemetryStore((s) => s.attitude);

  const [source, setSource] = useState<SourceTab>("gyro");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(15);
  const [frozen, setFrozen] = useState(false);
  const [tick, setTick] = useState(0);

  const samplesRef = useRef<ImuSample[]>([]);
  const frozenRef = useRef(false);
  frozenRef.current = frozen;

  useEffect(() => {
    samplesRef.current = [];
    const protocol = getSelectedProtocol();
    if (!protocol?.onScaledImu) return;
    const unsub = protocol.onScaledImu((data) => {
      if (frozenRef.current) return;
      samplesRef.current.push({ timestamp: data.timestamp, xgyro: data.xgyro, ygyro: data.ygyro, zgyro: data.zgyro, xacc: data.xacc, yacc: data.yacc, zacc: data.zacc, xmag: data.xmag, ymag: data.ymag, zmag: data.zmag });
      if (samplesRef.current.length > MAX_SAMPLES) samplesRef.current.splice(0, samplesRef.current.length - MAX_SAMPLES);
    });
    return () => { unsub(); samplesRef.current = []; };
  }, [getSelectedProtocol, selectedDroneId]);

  useEffect(() => {
    if (frozen) return;
    const interval = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(interval);
  }, [frozen]);

  const windowedSamples = useMemo(() => {
    const cutoff = Date.now() - timeWindow * 1000;
    return samplesRef.current.filter((s) => s.timestamp >= cutoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeWindow, tick]);

  const attitudeGyroFallback = useMemo(() => {
    if (windowedSamples.length > 0) return null;
    const cutoff = Date.now() - timeWindow * 1000;
    return attitudeRing.toArray().filter((a) => a.timestamp >= cutoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeWindow, tick, windowedSamples.length, attitudeRing.length]);

  const extractAxis = useCallback(
    (key: keyof ImuSample): number[] => windowedSamples.map((s) => s[key] as number),
    [windowedSamples],
  );

  const hasImuData = windowedSamples.length > 0;
  const hasAttitudeFallback = !hasImuData && (attitudeGyroFallback?.length ?? 0) > 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Activity size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">Sensor Graphs</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 bg-bg-tertiary p-0.5 rounded">
          {SOURCE_TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setSource(key)} className={cn("px-2 py-1 text-[10px] cursor-pointer rounded transition-colors", source === key ? "bg-bg-secondary text-text-primary font-medium" : "text-text-tertiary hover:text-text-secondary")}>{label}</button>
          ))}
        </div>
        <Select value={String(timeWindow)} onChange={(v) => setTimeWindow(Number(v) as TimeWindow)} options={TIME_WINDOW_OPTIONS} className="text-[10px] font-mono" />
        <button onClick={() => setFrozen((f) => !f)} className={cn("flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer", frozen ? "text-status-warning" : "text-text-secondary hover:text-text-primary")}>
          {frozen ? <Pause size={10} /> : <Play size={10} />}{frozen ? "Frozen" : "Live"}
        </button>
        {hasImuData && <span className="text-[9px] font-mono text-text-tertiary tabular-nums">{windowedSamples.length} pts</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!selectedDroneId ? (
          <EmptyState message="Connect a drone to view sensor data" />
        ) : source === "vibration" ? (
          <div className="max-w-lg space-y-4">
            <SectionHeader title="Vibration" subtitle="IMU vibration levels (m/s/s)" />
            <VibrationGauges />
          </div>
        ) : source === "ekf" ? (
          <div className="max-w-lg space-y-4">
            <SectionHeader title="EKF Status" subtitle="Extended Kalman Filter variance" />
            {firmwareType === 'px4' && <span className="text-[10px] text-text-tertiary ml-2">(via ESTIMATOR_STATUS)</span>}
            <EkfStatusBars />
          </div>
        ) : !hasImuData && !hasAttitudeFallback ? (
          <EmptyState message={source === "mag" ? "Waiting for SCALED_IMU magnetometer data..." : `Waiting for SCALED_IMU ${source} data...`} />
        ) : source === "gyro" ? (
          <div className="space-y-4">
            <SectionHeader title="Gyroscope" subtitle="Angular rate (deg/s)" />
            {hasImuData ? (
              <div className="space-y-2">
                <WaveformChart data={extractAxis("xgyro")} label="X" unit="deg/s" color={AXIS_COLORS.x} />
                <WaveformChart data={extractAxis("ygyro")} label="Y" unit="deg/s" color={AXIS_COLORS.y} />
                <WaveformChart data={extractAxis("zgyro")} label="Z" unit="deg/s" color={AXIS_COLORS.z} />
              </div>
            ) : hasAttitudeFallback && attitudeGyroFallback ? (
              <div className="space-y-2">
                <p className="text-[9px] text-text-tertiary italic mb-1">Using attitude rate data (SCALED_IMU not available)</p>
                <WaveformChart data={attitudeGyroFallback.map((a) => a.rollSpeed)} label="R" unit="deg/s" color={AXIS_COLORS.x} />
                <WaveformChart data={attitudeGyroFallback.map((a) => a.pitchSpeed)} label="P" unit="deg/s" color={AXIS_COLORS.y} />
                <WaveformChart data={attitudeGyroFallback.map((a) => a.yawSpeed)} label="Y" unit="deg/s" color={AXIS_COLORS.z} />
              </div>
            ) : null}
          </div>
        ) : source === "accel" ? (
          <div className="space-y-4">
            <SectionHeader title="Accelerometer" subtitle="Linear acceleration (m/s\u00b2)" />
            <div className="space-y-2">
              <WaveformChart data={extractAxis("xacc")} label="X" unit="m/s\u00b2" color={AXIS_COLORS.x} />
              <WaveformChart data={extractAxis("yacc")} label="Y" unit="m/s\u00b2" color={AXIS_COLORS.y} />
              <WaveformChart data={extractAxis("zacc")} label="Z" unit="m/s\u00b2" color={AXIS_COLORS.z} />
            </div>
          </div>
        ) : source === "mag" ? (
          <div className="space-y-4">
            <SectionHeader title="Magnetometer" subtitle="Magnetic field (mGauss)" />
            <div className="space-y-2">
              <WaveformChart data={extractAxis("xmag")} label="X" unit="mG" color={AXIS_COLORS.x} />
              <WaveformChart data={extractAxis("ymag")} label="Y" unit="mG" color={AXIS_COLORS.y} />
              <WaveformChart data={extractAxis("zmag")} label="Z" unit="mG" color={AXIS_COLORS.z} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-sm font-medium text-text-primary">{title}</h2>
      <p className="text-[10px] text-text-tertiary">{subtitle}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
      <Activity size={24} className="text-text-tertiary" />
      <span className="text-xs text-text-tertiary">{message}</span>
    </div>
  );
}
