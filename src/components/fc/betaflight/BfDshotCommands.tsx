/**
 * @module BfDshotCommands
 * @description Betaflight DShot special commands (MSP2_SEND_DSHOT_COMMAND):
 * beacon (locate), per-motor spin direction, and 3D mode. Config commands only
 * — none spin the motors, and the FC ignores all of them while armed. Rendered
 * inside the Motors panel, and only for a DShot ESC protocol.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AlertTriangle, Bell, RotateCw } from "lucide-react";
import { DSHOT_CMD, DSHOT_COMMAND_TYPE, DSHOT_ALL_MOTORS } from "./bf-dshot-constants";

const MOTOR_OPTIONS = [
  { value: String(DSHOT_ALL_MOTORS), label: "All motors" },
  ...Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: `Motor ${i + 1}` })),
];

export function BfDshotCommands({ connected }: { connected: boolean }) {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { isHardBlocked } = useArmedLock();
  const { toast } = useToast();
  const [propsRemoved, setPropsRemoved] = useState(false);
  const [motor, setMotor] = useState(String(DSHOT_ALL_MOTORS));
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (commandType: number, motorIndex: number, cmds: number[]) => {
      const protocol = getSelectedProtocol();
      if (!protocol?.sendDshotCommand) {
        toast("DShot commands are not available on this connection", "error");
        return false;
      }
      if (isHardBlocked) {
        toast("Disarm to send ESC commands", "error");
        return false;
      }
      setBusy(true);
      try {
        // DShot commands have no ESC acknowledgement; a result only says the
        // flight controller accepted the MSP request.
        for (const c of cmds) {
          const result = await protocol.sendDshotCommand(commandType, motorIndex, [c]);
          if (!result.success) {
            toast(result.message || "The flight controller rejected the DShot command", "error");
            return false;
          }
        }
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not send the DShot command", "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [getSelectedProtocol, isHardBlocked, toast],
  );

  const disabled = !connected || isHardBlocked || busy || !propsRemoved;

  const beep = async () => {
    if (await run(DSHOT_COMMAND_TYPE.INLINE, DSHOT_ALL_MOTORS, [DSHOT_CMD.BEACON1])) {
      toast("Beacon command sent", "info");
    }
  };

  const setDirection = async (reversed: boolean) => {
    const cmd = reversed ? DSHOT_CMD.SPIN_DIRECTION_REVERSED : DSHOT_CMD.SPIN_DIRECTION_NORMAL;
    if (await run(DSHOT_COMMAND_TYPE.BLOCKING, parseInt(motor, 10), [cmd, DSHOT_CMD.SAVE_SETTINGS])) {
      toast(`Spin direction ${reversed ? "reversed" : "normal"} and save commands sent. ESCs do not confirm; check the direction with a motor test.`, "info");
    }
  };

  const set3d = async (on: boolean) => {
    const cmd = on ? DSHOT_CMD.THREED_MODE_ON : DSHOT_CMD.THREED_MODE_OFF;
    if (await run(DSHOT_COMMAND_TYPE.BLOCKING, DSHOT_ALL_MOTORS, [cmd, DSHOT_CMD.SAVE_SETTINGS])) {
      toast(`3D mode ${on ? "on" : "off"} and save commands sent. ESCs do not confirm the change.`, "info");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 p-3 bg-status-error/10 border border-status-error/20 rounded">
        <AlertTriangle size={16} className="text-status-error shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-status-error">REMOVE ALL PROPELLERS · DShot ESCs only</p>
          <p className="text-[10px] text-status-error/80 mt-0.5">
            Commands apply only while disarmed; the FC ignores them when armed. Reversing spin
            direction changes which way a motor turns — set both prop and direction consistently.
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
      {isHardBlocked && <p className="text-[10px] text-status-error">Disarm to send ESC commands.</p>}

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" icon={<Bell size={12} />} disabled={disabled} onClick={beep}>
          Beep (locate)
        </Button>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="w-32">
          <Select label="Spin direction — motor" options={MOTOR_OPTIONS} value={motor} onChange={setMotor} disabled={disabled} />
        </div>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setDirection(false)}>
          Set Normal
        </Button>
        <Button variant="secondary" size="sm" icon={<RotateCw size={12} />} disabled={disabled} onClick={() => setDirection(true)}>
          Set Reversed
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-secondary">3D mode:</span>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => set3d(true)}>
          Enable
        </Button>
        <Button variant="secondary" size="sm" disabled={disabled} onClick={() => set3d(false)}>
          Disable
        </Button>
      </div>
    </div>
  );
}
