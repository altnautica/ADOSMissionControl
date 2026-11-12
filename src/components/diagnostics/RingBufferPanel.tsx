"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { RingBufferInfo } from "@/stores/diagnostics-store";
import { Database } from "lucide-react";

/** Collect ring buffer utilization from the telemetry store + diagnostics store */
function collectRingBufferInfo(): RingBufferInfo[] {
  const tel = useTelemetryStore.getState();
  const diag = useDiagnosticsStore.getState();

  const buffers: { name: string; buf: { length: number; capacity: number } }[] = [
    { name: "attitude", buf: tel.attitude },
    { name: "position", buf: tel.position },
    { name: "battery", buf: tel.battery },
    { name: "gps", buf: tel.gps },
    { name: "gps2", buf: tel.gps2 },
    { name: "vfr", buf: tel.vfr },
    { name: "rc", buf: tel.rc },
    { name: "sysStatus", buf: tel.sysStatus },
    { name: "radio", buf: tel.radio },
    { name: "ekf", buf: tel.ekf },
    { name: "vibration", buf: tel.vibration },
    { name: "servoOutput", buf: tel.servoOutput },
    { name: "wind", buf: tel.wind },
    { name: "terrain", buf: tel.terrain },
    { name: "localPosition", buf: tel.localPosition },
    { name: "debug", buf: tel.debug },
    { name: "gimbal", buf: tel.gimbal },
    { name: "obstacle", buf: tel.obstacle },
    { name: "scaledImu", buf: tel.scaledImu },
    { name: "homePosition", buf: tel.homePosition },
    { name: "powerStatus", buf: tel.powerStatus },
    { name: "distanceSensor", buf: tel.distanceSensor },
    { name: "fenceStatus", buf: tel.fenceStatus },
    { name: "estimatorStatus", buf: tel.estimatorStatus },
    { name: "cameraTrigger", buf: tel.cameraTrigger },
    { name: "navController", buf: tel.navController },
    { name: "diag:messageLog", buf: diag.messageLog },
    { name: "diag:eventTimeline", buf: diag.eventTimeline },
  ];

  return buffers.map((b) => ({
    name: b.name,
    capacity: b.buf.capacity,
    length: b.buf.length,
    fillPct: b.buf.capacity > 0 ? Math.round((b.buf.length / b.buf.capacity) * 100) : 0,
  }));
}

export function RingBufferPanel() {
  const tq = useTranslations("diagnostics.ringBufferPanel");
  const ringBufferInfo = useDiagnosticsStore((s) => s.ringBufferInfo);
  const updateRingBufferInfo = useDiagnosticsStore((s) => s.updateRingBufferInfo);

  // Refresh every 2s
  useEffect(() => {
    const update = () => updateRingBufferInfo(collectRingBufferInfo());
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [updateRingBufferInfo]);

  // Sort by fill percentage descending
  const sorted = [...ringBufferInfo].sort((a, b) => b.fillPct - a.fillPct);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Database size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">{tq("ringBuffers")}</span>
        <span className="text-[10px] text-text-tertiary font-mono">
          {ringBufferInfo.length} buffer{ringBufferInfo.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
            <Database size={24} className="text-text-tertiary" />
            <span className="text-xs text-text-tertiary">{tq("noRingBuffersTracked")}</span>
          </div>
        ) : (
          <div className="font-mono text-[10px]">
            {/* Table header */}
            <div className="flex items-center px-4 py-1 border-b border-border-default bg-bg-tertiary text-text-tertiary sticky top-0 z-10">
              <span className="w-[160px] shrink-0">{tq("buffer")}</span>
              <span className="w-[60px] shrink-0 text-right">{tq("count")}</span>
              <span className="w-[60px] shrink-0 text-right">{tq("cap")}</span>
              <span className="w-[50px] shrink-0 text-right">{tq("fill")}</span>
              <span className="flex-1 pl-3">{tq("bar")}</span>
            </div>

            {sorted.map((buf) => {
              const barColor = buf.fillPct >= 90
                ? "bg-status-error/70"
                : buf.fillPct >= 70
                  ? "bg-status-warning/70"
                  : "bg-accent-primary/60";
              return (
                <div
                  key={buf.name}
                  className="flex items-center px-4 py-0.5 hover:bg-bg-tertiary/50"
                >
                  <span className="w-[160px] shrink-0 text-text-primary truncate">{buf.name}</span>
                  <span className="w-[60px] shrink-0 text-right text-text-secondary tabular-nums">{buf.length}</span>
                  <span className="w-[60px] shrink-0 text-right text-text-tertiary tabular-nums">{buf.capacity}</span>
                  <span className="w-[50px] shrink-0 text-right text-text-primary tabular-nums">{buf.fillPct}%</span>
                  <div className="flex-1 pl-3">
                    <div className="h-2 bg-bg-tertiary rounded overflow-hidden">
                      <div
                        className={`h-full ${barColor} rounded transition-all duration-300`}
                        style={{ width: `${buf.fillPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
