/**
 * @module Px4ActuatorTest
 * @description Live single-output actuator test for PX4 (MAV_CMD_ACTUATOR_TEST).
 * Runs one motor or servo at a chosen value for a short, bounded timeout after
 * which the FC restores the output; the FC also rejects the command while
 * armed. Rendered inside the PX4 Actuators panel.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AlertTriangle, Play, Square } from "lucide-react";

/** Test runs for at most this long; the FC auto-restores the output afterwards. */
const TEST_TIMEOUT_S = 2;

// ACTUATOR_OUTPUT_FUNCTION codes: Motor1=1..16, Servo1=33..48.
const OUTPUT_OPTIONS = [
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Motor ${i + 1}` })),
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(33 + i), label: `Servo ${i + 1}` })),
];

const isMotor = (fn: number) => fn >= 1 && fn <= 16;

export function Px4ActuatorTest({ connected }: { connected: boolean }) {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { isHardBlocked } = useArmedLock();
  const { toast } = useToast();
  const [propsRemoved, setPropsRemoved] = useState(false);
  const [fn, setFn] = useState("1");
  const [pct, setPct] = useState(0);
  const [busy, setBusy] = useState(false);

  const func = parseInt(fn, 10);
  const motor = isMotor(func);
  const min = motor ? 0 : -100;

  // True only when the FC acknowledged the command. A NACK, timeout or
  // dropped link is toasted with the FC's reason, never reported as running.
  const send = useCallback(
    async (value: number, timeoutS: number) => {
      const protocol = selectedProtocol;
      if (!protocol?.actuatorTest) {
        toast("Actuator test is not available on this connection", "error");
        return false;
      }
      if (isHardBlocked) {
        toast("Disarm to test actuators", "error");
        return false;
      }
      setBusy(true);
      try {
        const result = await protocol.actuatorTest(func, value, timeoutS);
        if (!result.success) {
          toast(`Actuator test refused: ${result.message || "no acknowledgement from the flight controller"}`, "error");
        }
        return result.success;
      } catch (err) {
        toast(`Actuator test failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [selectedProtocol, isHardBlocked, toast, func],
  );

  const selectFn = (v: string) => {
    setFn(v);
    setPct(0); // reset value when switching output (motor 0..100 vs servo -100..100)
  };

  const run = async () => {
    const value = Math.max(min, Math.min(100, pct)) / 100;
    if (await send(value, TEST_TIMEOUT_S)) {
      toast(`Testing ${OUTPUT_OPTIONS.find((o) => o.value === fn)?.label} for ${TEST_TIMEOUT_S}s — keep clear`, "warning");
    }
  };
  // NaN stops the output immediately. The FC restores it after the timeout
  // anyway, but a refused Stop must still be visible.
  const stop = async () => {
    if (await send(NaN, 0)) toast("Actuator test stopped", "info");
  };

  const disabled = !connected || isHardBlocked || busy || !propsRemoved;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 bg-status-error/10 border border-status-error/20 rounded">
        <AlertTriangle size={16} className="text-status-error shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-status-error">REMOVE ALL PROPELLERS BEFORE TESTING</p>
          <p className="text-[10px] text-status-error/80 mt-0.5">
            The selected motor spins (or servo moves) at the chosen value for {TEST_TIMEOUT_S}s, then
            the FC restores it. The FC rejects the test while armed.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={propsRemoved}
          onChange={(e) => setPropsRemoved(e.target.checked)}
          className="w-4 h-4 rounded border-border-default bg-bg-tertiary accent-accent-primary"
        />
        <span className="text-xs text-text-secondary">I confirm all propellers have been removed</span>
      </label>
      {isHardBlocked && <p className="text-[10px] text-status-error">Disarm to test actuators.</p>}

      <div className="flex items-end gap-3 flex-wrap">
        <div className="w-32">
          <Select label="Output" options={OUTPUT_OPTIONS} value={fn} onChange={selectFn} disabled={disabled} searchable />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <div className="flex justify-between text-[10px] text-text-secondary mb-1">
            <span>{motor ? "Throttle" : "Position"}</span>
            <span className="font-mono tabular-nums">{pct}%</span>
          </div>
          <input
            type="range"
            min={min}
            max={100}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            disabled={disabled}
            className="w-full accent-accent-primary disabled:opacity-30"
          />
        </div>
        <Button variant="secondary" size="sm" icon={<Play size={12} />} disabled={disabled} onClick={run}>
          Run {TEST_TIMEOUT_S}s
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Square size={12} />}
          disabled={!connected || busy}
          className="border-status-error text-status-error"
          onClick={stop}
        >
          Stop
        </Button>
      </div>
    </div>
  );
}
