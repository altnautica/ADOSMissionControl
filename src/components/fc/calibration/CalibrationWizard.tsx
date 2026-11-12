"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle, XCircle, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompassProgressDisplay, CompassResultsDisplay } from "./compass-display";

export type CalibrationStatus = "idle" | "in_progress" | "waiting_accept" | "cal_warning" | "success" | "error";

export interface CalibrationStep {
  label: string;
  description: string;
}

export interface CompassProgressEntry {
  compassId: number;
  completionPct: number;
  calStatus: number;
  completionMask: number[];
  /** Body angular rate (rad/s); absent until the vehicle reports one. */
  direction?: { x: number; y: number; z: number };
}

export interface CompassResultEntry {
  compassId: number;
  ofsX: number; ofsY: number; ofsZ: number;
  fitness: number; calStatus: number;
  diagX: number; diagY: number; diagZ: number;
  offdiagX: number; offdiagY: number; offdiagZ: number;
  orientationConfidence: number;
  oldOrientation: number; newOrientation: number; scaleFactor: number;
}

interface CalibrationWizardProps {
  title: string;
  description: string;
  steps: CalibrationStep[];
  currentStep: number;
  status: CalibrationStatus;
  progress?: number;
  statusMessage?: string;
  waitingForConfirm?: boolean;
  onConfirm?: () => void;
  confirmLabel?: string;
  compassProgress?: CompassProgressEntry[];
  compassResults?: CompassResultEntry[];
  failureFixes?: string[];
  preTips?: string[];
  onStart: () => void;
  onCancel?: () => void;
  onForceSave?: () => void;
  unsupportedNotice?: string;
  /**
   * Why a calibration may not start now (the vehicle is armed or its arm
   * state is unknown). Set, it disables Start / Retry / Re-calibrate and
   * shows the reason; an already running calibration can still be cancelled.
   */
  blockedReason?: string;
  /**
   * A safety statement the operator must tick before Start is enabled
   * (props removed, vehicle secured). Cleared again on every start.
   */
  startAcknowledgement?: string;
  className?: string;
}

const statusBadge: Record<CalibrationStatus, string> = {
  idle: "bg-bg-tertiary text-text-tertiary",
  in_progress: "bg-accent-primary/20 text-accent-primary",
  waiting_accept: "bg-status-warning/20 text-status-warning",
  cal_warning: "bg-status-warning/20 text-status-warning",
  success: "bg-status-success/20 text-status-success",
  error: "bg-status-error/20 text-status-error",
};

export function CalibrationWizard({
  title, description, steps, currentStep, status, progress, statusMessage,
  waitingForConfirm, onConfirm, confirmLabel,
  compassProgress, compassResults, failureFixes, preTips,
  onStart, onCancel, onForceSave, unsupportedNotice, blockedReason, startAcknowledgement, className,
}: CalibrationWizardProps) {
  const t = useTranslations("fcCalibration.wizard");
  const badgeClassName = statusBadge[status];
  const [acknowledged, setAcknowledged] = useState(false);
  const startBlocked = !!blockedReason || (!!startAcknowledgement && !acknowledged);
  const start = () => {
    setAcknowledged(false);
    onStart();
  };
  const showAck = !!startAcknowledgement && status !== "in_progress" && !waitingForConfirm && !unsupportedNotice;

  return (
    <div className={cn("border border-border-default bg-bg-secondary p-4", className)}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{title}</h3>
          <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
        </div>
        <span className={cn("text-[10px] font-mono px-2 py-0.5 shrink-0", badgeClassName)}>{t(`status.${status}`)}</span>
      </div>

      {preTips && preTips.length > 0 && status === "idle" && (
        <div className="mb-4 bg-bg-tertiary/50 px-3 py-2.5">
          <p className="text-[10px] font-medium text-text-secondary mb-1.5">{t("beforeYouStart")}</p>
          <ol className="space-y-1">
            {preTips.map((tip, i) => (
              <li key={i} className="text-[10px] text-text-tertiary flex gap-1.5">
                <span className="text-text-secondary shrink-0">{i + 1}.</span>{tip}
              </li>
            ))}
          </ol>
        </div>
      )}

      {steps.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {steps.map((step, i) => {
            const isComplete = status === "success" || status === "waiting_accept" || status === "cal_warning" || (status === "in_progress" && i < currentStep);
            const isCurrent = status === "in_progress" && i === currentStep;
            const isFailed = status === "error" && i === currentStep;
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="mt-0.5 shrink-0">
                  {isComplete ? <CheckCircle size={14} className="text-status-success" />
                    : isFailed ? <XCircle size={14} className="text-status-error" />
                    : isCurrent ? <Loader2 size={14} className="text-accent-primary animate-spin" />
                    : <Circle size={14} className="text-text-tertiary" />}
                </div>
                <div>
                  <span className={cn("text-xs", isCurrent ? "text-text-primary font-medium" : "text-text-secondary")}>{step.label}</span>
                  {isCurrent && <p className="text-[10px] text-text-tertiary mt-0.5">{step.description}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {compassProgress && compassProgress.length > 0 && status === "in_progress" && (
        <CompassProgressDisplay entries={compassProgress} />
      )}

      {(!compassProgress || compassProgress.length === 0) && status === "in_progress" && progress !== undefined && !waitingForConfirm && (
        <div className="mb-3">
          <div className="h-1.5 bg-bg-tertiary w-full">
            <div className="h-full bg-accent-primary transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
          <span className="text-[10px] font-mono text-text-tertiary mt-1 block">{Math.round(progress)}%</span>
        </div>
      )}

      {compassResults && compassResults.length > 0 && (
        <CompassResultsDisplay results={compassResults} />
      )}

      {statusMessage && (
        <p className={cn("text-[10px] font-mono mb-3",
          status === "error" ? "text-status-error" : (status === "waiting_accept" || status === "cal_warning") ? "text-status-warning" : "text-text-tertiary"
        )}>{statusMessage}</p>
      )}

      {(status === "error" || status === "cal_warning") && failureFixes && failureFixes.length > 0 && (
        <div className={cn("mb-3 px-3 py-2.5 border", status === "cal_warning" ? "border-status-warning/20 bg-status-warning/5" : "border-status-error/20 bg-status-error/5")}>
          <p className={cn("text-[10px] font-medium mb-1.5", status === "cal_warning" ? "text-status-warning" : "text-status-error")}>{t("troubleshooting")}</p>
          <ul className="space-y-1">
            {failureFixes.map((fix, i) => (
              <li key={i} className="text-[10px] text-text-secondary flex gap-1.5"><span className="text-status-error shrink-0">&bull;</span>{fix}</li>
            ))}
          </ul>
        </div>
      )}

      {unsupportedNotice && status === "idle" && (
        <div className="mb-3 border border-status-warning/20 bg-status-warning/5 px-3 py-2.5">
          <p className="text-[10px] text-status-warning">{unsupportedNotice}</p>
        </div>
      )}

      {blockedReason && status !== "in_progress" && !waitingForConfirm && (
        <p className="text-[10px] font-mono text-status-warning mb-3">{blockedReason}</p>
      )}

      {showAck && (
        <label className="mb-3 flex items-center gap-2 text-[11px] text-text-primary">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          {startAcknowledgement}
        </label>
      )}

      <div className="flex gap-2">
        {status === "cal_warning" && onForceSave ? (
          <><Button variant="primary" size="sm" onClick={onForceSave}>{t("forceSave")}</Button>
            <Button variant="secondary" size="sm" onClick={start} disabled={startBlocked}>{t("retry")}</Button></>
        ) : waitingForConfirm && onConfirm ? (
          <><Button variant="primary" size="sm" onClick={onConfirm}>{confirmLabel ?? t("confirmPosition")}</Button>
            {onCancel && <Button variant="danger" size="sm" onClick={onCancel}>{t("cancel")}</Button>}</>
        ) : status === "in_progress" && onCancel ? (
          <><Button variant="secondary" size="sm" loading>{t("calibrating")}</Button>
            <Button variant="danger" size="sm" onClick={onCancel}>{t("cancel")}</Button></>
        ) : unsupportedNotice ? (
          <Button variant="secondary" size="sm" disabled>{t("notAvailable")}</Button>
        ) : (
          <Button variant="primary" size="sm" onClick={start} disabled={startBlocked}>
            {status === "success" ? t("recalibrate") : status === "error" || status === "cal_warning" ? t("retry") : t("start")}
          </Button>
        )}
      </div>
    </div>
  );
}
