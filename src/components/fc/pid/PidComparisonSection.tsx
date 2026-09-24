"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { PidResponseChart } from "./PidResponseChart";
import { ParamTooltip } from "../parameters/ParamTooltip";
import { AXIS_COLORS } from "../chart-theme";
import { Copy, BarChart3, Play } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Autotune Section ─────────────────────────────────────────

/**
 * ArduCopter AUTOTUNE. "In progress" is the vehicle's reported flight mode,
 * not the button click: leaving AUTOTUNE on the sticks or losing the link
 * ends it here too. Status text is collected only while a request is pending
 * or the vehicle is in AUTOTUNE, and the subscription is released when that
 * ends or the panel unmounts. The caller hides the section on firmware
 * without an ArduCopter AUTOTUNE mode.
 */
export function AutotuneSection({ connected }: { connected: boolean }) {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const flightMode = useDroneStore((s) => s.flightMode);
  const autotuneActive = connected && flightMode === "AUTOTUNE";
  const [requesting, setRequesting] = useState(false);
  const [autotuneLog, setAutotuneLog] = useState<string[]>([]);
  const [showAutotune, setShowAutotune] = useState(false);
  const listening = requesting || autotuneActive;

  useEffect(() => {
    if (!listening) return;
    const protocol = selectedProtocol;
    if (!protocol) return;
    return protocol.onStatusText(({ text }) => {
      setAutotuneLog((prev) => [...prev.slice(-19), text]);
    });
  }, [listening, selectedProtocol]);

  const triggerAutotune = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol) return;

    setRequesting(true);
    setAutotuneLog(["Requesting AUTOTUNE mode..."]);
    try {
      const result = await protocol.setFlightMode("AUTOTUNE");
      setAutotuneLog((prev) => [
        ...prev,
        result.success
          ? "AUTOTUNE accepted - fly in open area"
          : `Failed to enter AUTOTUNE: ${result.message ?? "rejected"}`,
      ]);
    } catch {
      setAutotuneLog((prev) => [...prev, "Failed to set AUTOTUNE mode"]);
    } finally {
      setRequesting(false);
    }
  }, [selectedProtocol]);

  return (
    <div className="border border-border-default bg-bg-secondary">
      <button
        onClick={() => setShowAutotune((a) => !a)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-bg-tertiary/50"
      >
        <Play size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">Autotune</h2>
        <span className="text-[10px] text-text-tertiary ml-auto">{showAutotune ? "\u25BE" : "\u25B8"}</span>
      </button>
      {showAutotune && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-[10px] text-text-tertiary">
            Switches to AUTOTUNE flight mode. Vehicle must be airborne in a calm environment.
            Fly in roll/pitch/yaw — the controller automatically adjusts PID gains.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant={autotuneActive ? "danger" : "secondary"}
              size="sm"
              icon={<Play size={12} />}
              disabled={!connected || autotuneActive || requesting}
              onClick={triggerAutotune}
            >
              {autotuneActive ? "Autotune Active..." : "Start Autotune"}
            </Button>
            {autotuneActive && (
              <span className="text-[10px] text-status-warning animate-pulse">
                Fly in open area — autotune in progress
              </span>
            )}
          </div>
          {autotuneLog.length > 0 && (
            <div className="bg-bg-tertiary/50 border border-border-default p-2 max-h-32 overflow-y-auto">
              {autotuneLog.map((line, i) => (
                <div key={i} className="text-[10px] font-mono text-text-secondary">{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live PID Response Graph ──────────────────────────────────

export function LivePidResponseGraph({ connected }: { connected: boolean }) {
  const attitudeRing = useTelemetryStore((s) => s.attitude);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(interval);
  }, []);

  const recentAttitude = useMemo(() => {
    const cutoff = Date.now() - 15_000;
    return attitudeRing.toArray().filter((a) => a.timestamp >= cutoff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, attitudeRing.length]);

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">Live Attitude Response</h2>
        <span className="text-[10px] text-text-tertiary ml-auto">
          {recentAttitude.length > 0 ? `${recentAttitude.length} pts, 15s window` : "No data"}
        </span>
      </div>
      {recentAttitude.length < 2 ? (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <BarChart3 size={20} className="text-text-tertiary mb-1" />
          <span className="text-[10px] text-text-tertiary">
            {connected ? "Waiting for attitude data..." : "Connect a drone to view live response"}
          </span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <PidResponseChart data={recentAttitude.map((a) => a.roll)} label="Roll" color={AXIS_COLORS.roll} />
          <PidResponseChart data={recentAttitude.map((a) => a.pitch)} label="Pitch" color={AXIS_COLORS.pitch} />
          <PidResponseChart data={recentAttitude.map((a) => a.yaw)} label="Yaw" color={AXIS_COLORS.yaw} />
        </div>
      )}
    </div>
  );
}

// ── Before/After Comparison ──────────────────────────────────

export function PidSnapshotComparison({
  params,
}: {
  params: Map<string, number>;
}) {
  const { paramName: pn } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const [snapshot, setSnapshot] = useState<Map<string, number> | null>(null);

  function snapshotCurrent() {
    setSnapshot(new Map(params));
  }

  return (
    <div className="border border-border-default bg-bg-secondary p-4">
      <div className="flex items-center gap-2 mb-3">
        <Copy size={14} className="text-accent-primary" />
        <h2 className="text-sm font-medium text-text-primary">Before / After</h2>
        <Button variant="ghost" size="sm" onClick={snapshotCurrent} className="ml-auto">
          Snapshot Current
        </Button>
      </div>
      {!snapshot ? (
        <p className="text-[10px] text-text-tertiary">
          Click &quot;Snapshot Current&quot; to save current PID values, then adjust — compare side-by-side.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="border-b border-border-default text-text-tertiary">
                <th className="text-left py-1 pr-3">Param</th>
                <th className="text-right py-1 px-2">Before</th>
                <th className="text-right py-1 px-2">Current</th>
                <th className="text-right py-1 pl-2">Delta</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(snapshot.entries())
                .filter(([name]) => {
                  const current = params.get(name) ?? 0;
                  const before = snapshot.get(name) ?? 0;
                  return current !== before;
                })
                .map(([name]) => {
                  const before = snapshot.get(name) ?? 0;
                  const current = params.get(name) ?? 0;
                  const delta = current - before;
                  return (
                    <tr key={name} className="border-b border-border-default/50">
                      <td className="py-0.5 pr-3 text-text-secondary"><ParamTooltip meta={paramMeta.get(name)}><span className="cursor-default">{pn(name)}</span></ParamTooltip></td>
                      <td className="py-0.5 px-2 text-right text-text-tertiary">{before.toFixed(4)}</td>
                      <td className="py-0.5 px-2 text-right text-text-primary">{current.toFixed(4)}</td>
                      <td className={cn(
                        "py-0.5 pl-2 text-right",
                        delta > 0 ? "text-status-success" : delta < 0 ? "text-status-error" : "text-text-tertiary",
                      )}>
                        {delta > 0 ? "+" : ""}{delta.toFixed(4)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          {Array.from(snapshot.entries()).every(([name]) => (params.get(name) ?? 0) === (snapshot.get(name) ?? 0)) && (
            <p className="text-[10px] text-text-tertiary text-center py-2">No changes from snapshot</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── PX4 Gain Multipliers ────────────────────────────────────

export function Px4GainMultipliers({
  params,
  setLocalValue,
  hasLoaded,
}: {
  params: Map<string, number>;
  setLocalValue: (name: string, value: number) => void;
  hasLoaded: boolean;
}) {
  if (!hasLoaded) return null;

  return (
    <section className="border-t border-border-strong pt-4 mt-4">
      <h3 className="text-sm font-medium text-text-secondary mb-3">PX4 Gain Multipliers</h3>
      <p className="text-xs text-text-tertiary mb-3">Overall rate controller gain scaling. Default 1.0. Reduce to dampen response.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {["MC_ROLLRATE_K", "MC_PITCHRATE_K", "MC_YAWRATE_K"].map((param) => (
          <div key={param}>
            <label className="text-xs text-text-secondary mb-1 block">{param.replace("MC_", "").replace("RATE_K", "")}</label>
            <Input
              type="number"
              step={0.1}
              min={0}
              max={5}
              value={String(params.get(param) ?? 1.0)}
              onChange={(e) => setLocalValue(param, Number(e.target.value) || 0)}
              className="h-8 text-xs"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
