"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { EventTimeline } from "./EventTimeline";
import { MessageRatePanel } from "./MessageRatePanel";
import { DiagnosticsExport } from "./DiagnosticsExport";
import { ShareDiagnostics } from "./ShareDiagnostics";
import { FrameInspector } from "./FrameInspector";
import { CommandQueuePanel } from "./CommandQueuePanel";
import { RingBufferPanel } from "./RingBufferPanel";
import { PerformancePanel } from "./PerformancePanel";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { useDroneManager } from "@/stores/drone-manager";
import type { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import {
  Clock,
  Activity,
  Stethoscope,
  Trash2,
  Binary,
  ListOrdered,
  Database,
  Gauge,
} from "lucide-react";

type DiagTab = "timeline" | "rates" | "frames" | "queue" | "buffers" | "perf";

export function DiagnosticsPanel() {
  const [activeTab, setActiveTab] = useState<DiagTab>("timeline");
  const clear = useDiagnosticsStore((s) => s.clear);
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);

  // Enable hex logging only when frames tab is active (perf optimization)
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (protocol && 'diagnosticsEnabled' in protocol) {
      (protocol as MAVLinkAdapter).diagnosticsEnabled = activeTab === "frames";
    }
    return () => {
      const p = getSelectedProtocol();
      if (p && 'diagnosticsEnabled' in p) {
        (p as MAVLinkAdapter).diagnosticsEnabled = false;
      }
    };
  }, [activeTab, getSelectedProtocol]);

  const tabs: { key: DiagTab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { key: "timeline", label: "Timeline", Icon: Clock },
    { key: "rates", label: "Rates", Icon: Activity },
    { key: "frames", label: "Frames", Icon: Binary },
    { key: "queue", label: "Queue", Icon: ListOrdered },
    { key: "buffers", label: "Buffers", Icon: Database },
    { key: "perf", label: "Perf", Icon: Gauge },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Top bar with tabs + actions */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary">
        <Stethoscope size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">Diagnostics</span>

        {/* Tab toggles */}
        <div className="flex items-center gap-0.5 bg-bg-tertiary p-0.5 rounded ml-2">
          {tabs.map((tab) => {
            const TabIcon = tab.Icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-[10px] cursor-pointer rounded transition-colors",
                  activeTab === tab.key
                    ? "bg-bg-secondary text-text-primary"
                    : "text-text-tertiary hover:text-text-secondary",
                )}
              >
                <TabIcon size={10} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <ShareDiagnostics />
        <DiagnosticsExport />

        <button
          onClick={clear}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"
        >
          <Trash2 size={10} />
          Clear All
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "timeline" && <EventTimeline />}
        {activeTab === "rates" && <MessageRatePanel />}
        {activeTab === "frames" && <FrameInspector />}
        {activeTab === "queue" && <CommandQueuePanel />}
        {activeTab === "buffers" && <RingBufferPanel />}
        {activeTab === "perf" && <PerformancePanel />}
      </div>
    </div>
  );
}
