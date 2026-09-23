"use client";

/**
 * @module CanMonitorPanel
 * @description Read-only CAN bus traffic monitor. Shows raw CAN frames
 * passing through the flight controller's CAN passthrough (MAVLink
 * CAN_FRAME message 386). In demo mode it auto-enables and a synthetic
 * DroneCAN bus with 4 nodes (ESC, GPS, airspeed, power) is emitted from
 * `src/mock/mock-can-bus.ts`. Frames are labeled with friendly DroneCAN
 * hints from `src/lib/can/known-ids.ts`.
 * @license GPL-3.0-only
 */

import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { Activity, Power, Trash2, Cpu } from "lucide-react";
import { cn, isDemoMode } from "@/lib/utils";
import { useCanMonitorStore } from "@/stores/can-monitor-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockTick } from "@/lib/agent/freshness";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { getCanIdHint } from "@/lib/can/known-ids";
// Type-only imports: the mock module itself is loaded lazily in the demo-gated
// effect below so it is never statically bundled into production builds.
import type { CanNodeSummary } from "@/mock/mock-can-bus";
import type * as MockCanBus from "@/mock/mock-can-bus";

/** Format a number as hex with the given digit width. */
function hex(n: number, digits: number): string {
  return n.toString(16).toUpperCase().padStart(digits, "0");
}

/** Format CAN data bytes as space-separated hex. */
function formatData(data: Uint8Array, len: number): string {
  const visible = Math.min(len, data.byteLength);
  const parts: string[] = [];
  for (let i = 0; i < visible; i++) {
    parts.push(hex(data[i], 2));
  }
  return parts.join(" ");
}

/** Source node ID from a 29-bit DroneCAN identifier (low 7 bits). */
function sourceNodeId(canId: number): number {
  return canId & 0x7f;
}

export function CanMonitorPanel() {
  // Subscribe to version so the UI re-renders on each frame
  const version = useCanMonitorStore((s) => s._version);
  const enabled = useCanMonitorStore((s) => s.enabled);
  const setEnabled = useCanMonitorStore((s) => s.setEnabled);
  const clear = useCanMonitorStore((s) => s.clear);
  const totalFrames = useCanMonitorStore((s) => s.totalFrames);
  const fps = useCanMonitorStore((s) => s.framesPerSecond);
  const lastTallyAt = useCanMonitorStore((s) => s._lastTallyAt);
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const [bus, setBus] = useState("1");
  const [starting, setStarting] = useState(false);
  // True while this panel holds CAN forwarding open on the FC, so Stop and
  // unmount only turn off what this panel turned on.
  const forwardingRef = useRef(false);

  // The rate is recomputed only when a frame arrives; once frames stop, the
  // last rate would stay on screen forever. Re-evaluate on the shared clock
  // and show 0 after two seconds without a tally.
  useClockTick();
  const liveFps = Date.now() - lastTallyAt > 2000 ? 0 : fps;

  // ArduPilot emits CAN_FRAME only while a GCS has forwarding enabled on a
  // bus, so Start asks the FC for it and Capturing is shown only after the
  // FC acknowledged.
  const stopForwarding = useCallback(() => {
    if (!forwardingRef.current) return;
    forwardingRef.current = false;
    void getSelectedProtocol()?.enableCanForward?.(0).catch(() => {});
  }, [getSelectedProtocol]);

  const toggleCapture = useCallback(async () => {
    if (enabled) {
      stopForwarding();
      setEnabled(false);
      return;
    }
    if (isDemoMode()) { setEnabled(true); return; }
    const protocol = getSelectedProtocol();
    if (!protocol?.enableCanForward) {
      toast("This connection cannot forward CAN frames", "error");
      return;
    }
    setStarting(true);
    try {
      const result = await protocol.enableCanForward(Number(bus));
      if (!result.success) {
        toast(`FC refused CAN forwarding on bus ${bus}: ${result.message}`, "error");
        return;
      }
      forwardingRef.current = true;
      setEnabled(true);
    } catch {
      toast("CAN forwarding request failed", "error");
    } finally {
      setStarting(false);
    }
  }, [enabled, bus, getSelectedProtocol, setEnabled, stopForwarding, toast]);

  // Unmount only: a re-render must never tear forwarding down.
  const stopForwardingRef = useRef(stopForwarding);
  stopForwardingRef.current = stopForwarding;
  useEffect(() => () => {
    if (!forwardingRef.current) return;
    stopForwardingRef.current();
    useCanMonitorStore.getState().setEnabled(false);
  }, []);

  const framesBuffer = useCanMonitorStore((s) => s.frames);
  const idCounts = useCanMonitorStore((s) => s.idCounts);

  // Auto-enable capture in demo mode so the synthetic DroneCAN bus is
  // visible without requiring the user to click "Start".
  useEffect(() => {
    if (isDemoMode() && !enabled) {
      setEnabled(true);
    }
  }, [enabled, setEnabled]);

  // Poll node summaries from the mock CAN bus in demo mode. The mock module
  // is loaded dynamically (never statically imported into a production build)
  // and its reference is held in a ref until the effect tears down.
  const mockBusRef = useRef<typeof MockCanBus | null>(null);
  const [nodeSummaries, setNodeSummaries] = useState<CanNodeSummary[]>([]);
  useEffect(() => {
    if (!isDemoMode()) return;
    void import("@/mock/mock-can-bus").then((mod) => {
      mockBusRef.current = mod;
    });
    const id = setInterval(() => {
      if (!mockBusRef.current) return;
      setNodeSummaries(mockBusRef.current.mockCanBus.getNodeSummaries());
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Get last 50 frames for display
  const recentFrames = useMemo(() => {
    return framesBuffer.last(50).reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesBuffer, version]);

  // Top 5 most active CAN IDs
  const topIds = useMemo(() => {
    const entries = Array.from(idCounts.entries());
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idCounts, version]);

  const demo = isDemoMode();

  return (
    <div className="p-4 max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">CAN Bus Monitor</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={clear}
            disabled={!enabled || totalFrames === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-status-error hover:text-status-error text-text-secondary transition-colors disabled:opacity-30"
            title="Clear frames"
          >
            <Trash2 size={12} />
            Clear
          </button>
          {!demo && (
            <div className="w-24">
              <Select
                value={bus}
                onChange={setBus}
                disabled={enabled || starting}
                options={[{ value: "1", label: "Bus 1" }, { value: "2", label: "Bus 2" }]}
              />
            </div>
          )}
          <button
            onClick={toggleCapture}
            disabled={starting}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors disabled:opacity-50",
              enabled
                ? "bg-status-success/20 text-status-success hover:bg-status-success/30"
                : "bg-bg-tertiary text-text-secondary hover:bg-bg-secondary",
            )}
          >
            <Power size={12} />
            {enabled ? "Capturing (Stop)" : starting ? "Starting..." : "Start"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <div className="flex items-center gap-1.5 text-text-tertiary mb-1">
            <Activity size={11} />
            <span className="text-[10px] uppercase tracking-wider font-medium">Total Frames</span>
          </div>
          <p className="text-lg font-mono font-semibold text-text-primary">{totalFrames.toLocaleString()}</p>
        </div>
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <div className="flex items-center gap-1.5 text-text-tertiary mb-1">
            <Activity size={11} />
            <span className="text-[10px] uppercase tracking-wider font-medium">Frames/sec</span>
          </div>
          <p className="text-lg font-mono font-semibold text-text-primary">{liveFps}</p>
        </div>
        <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
          <div className="flex items-center gap-1.5 text-text-tertiary mb-1">
            <Activity size={11} />
            <span className="text-[10px] uppercase tracking-wider font-medium">Distinct IDs</span>
          </div>
          <p className="text-lg font-mono font-semibold text-text-primary">{idCounts.size}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Left column: Nodes + Top IDs */}
        <div className="lg:col-span-1 space-y-3">
          {/* Detected nodes — demo mode shows the simulated bus topology */}
          {demo && nodeSummaries.length > 0 && (
            <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2 flex items-center gap-1.5">
                <Cpu size={11} />
                Detected Nodes
              </h3>
              <div className="space-y-2">
                {nodeSummaries.map((node) => (
                  <div
                    key={node.nodeId}
                    className="flex items-start justify-between gap-2 pb-2 border-b border-border-default last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-text-primary truncate">{node.name}</p>
                      <p className="text-[10px] text-text-tertiary font-mono">
                        Node {node.nodeId} · {node.category}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-accent-primary shrink-0">
                      {node.framesPerSecond} fps
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top IDs */}
          {topIds.length > 0 && (
            <div className="border border-border-default rounded-lg p-3 bg-bg-secondary">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-2">
                Most Active IDs
              </h3>
              <div className="space-y-1">
                {topIds.map(([id, count]) => {
                  const hint = getCanIdHint(id);
                  return (
                    <div key={id} className="flex items-center justify-between gap-2 text-[10px] font-mono">
                      <div className="min-w-0">
                        <div className="text-text-primary truncate">0x{hex(id, 8)}</div>
                        {hint && (
                          <div className="text-accent-primary truncate">{hint.label}</div>
                        )}
                      </div>
                      <span className="text-text-tertiary shrink-0">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Frames table */}
        <div className="lg:col-span-3 border border-border-default rounded-lg bg-bg-secondary overflow-hidden">
          <div className="px-3 py-2 border-b border-border-default">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Recent Frames {recentFrames.length > 0 && `(${recentFrames.length})`}
            </h3>
          </div>
          {!enabled ? (
            <div className="text-center py-12">
              <p className="text-xs text-text-tertiary">Click Start to begin capturing CAN frames</p>
            </div>
          ) : recentFrames.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-xs text-text-tertiary">Waiting for CAN frames...</p>
              <p className="text-[10px] text-text-tertiary mt-1">
                Frames arrive only while forwarding is on. The selected bus needs a CAN driver enabled on the flight controller (CAN_P1_DRIVER / CAN_P2_DRIVER non-zero).
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[480px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-bg-secondary">
                  <tr className="border-b border-border-default text-text-tertiary">
                    <th className="text-left py-1.5 px-3 font-medium">Time</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Bus</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Node</th>
                    <th className="text-left py-1.5 pr-3 font-medium">CAN ID</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Label</th>
                    <th className="text-left py-1.5 pr-3 font-medium">DLC</th>
                    <th className="text-left py-1.5 pr-3 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFrames.map((frame, i) => {
                    const time = new Date(frame.timestamp).toLocaleTimeString("en-IN", {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    const ms = String(frame.timestamp % 1000).padStart(3, "0");
                    const hint = getCanIdHint(frame.id);
                    const node = sourceNodeId(frame.id);
                    return (
                      <tr key={`${frame.timestamp}-${i}`} className="border-b border-border-default last:border-b-0 hover:bg-bg-primary/40">
                        <td className="py-1 px-3 font-mono text-text-tertiary text-[10px]">
                          {time}.{ms}
                        </td>
                        <td className="py-1 pr-3 font-mono text-text-secondary">
                          {frame.bus}
                        </td>
                        <td className="py-1 pr-3 font-mono text-text-secondary">
                          {node}
                        </td>
                        <td className="py-1 pr-3 font-mono text-accent-primary">
                          0x{hex(frame.id, 8)}
                        </td>
                        <td className="py-1 pr-3 text-text-primary">
                          {hint ? hint.label : <span className="text-text-tertiary">—</span>}
                        </td>
                        <td className="py-1 pr-3 font-mono text-text-secondary">
                          {frame.len}
                        </td>
                        <td className="py-1 pr-3 font-mono text-text-secondary">
                          {formatData(frame.data, frame.len)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
