"use client";

/**
 * @module TxPowerSlider
 * @description Range slider for the WFB-ng TX power setting in dBm.
 * Above the soft floor (10 dBm) the Apply button opens a typed-phrase
 * confirmation dialog before invoking the agent. Surfaces clamp
 * results when the agent's per-driver maximum is below the requested
 * value.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, AlertCircle } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { SetTxPowerResult } from "@/lib/api/ground-station/types";

const SOFT_FLOOR_DBM = 10;
const MIN_DBM = 1;

interface TxPowerSliderProps {
  /** The current effective TX power as reported by the agent. */
  currentDbm: number | null;
  /** Per-driver hard cap reported by the agent (already clamped to a
   *  topology-aware safe maximum). */
  maxDbm: number;
  /** Initial slider value when the panel mounts. Falls back to the
   *  current value or a low safe default. */
  initialValue: number;
  /** Hostname used for the typed-phrase gate when applying values
   *  above the soft floor. Falls back to the literal "radio" when the
   *  agent has not advertised one. */
  confirmHostname: string | null;
  onApply: (dbm: number) => Promise<SetTxPowerResult>;
  disabled?: boolean;
}

type ApplyState =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "success"; effectiveDbm: number | null; clamped: boolean }
  | { kind: "error"; message: string };

function clampToRange(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function TxPowerSlider({
  currentDbm,
  maxDbm,
  initialValue,
  confirmHostname,
  onApply,
  disabled,
}: TxPowerSliderProps) {
  const t = useTranslations("hardware.radio");
  const tCommon = useTranslations("common");
  const { toast } = useToast();

  const safeMax = Math.max(MIN_DBM, maxDbm);
  const [rawValue, setRawValue] = useState<number>(() =>
    clampToRange(Math.round(initialValue), MIN_DBM, safeMax),
  );
  // Clamp on render so a tightened per-driver cap re-syncs the visible
  // value without a setState-in-effect cascade. The raw value still
  // remembers what the user picked at the previous looser cap.
  const value = clampToRange(rawValue, MIN_DBM, safeMax);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, setState] = useState<ApplyState>({ kind: "idle" });

  const phrase = confirmHostname ?? "radio";
  const requiresConfirm = value > SOFT_FLOOR_DBM;

  const performApply = async () => {
    setState({ kind: "applying" });
    try {
      const res = await onApply(value);
      const effectiveDbm = res.effective_dbm;
      const clamped =
        typeof effectiveDbm === "number" && effectiveDbm < res.requested_dbm;
      setState({ kind: "success", effectiveDbm, clamped });
      if (clamped) {
        toast(
          t("applyClampedToFloor", { dbm: effectiveDbm ?? "" }),
          "warning",
        );
      } else {
        toast(t("applied"), "success");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "apply failed";
      setState({ kind: "error", message: msg });
      toast(`${t("applyFailed")}: ${msg}`, "error");
    }
  };

  const onClickApply = () => {
    if (requiresConfirm) {
      setConfirmOpen(true);
      return;
    }
    void performApply();
  };

  const onConfirm = () => {
    setConfirmOpen(false);
    void performApply();
  };

  const isApplying = state.kind === "applying";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN_DBM}
          max={safeMax}
          step={1}
          value={value}
          onChange={(e) => setRawValue(Number(e.target.value))}
          disabled={disabled || isApplying}
          aria-label={t("txPowerSliderLabel")}
          className="flex-1 accent-accent-primary"
        />
        <span className="font-mono text-sm text-text-primary tabular-nums">
          {value} dBm
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col text-xs text-text-tertiary">
          <span>
            {t("txPower")}:{" "}
            <span className="font-mono text-text-secondary">
              {currentDbm != null ? `${currentDbm.toFixed(0)} dBm` : "—"}
            </span>
          </span>
          {requiresConfirm ? (
            <span className="text-status-warning">{t("txPowerWarn")}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {state.kind === "success" ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-success">
              <Check size={12} />
              {state.clamped
                ? t("applyClampedToFloor", {
                    dbm: state.effectiveDbm ?? "",
                  })
                : t("applied")}
            </span>
          ) : null}
          {state.kind === "error" ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-error">
              <AlertCircle size={12} />
              {t("applyFailed")}
            </span>
          ) : null}
          {isApplying ? (
            <span className="inline-flex items-center gap-1 text-xs text-text-tertiary">
              <Loader2 size={12} className="animate-spin" />
              {t("applying")}
            </span>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={onClickApply}
            disabled={disabled || isApplying}
          >
            {t("applyButton")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmHighPowerTitle")}
        message={t("confirmHighPowerBody", { dbm: value })}
        confirmLabel={t("applyButton")}
        cancelLabel={tCommon("cancel")}
        typedPhrase={phrase}
        variant="primary"
        onConfirm={onConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
