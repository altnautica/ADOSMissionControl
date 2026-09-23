/**
 * @module ProgrammingPidPanel
 * @description iNav Programming PID editor.
 * Reads up to 4 programming PID rules from the FC, allows in-place editing,
 * and writes all rules back. Displays live PID output while armed.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";
import { useProgrammingStore, PROGRAMMING_PID_MAX } from "@/stores/programming-store";
import { PanelHeader } from "../../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { Sliders, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { LOGIC_OPERAND_TYPE_OPTIONS } from "./programming-constants";

// The setpoint and measurement are logic operands (logicOperandType_e).
const OPERAND_TYPE_OPTIONS = LOGIC_OPERAND_TYPE_OPTIONS;

// ── Component ─────────────────────────────────────────────────

export function ProgrammingPidPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { isArmed } = useArmedLock();

  const pids = useProgrammingStore((s) => s.pids);
  const pidStatus = useProgrammingStore((s) => s.pidStatus);
  const pidStatusAt = useProgrammingStore((s) => s.pidStatusAt);
  const loading = useProgrammingStore((s) => s.loading);
  const error = useProgrammingStore((s) => s.error);
  const pidsDirty = useProgrammingStore((s) => s.pidsDirty);
  useUnsavedGuard(pidsDirty);
  const setPid = useProgrammingStore((s) => s.setPid);
  const loadFromFc = useProgrammingStore((s) => s.loadFromFc);
  const uploadPids = useProgrammingStore((s) => s.uploadPids);
  const startPolling = useProgrammingStore((s) => s.startPolling);
  const stopPolling = useProgrammingStore((s) => s.stopPolling);

  const connected = !!getSelectedProtocol();
  const hasLoaded = useProgrammingStore((s) => s.loaded);

  // The live output is MSP2_INAV_PROGRAMMING_PID_STATUS, polled while armed.
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    if (isArmed && connected) startPolling(protocol, 500);
    else stopPolling();
    return () => stopPolling();
  }, [isArmed, connected, getSelectedProtocol, startPolling, stopPolling]);

  const handleRead = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await loadFromFc(protocol);
    const err = useProgrammingStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Programming PIDs loaded from FC", "success");
    }
  }, [getSelectedProtocol, loadFromFc, toast]);

  const handleWrite = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await uploadPids(protocol);
    const err = useProgrammingStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Programming PIDs written to FC", "success");
    }
  }, [getSelectedProtocol, uploadPids, toast]);

  // An output is live only while the last status read is recent; a failed or
  // stopped poll leaves the old outputs, which must not read as current.
  useClockTick();
  const now = useClockStore((s) => s.now);
  const statusLive = pidStatusAt !== null && isFresh(pidStatusAt, now);
  const statusFor = (idx: number) => (statusLive ? pidStatus.find((s) => s.id === idx) : undefined);

  const setGain = (idx: number, key: "P" | "I" | "D" | "FF", val: number) => {
    setPid(idx, { gains: { ...pids[idx].gains, [key]: val } });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-4">
        <PanelHeader
          title="Programming PIDs"
          subtitle={`Up to ${PROGRAMMING_PID_MAX} software PID controllers driven by logic conditions`}
          icon={<Sliders size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          {hasLoaded && (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              loading={loading}
              disabled={!connected || loading || isArmed}
              onClick={handleWrite}
            >
              Write to FC
            </Button>
          )}
        </PanelHeader>

        {isArmed && (
          <p className="text-[10px] font-mono text-status-warning">
            {statusLive
              ? "Armed: edits disabled. Live output visible below."
              : "Armed: edits disabled. Live output is not being received."}
          </p>
        )}

        {pidsDirty && !isArmed && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes: use Write to FC to persist.
          </p>
        )}

        {hasLoaded && (
          <div className="space-y-3">
            {Array.from({ length: PROGRAMMING_PID_MAX }, (_, idx) => {
              const pid = pids[idx];
              const st = statusFor(idx);
              return (
                <div
                  key={idx}
                  className={cn(
                    "border border-border-default rounded p-3 space-y-2",
                    pid.enabled ? "bg-bg-primary" : "bg-bg-secondary opacity-60",
                  )}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-text-tertiary w-6">PID {idx}</span>
                    <button
                      disabled={isArmed}
                      onClick={() => setPid(idx, { enabled: !pid.enabled })}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors shrink-0",
                        pid.enabled ? "bg-accent-primary" : "bg-bg-tertiary border border-border-default",
                      )}
                      aria-label={pid.enabled ? "Disable" : "Enable"}
                    >
                      <div
                        className={cn(
                          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
                          pid.enabled ? "translate-x-4" : "translate-x-0.5",
                        )}
                      />
                    </button>
                    {st !== undefined && (
                      <span className="ml-auto text-[10px] font-mono text-status-success">
                        output: {st.output}
                      </span>
                    )}
                  </div>

                  {/* Setpoint row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] text-text-tertiary w-20 shrink-0">Setpoint</span>
                    <div className="w-28">
                      <Select
                        label=""
                        options={OPERAND_TYPE_OPTIONS}
                        value={String(pid.setpointType)}
                        onChange={(v) => setPid(idx, { setpointType: parseInt(v) })}
                        disabled={isArmed}
                      />
                    </div>
                    <input
                      disabled={isArmed}
                      type="number"
                      value={pid.setpointValue}
                      onChange={(e) => setPid(idx, { setpointValue: parseInt(e.target.value) || 0 })}
                      className="w-20 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded px-1 py-0.5 text-text-primary"
                    />
                  </div>

                  {/* Measurement row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] text-text-tertiary w-20 shrink-0">Measurement</span>
                    <div className="w-28">
                      <Select
                        label=""
                        options={OPERAND_TYPE_OPTIONS}
                        value={String(pid.measurementType)}
                        onChange={(v) => setPid(idx, { measurementType: parseInt(v) })}
                        disabled={isArmed}
                      />
                    </div>
                    <input
                      disabled={isArmed}
                      type="number"
                      value={pid.measurementValue}
                      onChange={(e) => setPid(idx, { measurementValue: parseInt(e.target.value) || 0 })}
                      className="w-20 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded px-1 py-0.5 text-text-primary"
                    />
                  </div>

                  {/* Gains row */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[9px] text-text-tertiary w-20 shrink-0">Gains</span>
                    {(["P", "I", "D", "FF"] as const).map((key) => (
                      <div key={key} className="flex items-center gap-1">
                        <span className="text-[9px] font-mono text-text-tertiary">{key}</span>
                        <input
                          disabled={isArmed}
                          type="number"
                          min={0}
                          max={255}
                          value={pid.gains[key]}
                          onChange={(e) => setGain(idx, key, Math.min(255, Math.max(0, parseInt(e.target.value) || 0)))}
                          className="w-14 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded px-1 py-0.5 text-text-primary"
                        />
                      </div>
                    ))}
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
