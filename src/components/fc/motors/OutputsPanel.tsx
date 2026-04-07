"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { SERVO_FUNCTION_GROUPS } from "@/lib/servo-functions";
import {
  detectBoardProfile, detectTimerGroupConflicts,
  UNKNOWN_BOARD, type BoardProfile, type TimerGroupConflict,
} from "@/lib/board-profiles";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { PanelHeader } from "../shared/PanelHeader";
import { OutputTimerGroupConfig, type PwmWarning } from "./OutputTimerGroupConfig";
import { ServoMappingTable, type OutputRow } from "../misc/ServoMappingTable";
import { MotorTestSection } from "./MotorTestSection";
import { ServoTestSection } from "./ServoTestSection";
import { Save, HardDrive } from "lucide-react";

const OUTPUT_COUNT = 16;
const PWM_ABS_MIN = 800;
const PWM_ABS_MAX = 2200;

const OUTPUT_PARAMS: string[] = [
  ...Array.from({ length: OUTPUT_COUNT }, (_, i) => {
    const n = i + 1;
    return [`SERVO${n}_FUNCTION`, `SERVO${n}_MIN`, `SERVO${n}_MAX`, `SERVO${n}_TRIM`, `SERVO${n}_REVERSED`];
  }).flat(),
];

const OPTIONAL_OUTPUT_PARAMS = ['MOT_PWM_TYPE'];

function validateOutputs(rows: OutputRow[]): { pwmWarnings: PwmWarning[]; conflicts: string[] } {
  const pwmWarnings: PwmWarning[] = [];
  const conflicts: string[] = [];
  const fnAssignments = new Map<number, number[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const n = i + 1;
    if (row.function === -1) continue;
    if (row.min < PWM_ABS_MIN || row.min > PWM_ABS_MAX) pwmWarnings.push({ output: n, message: `Min (${row.min}) outside ${PWM_ABS_MIN}-${PWM_ABS_MAX}` });
    if (row.max < PWM_ABS_MIN || row.max > PWM_ABS_MAX) pwmWarnings.push({ output: n, message: `Max (${row.max}) outside ${PWM_ABS_MIN}-${PWM_ABS_MAX}` });
    if (row.min >= row.max) pwmWarnings.push({ output: n, message: `Min (${row.min}) >= Max (${row.max})` });
    if (row.trim < row.min || row.trim > row.max) pwmWarnings.push({ output: n, message: `Trim (${row.trim}) outside Min/Max range` });
    if (row.function > 0) {
      const existing = fnAssignments.get(row.function) ?? [];
      existing.push(n);
      fnAssignments.set(row.function, existing);
    }
  }

  for (const [fnId, outputs] of fnAssignments) {
    if (outputs.length > 1) {
      const fnLabel = SERVO_FUNCTION_GROUPS.flatMap((g) => g.functions).find((f) => f.value === fnId)?.label ?? `ID ${fnId}`;
      conflicts.push(`"${fnLabel}" assigned to outputs ${outputs.join(", ")}`);
    }
  }
  return { pwmWarnings, conflicts };
}

export function OutputsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const protocol = getSelectedProtocol();
  const { toast } = useToast();
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const [saving, setSaving] = useState(false);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: OUTPUT_PARAMS, optionalParams: OPTIONAL_OUTPUT_PARAMS, panelId: "outputs", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const gpioOutputs = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < OUTPUT_COUNT; i++) {
      if ((params.get(`SERVO${i + 1}_FUNCTION`) ?? 0) === -1) set.add(i + 1);
    }
    return set;
  }, [params]);

  const servoBuffer = useTelemetryStore((s) => s.servoOutput);
  const latestServo = servoBuffer.latest();
  const liveServos = latestServo?.servos ?? [];

  const getOutput = useCallback((i: number): OutputRow => ({
    function: params.get(`SERVO${i + 1}_FUNCTION`) ?? 0,
    min: params.get(`SERVO${i + 1}_MIN`) ?? 1000,
    max: params.get(`SERVO${i + 1}_MAX`) ?? 2000,
    trim: params.get(`SERVO${i + 1}_TRIM`) ?? 1500,
    reversed: (params.get(`SERVO${i + 1}_REVERSED`) ?? 0) !== 0,
  }), [params]);

  const outputs = useMemo(() => Array.from({ length: OUTPUT_COUNT }, (_, i) => getOutput(i)), [getOutput]);
  const { pwmWarnings, conflicts } = useMemo(() => validateOutputs(outputs), [outputs]);

  const motPwmType = params.get('MOT_PWM_TYPE') ?? 0;
  const [boardVersion, setBoardVersion] = useState(0);
  const [manualBoardOverride, setManualBoardOverride] = useState<BoardProfile | null>(null);

  useEffect(() => {
    if (!protocol?.onAutopilotVersion) return;
    const unsub = protocol.onAutopilotVersion((data) => { setBoardVersion(data.boardVersion); });
    protocol.requestMessage?.(148).catch(() => {});
    return unsub;
  }, [protocol]);

  const autoDetectedProfile = useMemo(() => detectBoardProfile(boardVersion), [boardVersion]);
  const boardProfile = (autoDetectedProfile !== UNKNOWN_BOARD) ? autoDetectedProfile : (manualBoardOverride ?? UNKNOWN_BOARD);

  const functionMap = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < OUTPUT_COUNT; i++) map.set(i + 1, params.get(`SERVO${i + 1}_FUNCTION`) ?? 0);
    return map;
  }, [params]);

  const timerConflicts: TimerGroupConflict[] = useMemo(() => detectTimerGroupConflicts(boardProfile, functionMap, motPwmType), [boardProfile, functionMap, motPwmType]);
  const conflictDisabledOutputs = useMemo(() => {
    const set = new Set<number>();
    for (const c of timerConflicts) for (const o of c.disabledOutputs) set.add(o);
    return set;
  }, [timerConflicts]);

  const hasDirty = dirtyParams.size > 0;

  async function handleSave() {
    if (pwmWarnings.length > 0) { toast("Fix PWM warnings before saving", "warning"); return; }
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Output parameters saved to RAM", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    if (ok) toast("Parameters written to flash", "success");
    else toast("Failed to write to flash", "error");
  }

  if (!protocol) {
    return (
      <div className="flex-1 p-6">
        <div className="max-w-4xl space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Servo / Motor Outputs</h2>
          <Card><p className="text-xs text-text-tertiary">Connect to a drone to configure outputs.</p></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl space-y-4">
        <PanelHeader title="Servo / Motor Outputs" subtitle="Output function assignment, PWM limits, and motor test" loading={loading} loadProgress={loadProgress} hasLoaded={hasLoaded} onRead={refresh} connected={!!protocol} error={error}>
          {hasDirty && <span className="text-[10px] font-mono text-status-warning px-1.5 py-0.5 bg-status-warning/10 border border-status-warning/20">UNSAVED</span>}
          <Button variant="primary" size="sm" icon={<Save size={12} />} loading={saving} disabled={!hasDirty} onClick={handleSave}>Save</Button>
          {hasRamWrites && <Button variant="secondary" size="sm" icon={<HardDrive size={12} />} onClick={handleFlash}>Write to Flash</Button>}
        </PanelHeader>

        <OutputTimerGroupConfig hasLoaded={hasLoaded} boardProfile={boardProfile} functionMap={functionMap} motPwmType={motPwmType} timerConflicts={timerConflicts} conflicts={conflicts} pwmWarnings={pwmWarnings} gpioOutputs={gpioOutputs} onBoardOverride={setManualBoardOverride} />
        <ServoMappingTable outputs={outputs} gpioOutputs={gpioOutputs} conflictDisabledOutputs={conflictDisabledOutputs} boardProfile={boardProfile} liveServos={liveServos} setLocalValue={setLocalValue} />

        <MotorTestSection protocol={protocol} isHardBlocked={isHardBlocked} hardBlockMessage={hardBlockMessage} />
        <ServoTestSection protocol={protocol} isHardBlocked={isHardBlocked} hardBlockMessage={hardBlockMessage} outputs={outputs} gpioOutputs={gpioOutputs} />
      </div>
    </div>
  );
}
