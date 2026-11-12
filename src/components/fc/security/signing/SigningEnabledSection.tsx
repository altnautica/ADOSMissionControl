"use client";

/**
 * @module components/fc/security/signing/SigningEnabledSection
 * @description Rendered when this browser holds a signing key. Shows status,
 * key fingerprint, cloud sync row, action buttons, and the history + debug
 * sub-sections. When the FC's state is unknown (an interrupted enrollment or an
 * unacknowledged disable) it asks the operator to settle it instead of
 * claiming either outcome.
 */

import { useTranslations } from "next-intl";
import { Lock, RotateCw, Trash2, AlertTriangle, KeyRound, Cloud, CloudOff } from "lucide-react";
import type { DroneSigningState } from "@/stores/signing-store";
import { KeyAgeNudge } from "../KeyAgeNudge";
import { SigningHistorySection } from "../SigningHistorySection";
import { SigningDebugSection } from "../SigningDebugSection";
import { FcSection } from "@/components/fc/shared/FcSection";

export interface SigningEnabledSectionProps {
  droneId: string;
  state: DroneSigningState;
  busy: boolean;
  error: string | null;
  cloudSyncIntent: boolean;
  cloudRowPresent: boolean;
  cloudSyncBusy: boolean;
  cloudSyncError: string | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  onRotate: () => void;
  onDisable: () => void;
  onSettleNewKey: (fcHolds: "new" | "previous") => void;
  onSettleDisable: (signingOff: boolean) => void;
  onExport: () => void;
  onCloudSyncToggle: () => void;
  /** What the last enrollment said about the node keeping the key; null when
   * no enrollment ran in this session. */
  nodeHoldsKey: boolean | null;
}

export function SigningEnabledSection({
  droneId,
  state,
  busy,
  error,
  cloudSyncIntent,
  cloudRowPresent,
  cloudSyncBusy,
  cloudSyncError,
  isAuthenticated,
  authLoading,
  onRotate,
  onDisable,
  onSettleNewKey,
  onSettleDisable,
  onExport,
  onCloudSyncToggle,
  nodeHoldsKey,
}: SigningEnabledSectionProps) {
  const tr = useTranslations("fcPanels.signingEnabledSection");
  const settling = state.enrollmentState === "unconfirmed" || state.enrollmentState === "disable_unconfirmed";

  return (
    <FcSection>
      <KeyAgeNudge
        droneId={droneId}
        enrolledAt={state.enrolledAt}
        onRotate={onRotate}
        busy={busy}
      />
      <div className="flex items-center gap-2 text-text-primary">
        <Lock size={16} aria-hidden="true" className="text-status-success" />
        <span className="font-medium">{tr("signingEnabled")}</span>
      </div>
      <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-text-secondary">
        <dt className="text-text-tertiary">{tr("keyFingerprint")}</dt>
        <dd className="font-mono">{state.keyId ?? "(unknown)"}</dd>
        <dt className="text-text-tertiary">{tr("enrolled")}</dt>
        <dd>{state.enrolledAt ?? "(unknown)"}</dd>
      </dl>
      <p className="text-xs text-text-tertiary">
        {tr("withAKeyInIts")}
      </p>

      {state.enrollmentState === "unconfirmed" && (
        <div role="alert" className="border border-status-warning/40 bg-status-warning/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-status-warning">
            <AlertTriangle size={14} aria-hidden="true" />
            {tr("theFlightControllerMayHold")}
          </div>
          <p className="text-xs text-text-secondary">
            This browser keeps both ({state.keyId ?? "new"} and {state.previousKeyId ?? "none"}) and signs with the new key.
            If commands from this browser are accepted, the flight controller took the new key. If they are rejected, it
            kept the previous one.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={busy} onClick={() => onSettleNewKey("new")}
              className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50">
              {tr("itHasTheNewKey")}
            </button>
            <button type="button" disabled={busy || !state.previousKeyId} onClick={() => onSettleNewKey("previous")}
              className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50">
              {tr("itKeptThePreviousKey")}
            </button>
          </div>
        </div>
      )}

      {state.enrollmentState === "disable_unconfirmed" && (
        <div role="alert" className="border border-status-warning/40 bg-status-warning/5 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-status-warning">
            <AlertTriangle size={14} aria-hidden="true" />
            {tr("disableSentTheFlightController")}
          </div>
          <p className="text-xs text-text-secondary">
            {tr("thisBrowserKeepsTheKey")}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={busy} onClick={() => onSettleDisable(true)}
              className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50">
              {tr("signingIsOffForgetThe")}
            </button>
            <button type="button" disabled={busy} onClick={() => onSettleDisable(false)}
              className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50">
              {tr("itIsStillSigningKeep")}
            </button>
          </div>
        </div>
      )}
      {/* Cloud sync row. Disabled when user is signed out. */}
      <div className="border-t border-border-default pt-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {cloudSyncIntent && cloudRowPresent ? (
              <Cloud size={14} aria-hidden="true" className="text-accent-primary mt-0.5" />
            ) : (
              <CloudOff size={14} aria-hidden="true" className="text-text-tertiary mt-0.5" />
            )}
            <div>
              <p className="text-sm font-medium text-text-primary">{tr("syncToCloud")}</p>
              <p className="text-xs text-text-tertiary">
                {!isAuthenticated
                  ? "Sign in to enable cloud key sync across devices."
                  : cloudSyncIntent
                    ? "Turn off to remove the cloud copy of this key."
                    : "Cloud key sync is disabled until encrypted storage is available."}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={cloudSyncIntent}
            aria-label={cloudSyncIntent ? "Turn cloud sync off" : "Turn cloud sync on"}
            disabled={
              !isAuthenticated ||
              authLoading ||
              cloudSyncBusy ||
              !cloudSyncIntent
            }
            onClick={onCloudSyncToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center border transition-colors disabled:opacity-40 ${cloudSyncIntent ? "bg-accent-primary border-accent-primary" : "bg-bg-primary border-border-default"}`}
          >
            <span
              className={`inline-block h-3 w-3 transform bg-text-primary transition-transform ${cloudSyncIntent ? "translate-x-5" : "translate-x-1"}`}
            />
          </button>
        </div>
        {cloudSyncError && (
          <p role="alert" className="text-xs text-status-error">
            {cloudSyncError}
          </p>
        )}
      </div>
      {nodeHoldsKey !== null && (
        <p className="text-xs text-text-tertiary">
          {nodeHoldsKey
            ? "The node kept the key and signs its own traffic."
            : "The key lives only in this browser; the node does not sign its own traffic."}
        </p>
      )}
      {error && (
        <div
          className="flex items-start gap-2 text-sm text-status-error"
          role="alert"
        >
          <AlertTriangle size={14} className="mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50 inline-flex items-center gap-1.5"
          onClick={onRotate}
          disabled={busy || settling}
        >
          <RotateCw size={14} aria-hidden="true" />
          {tr("rotateKey")}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm border border-border-default hover:bg-bg-tertiary disabled:opacity-50 inline-flex items-center gap-1.5"
          onClick={onExport}
          disabled={busy || settling}
        >
          <KeyRound size={14} aria-hidden="true" />
          {tr("exportKey")}
        </button>
        <button
          type="button"
          className="px-3 py-1.5 text-sm border border-status-error/40 text-status-error hover:bg-status-error/10 disabled:opacity-50 inline-flex items-center gap-1.5"
          onClick={onDisable}
          disabled={busy || settling}
        >
          <Trash2 size={14} aria-hidden="true" />
          {tr("disableSigning")}
        </button>
      </div>
      <SigningHistorySection droneId={droneId} />
      <SigningDebugSection droneId={droneId} />
    </FcSection>
  );
}
