/**
 * @module LogicConditionsPanel
 * @description iNav Logic Conditions editor.
 * Reads up to 64 logic condition rules from the FC, allows in-place editing,
 * and writes all rules back. Displays live condition status when armed.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useProgrammingStore, LOGIC_CONDITION_MAX } from "@/stores/programming-store";
import type { INavLogicCondition } from "@/lib/protocol/msp/msp-decoders-inav";
import { PanelHeader } from "../../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { GitBranch, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";
import { LOGIC_ACTIVATOR_OPTIONS, LOGIC_OPERATION_OPTIONS, LOGIC_OPERAND_TYPE_OPTIONS } from "./programming-constants";

// ── LogicConditionRow ─────────────────────────────────────────

interface RowProps {
  idx: number;
  cond: INavLogicCondition;
  /** Live value read from the FC; undefined when there is no fresh reading. */
  status?: number;
  setCondition: (idx: number, partial: Partial<INavLogicCondition>) => void;
  isArmed: boolean;
}

const LogicConditionRow = memo(function LogicConditionRow({ idx, cond, status, setCondition, isArmed }: RowProps) {
  const handleEnable = useCallback(() => {
    setCondition(idx, { enabled: !cond.enabled });
  }, [idx, cond.enabled, setCondition]);

  const handleActivator = useCallback((v: string) => {
    setCondition(idx, { activatorId: parseInt(v) });
  }, [idx, setCondition]);

  // A condition gated on itself never evaluates, so its own slot is not offered.
  const activatorOptions = useMemo(
    () => LOGIC_ACTIVATOR_OPTIONS.filter((o) => o.value !== String(idx)),
    [idx],
  );

  const handleOperation = useCallback((v: string) => {
    setCondition(idx, { operation: parseInt(v) });
  }, [idx, setCondition]);

  const handleOperandAType = useCallback((v: string) => {
    setCondition(idx, { operandAType: parseInt(v) });
  }, [idx, setCondition]);

  const handleOperandAValue = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCondition(idx, { operandAValue: parseInt(e.target.value) || 0 });
  }, [idx, setCondition]);

  const handleOperandBType = useCallback((v: string) => {
    setCondition(idx, { operandBType: parseInt(v) });
  }, [idx, setCondition]);

  const handleOperandBValue = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCondition(idx, { operandBValue: parseInt(e.target.value) || 0 });
  }, [idx, setCondition]);

  return (
    <div
      className={cn(
        "border border-border-default rounded px-3 py-2 flex items-center gap-3",
        cond.enabled ? "bg-bg-primary" : "bg-bg-secondary opacity-60",
      )}
    >
      <span className="text-[10px] font-mono text-text-tertiary w-5 shrink-0">{idx}</span>

      <button
        disabled={isArmed}
        onClick={handleEnable}
        className={cn(
          "w-8 h-4 rounded-full relative transition-colors shrink-0",
          cond.enabled ? "bg-accent-primary" : "bg-bg-tertiary border border-border-default",
        )}
        aria-label={cond.enabled ? "Disable" : "Enable"}
      >
        <div
          className={cn(
            "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
            cond.enabled ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>

      <div className="w-28 shrink-0">
        <Select
          label=""
          options={activatorOptions}
          value={String(cond.activatorId)}
          onChange={handleActivator}
          disabled={isArmed}
          searchable
        />
      </div>

      <div className="w-32 shrink-0">
        <Select
          label=""
          options={LOGIC_OPERATION_OPTIONS}
          value={String(cond.operation)}
          onChange={handleOperation}
          disabled={isArmed}
          searchable
        />
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[9px] text-text-tertiary">A:</span>
        <div className="w-24">
          <Select
            label=""
            options={LOGIC_OPERAND_TYPE_OPTIONS}
            value={String(cond.operandAType)}
            onChange={handleOperandAType}
            disabled={isArmed}
          />
        </div>
        <input
          disabled={isArmed}
          type="number"
          value={cond.operandAValue}
          onChange={handleOperandAValue}
          className="w-16 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded px-1 py-0.5 text-text-primary"
        />
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <span className="text-[9px] text-text-tertiary">B:</span>
        <div className="w-24">
          <Select
            label=""
            options={LOGIC_OPERAND_TYPE_OPTIONS}
            value={String(cond.operandBType)}
            onChange={handleOperandBType}
            disabled={isArmed}
          />
        </div>
        <input
          disabled={isArmed}
          type="number"
          value={cond.operandBValue}
          onChange={handleOperandBValue}
          className="w-16 text-[10px] font-mono bg-bg-tertiary border border-border-default rounded px-1 py-0.5 text-text-primary"
        />
      </div>

      {status !== undefined && (
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              status !== 0 ? "bg-status-success" : "bg-bg-tertiary",
            )}
            title={`Value: ${status}`}
          />
          <span className="text-[9px] font-mono text-text-tertiary">{status}</span>
        </div>
      )}
    </div>
  );
});

// ── Component ─────────────────────────────────────────────────

export function LogicConditionsPanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { isArmed } = useArmedLock();

  const conditions = useProgrammingStore((s) => s.conditions);
  const conditionsStatus = useProgrammingStore((s) => s.conditionsStatus);
  const conditionsStatusAt = useProgrammingStore((s) => s.conditionsStatusAt);
  const loading = useProgrammingStore((s) => s.loading);
  const error = useProgrammingStore((s) => s.error);
  const conditionsDirty = useProgrammingStore((s) => s.conditionsDirty);
  useUnsavedGuard(conditionsDirty);
  const setCondition = useProgrammingStore((s) => s.setCondition);
  const loadFromFc = useProgrammingStore((s) => s.loadFromFc);
  const uploadConditions = useProgrammingStore((s) => s.uploadConditions);
  const startPolling = useProgrammingStore((s) => s.startPolling);
  const stopPolling = useProgrammingStore((s) => s.stopPolling);

  const connected = !!getSelectedProtocol();
  const hasLoaded = useProgrammingStore((s) => s.loaded);

  // Live status polling while armed
  useEffect(() => {
    const protocol = getSelectedProtocol();
    if (!protocol) return;
    if (isArmed) {
      startPolling(protocol);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [isArmed, getSelectedProtocol, startPolling, stopPolling]);

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
      toast("Logic conditions loaded from FC", "success");
    }
  }, [getSelectedProtocol, loadFromFc, toast]);

  const handleWrite = useCallback(async () => {
    const protocol = getSelectedProtocol();
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await uploadConditions(protocol);
    const err = useProgrammingStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Logic conditions written to FC", "success");
    }
  }, [getSelectedProtocol, uploadConditions, toast]);

  // Live values are shown only while the last status read is recent.
  useClockTick();
  const now = useClockStore((s) => s.now);
  const statusLive = conditionsStatusAt !== null && isFresh(conditionsStatusAt, now);
  const statusFor = (idx: number) => (statusLive ? conditionsStatus[idx] : undefined);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl space-y-4">
        <PanelHeader
          title="Logic Conditions"
          subtitle={`Up to ${LOGIC_CONDITION_MAX} programmable boolean/arithmetic rules`}
          icon={<GitBranch size={16} />}
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
            Armed: edits disabled. Live status visible below.
          </p>
        )}

        {conditionsDirty && !isArmed && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes: use Write to FC to persist.
          </p>
        )}

        {hasLoaded && (
          <div className="space-y-1">
            {conditions.map((cond, idx) => (
              <LogicConditionRow
                key={idx}
                idx={idx}
                cond={cond}
                status={statusFor(idx)}
                setCondition={setCondition}
                isArmed={isArmed}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
