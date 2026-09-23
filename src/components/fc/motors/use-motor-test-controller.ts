/**
 * @module use-motor-test-controller
 * @description The one owner of an MSP bench motor test. It keeps the
 * commanded throttle of every output and sends them together in one frame, so
 * raising one motor never idles another. Every frame carries a short duration
 * that the adapter turns into an automatic stop, and a keepalive re-sends the
 * frame while any motor is commanded, so a stalled page still ends the test.
 *
 * The test ends, with an all-idle frame, whenever the panel unmounts, the
 * selected drone changes or disconnects, or the aircraft arms. What the
 * panel shows as running is the FC's own reported motor output, not what was
 * asked for.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { freshOnly } from "@/lib/telemetry/freshness";
import type { DroneProtocol } from "@/lib/protocol/types";

/** Seconds the adapter keeps a frame live before it idles every output. */
export const MOTOR_TEST_HOLD_S = 2;
/** Keepalive period; well inside the hold so a live test never gaps. */
export const MOTOR_TEST_KEEPALIVE_MS = 1_000;
/** Outputs one MSP_SET_MOTOR frame carries. */
const MOTOR_OUTPUTS = 8;
const ALL_IDLE: readonly number[] = Array(MOTOR_OUTPUTS).fill(0);

export interface MotorTestController {
  /** A protocol that can run the test is selected. */
  supported: boolean;
  /** The operator has enabled the test and it has not been stopped. */
  active: boolean;
  /** Motors the FC reports driving, or null before its first fresh report. */
  motorCount: number | null;
  /** Commanded throttle per output, percent. */
  commanded: readonly number[];
  /** FC-reported throttle per motor, percent, or null when the report is stale. */
  reported: readonly (number | null)[];
  /** Last refusal or failure, cleared by the next successful frame. */
  error: string | null;
  enable: () => boolean;
  setMotor: (motor: number, pct: number) => void;
  setAll: (pct: number) => void;
  stop: () => void;
}

/** Send the all-idle frame; a failure here has nowhere further to go. */
function sendIdle(protocol: DroneProtocol | null): void {
  void protocol?.setMotorTestOutputs?.(ALL_IDLE, MOTOR_TEST_HOLD_S).catch(() => {});
}

export function useMotorTestController(): MotorTestController {
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const protocol = useDroneManager((s) =>
    s.selectedDroneId ? s.drones.get(s.selectedDroneId)?.protocol ?? null : null,
  );
  const { isHardBlocked } = useArmedLock();
  const servoBuffer = useTelemetryStore((s) => s.servoOutput);
  const telVersion = useTelemetryStore((s) => s._version);

  const [active, setActive] = useState(false);
  const [commanded, setCommanded] = useState<readonly number[]>(ALL_IDLE);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Refs let the teardown paths see the live values without re-subscribing.
  const activeRef = useRef(false);
  const commandedRef = useRef<readonly number[]>(ALL_IDLE);

  const reset = useCallback(() => {
    activeRef.current = false;
    commandedRef.current = ALL_IDLE;
    setActive(false);
    setCommanded(ALL_IDLE);
  }, []);

  const send = useCallback(
    (next: readonly number[]) => {
      if (!protocol?.setMotorTestOutputs) return;
      commandedRef.current = next;
      setCommanded(next);
      protocol.setMotorTestOutputs(next, MOTOR_TEST_HOLD_S).then(
        (result) => {
          if (result.success) {
            setError(null);
            return;
          }
          // A refused frame wrote nothing; end the test so the sliders stop
          // claiming a command the FC never took.
          setError(result.message);
          sendIdle(protocol);
          reset();
        },
        (err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          reset();
        },
      );
    },
    [protocol, reset],
  );

  // Unmount, drone switch and disconnect all change or drop `protocol`: the
  // cleanup idles the protocol the test was running on.
  useEffect(() => {
    return () => {
      if (activeRef.current) sendIdle(protocol);
      reset();
    };
  }, [protocol, droneId, reset]);

  // Arming ends the test. The idle frame still goes out: the FC keeps the
  // last test value and would apply it again after the next disarm.
  useEffect(() => {
    if (isHardBlocked && activeRef.current) {
      sendIdle(protocol);
      reset();
    }
  }, [isHardBlocked, protocol, reset]);

  // Keepalive while anything is commanded; the adapter's hold is the backstop.
  const anyCommanded = commanded.some((v) => v > 0);
  useEffect(() => {
    if (!active || !anyCommanded) return;
    const id = setInterval(() => {
      if (activeRef.current) send(commandedRef.current);
    }, MOTOR_TEST_KEEPALIVE_MS);
    return () => clearInterval(id);
  }, [active, anyCommanded, send]);

  // A 1 Hz clock so a report that stops arriving is shown as stale.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const report = useMemo(() => {
    const latest = freshOnly(servoBuffer.latest(), now);
    return latest && latest.port === 0 ? latest.servos : undefined;
    // telVersion re-reads the ring buffer when a new sample lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servoBuffer, telVersion, now]);

  // MSP_MOTOR reports every output slot; slots past the motor count read 0.
  const motorCount = report ? Math.min(MOTOR_OUTPUTS, report.filter((v) => v > 0).length) : null;
  const reported = Array.from({ length: motorCount ?? 0 }, (_, i) =>
    report ? Math.min(100, Math.max(0, Math.round((report[i] - 1000) / 10))) : null,
  );

  const enable = useCallback(() => {
    if (isHardBlocked || !protocol?.setMotorTestOutputs) return false;
    activeRef.current = true;
    setActive(true);
    setError(null);
    return true;
  }, [isHardBlocked, protocol]);

  const setMotor = useCallback(
    (motor: number, pct: number) => {
      if (!activeRef.current) return;
      const next = [...commandedRef.current];
      next[motor] = pct;
      send(next);
    },
    [send],
  );

  const setAll = useCallback(
    (pct: number) => {
      if (!activeRef.current || motorCount === null) return;
      send(ALL_IDLE.map((_, i) => (i < motorCount ? pct : 0)));
    },
    [send, motorCount],
  );

  const stop = useCallback(() => {
    sendIdle(protocol);
    reset();
  }, [protocol, reset]);

  return {
    supported: !!protocol?.setMotorTestOutputs,
    active,
    motorCount,
    commanded,
    reported,
    error,
    enable,
    setMotor,
    setAll,
    stop,
  };
}
