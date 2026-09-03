"use client";

/**
 * @module BusMonitorSection
 * @description Two-tab CAN bus monitor for the CAN Config page.
 *
 * Tab 1: Raw frames — promotes the existing per-drone `CanMonitorPanel`
 * which reads MAVLink CAN_FRAME (message 386).
 * Tab 2: Decoded transfers — reads the DroneCAN-level decoded ring
 * buffer from `useDroneCanBusStore`, with pause/resume/clear/export
 * controls.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, Trash2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, tabButtonId } from "@/components/ui/tabs";
import { CanMonitorPanel } from "@/components/fc/can/CanMonitorPanel";
import { useDroneCanBusStore, type DecodedFrame } from "@/stores/dronecan/bus-store";

function hex(n: number, digits: number): string {
  return n.toString(16).toUpperCase().padStart(digits, "0");
}

function formatPayload(payload: Uint8Array): string {
  const max = Math.min(payload.byteLength, 16);
  const parts: string[] = [];
  for (let i = 0; i < max; i++) parts.push(hex(payload[i], 2));
  if (payload.byteLength > max) parts.push("…");
  return parts.join(" ");
}

function exportDecodedFrames(frames: DecodedFrame[]): void {
  const lines = ["timestamp,dir,canId,kind,dataTypeId,src,dst,isRequest,payload,label,error"];
  for (const f of frames) {
    lines.push([
      f.t,
      f.dir,
      `0x${hex(f.canId, 8)}`,
      f.decoded.kind,
      f.decoded.dataTypeId,
      f.decoded.srcNodeId,
      f.decoded.dstNodeId ?? "",
      f.decoded.isRequest ?? "",
      formatPayload(f.payload).replace(/\s/g, ""),
      JSON.stringify(f.label ?? ""),
      f.error ? "1" : "0",
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dronecan-frames-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DecodedFramesView() {
  const t = useTranslations("canConfig.busMonitor");

  const version = useDroneCanBusStore((s) => s._version);
  const frames = useDroneCanBusStore((s) => s.frames);
  const counters = useDroneCanBusStore((s) => s.counters);
  const paused = useDroneCanBusStore((s) => s.paused);
  const pause = useDroneCanBusStore((s) => s.pause);
  const resume = useDroneCanBusStore((s) => s.resume);
  const clear = useDroneCanBusStore((s) => s.clear);

  const recent = useMemo(() => frames.last(80).slice().reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, version],
  );

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
          <span>fps <span className="font-mono text-text-primary">{counters.fps}</span></span>
          <span>err/s <span className="font-mono text-text-primary">{counters.errorsPs}</span></span>
          <span>↓ <span className="font-mono text-text-primary">{counters.bytesIn}</span></span>
          <span>↑ <span className="font-mono text-text-primary">{counters.bytesOut}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={paused ? <Play size={12} /> : <Pause size={12} />} onClick={paused ? resume : pause}>
            {paused ? t("resume") : t("pause")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={clear}>
            {t("clear")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Download size={12} />} onClick={() => exportDecodedFrames(recent)} disabled={recent.length === 0}>
            {t("export")}
          </Button>
        </div>
      </div>

      {recent.length === 0 ? (
        <Card>
          <p className="text-xs text-text-tertiary text-center py-6">{t("noTransfers")}</p>
        </Card>
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto max-h-[480px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-bg-tertiary border-b border-border-default text-text-tertiary">
                <tr>
                  <th className="text-left py-1.5 px-3 font-medium">t</th>
                  <th className="text-left py-1.5 pr-3 font-medium">dir</th>
                  <th className="text-left py-1.5 pr-3 font-medium">CAN ID</th>
                  <th className="text-left py-1.5 pr-3 font-medium">kind</th>
                  <th className="text-left py-1.5 pr-3 font-medium">DT</th>
                  <th className="text-left py-1.5 pr-3 font-medium">src</th>
                  <th className="text-left py-1.5 pr-3 font-medium">dst</th>
                  <th className="text-left py-1.5 pr-3 font-medium">payload</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((f, i) => (
                  <tr key={`${f.t}-${i}`} className={`border-b border-border-default last:border-b-0 hover:bg-bg-primary/40 ${f.error ? "text-status-error" : ""}`}>
                    <td className="py-1 px-3 font-mono text-text-tertiary text-[10px]">{new Date(f.t).toLocaleTimeString("en-IN", { hour12: false })}</td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">{f.dir}</td>
                    <td className="py-1 pr-3 font-mono text-accent-primary">0x{hex(f.canId, 8)}</td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">{f.decoded.kind}</td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">{f.decoded.dataTypeId}</td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">{f.decoded.srcNodeId}</td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">{f.decoded.dstNodeId ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">{formatPayload(f.payload)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function BusMonitorSection() {
  const t = useTranslations("canConfig.busMonitor");
  const [activeTab, setActiveTab] = useState<"raw" | "decoded">("raw");

  return (
    <div className="space-y-3">
      <Tabs
        tabs={[
          { id: "raw", label: t("tabs.raw"), panelId: "can-bus-monitor-raw" },
          { id: "decoded", label: t("tabs.decoded"), panelId: "can-bus-monitor-decoded" },
        ]}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as "raw" | "decoded")}
        label={t("title")}
      />

      {activeTab === "raw" ? (
        <div id="can-bus-monitor-raw" role="tabpanel" aria-labelledby={tabButtonId("raw")}>
          <CanMonitorPanel />
        </div>
      ) : (
        <div id="can-bus-monitor-decoded" role="tabpanel" aria-labelledby={tabButtonId("decoded")}>
          <DecodedFramesView />
        </div>
      )}
    </div>
  );
}
