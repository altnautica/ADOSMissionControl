"use client";

/**
 * @module hardware/radio/PairingCard
 * @description Local-bind pairing surface for the WFB-ng radio. Renders
 * the paired/unpaired status, the bind progress label, the failover
 * banner, and the pair / repair / unpair action buttons.
 * @license GPL-3.0-only
 */

import {
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type {
  LocalBindSession,
  PairStatusResponse,
} from "@/lib/api/ground-station/types";

export interface PairingCardProps {
  pairStatus: PairStatusResponse | null;
  bindSession: LocalBindSession | null;
  bindBusy: boolean;
  unpairBusy: boolean;
  onOpenLocalBind: () => void;
  onUnpair: () => void;
  wfbFailoverState: "local" | "cloud_relay" | "failed";
  onRetryLocal: () => void;
  retryBusy: boolean;
}

export function PairingCard({
  pairStatus,
  bindSession,
  bindBusy,
  unpairBusy,
  onOpenLocalBind,
  onUnpair,
  wfbFailoverState,
  onRetryLocal,
  retryBusy,
}: PairingCardProps) {
  const t = useTranslations("hardware.radio");
  const paired = pairStatus?.paired === true;
  const autoArmed =
    !paired && pairStatus?.auto_pair_enabled === true;
  const peer = pairStatus?.paired_with_device_id ?? null;
  const fingerprint = pairStatus?.fingerprint ?? null;
  const pairedAt = pairStatus?.paired_at ?? null;

  // Render the live bind progress when a session is in flight.
  const showProgress =
    bindBusy ||
    (bindSession != null &&
      bindSession.state !== "paired" &&
      bindSession.state !== "failed" &&
      bindSession.state !== "aborted" &&
      bindSession.state !== "idle");

  const progressLabel = (() => {
    if (!bindSession) return t("pairing.progressOpening");
    switch (bindSession.state) {
      case "opening_tunnel":
        return t("pairing.progressOpening");
      case "waiting_peer":
        return t("pairing.progressWaiting");
      case "transferring_keys":
        return t("pairing.progressTransferring");
      case "applying_keys":
        return t("pairing.progressApplying");
      case "restarting_services":
        return t("pairing.progressRestarting");
      default:
        return t("pairing.progressOpening");
    }
  })();

  // Chip-style label that pairs the live bind phase with the elapsed
  // time the agent reports via `phase_age_s`. Only shown for in-flight,
  // non-terminal states; terminal states (paired/failed/aborted/idle)
  // suppress the chip entirely.
  const phaseChipLabel = (() => {
    if (!bindSession) return null;
    const inFlight =
      bindSession.state !== "paired" &&
      bindSession.state !== "failed" &&
      bindSession.state !== "aborted" &&
      bindSession.state !== "idle";
    if (!inFlight) return null;
    const phaseKey: Record<string, string> = {
      opening_tunnel: "pairing.phase.opening_tunnel",
      waiting_peer: "pairing.phase.waiting_peer",
      transferring_keys: "pairing.phase.transferring_keys",
      applying_keys: "pairing.phase.applying_keys",
      restarting_services: "pairing.phase.restarting_services",
    };
    const key = phaseKey[bindSession.state];
    if (!key) return null;
    const label = t(key);
    const ageRaw = bindSession.phase_age_s;
    if (ageRaw == null || !Number.isFinite(ageRaw) || ageRaw < 0) {
      return label;
    }
    const s = Math.floor(ageRaw);
    const elapsed =
      s < 60 ? `(${s}s)` : `(${Math.floor(s / 60)}m ${s % 60}s)`;
    return `${label} ${elapsed}`;
  })();

  // Peer-presence diagnostic line shown beneath the phase chip during
  // the WAITING_PEER window. Tells the operator whether the agent's
  // bind tunnel has heard ANY frame from the peer yet, and how stale
  // the last hit is. Sourced from agent fields backed by the kernel
  // rx_packets counter on the bind TUN device — a stable signal that
  // survives wfb-ng release churn. Hidden when not in waiting_peer.
  const peerDiagnosticsLabel = (() => {
    if (!bindSession) return null;
    if (bindSession.state !== "waiting_peer") return null;
    const ageRaw = bindSession.last_frame_age_s;
    const rssi = bindSession.last_rssi_dbm;
    const haveAge = ageRaw != null && Number.isFinite(ageRaw) && ageRaw >= 0;
    const haveRssi =
      rssi != null && Number.isFinite(rssi);
    if (!haveAge && !haveRssi) {
      // Agent is on the kernel-counter path but has not heard a peer
      // frame yet. Surface "no frames received" so the operator knows
      // diagnostics are wired and the radio is genuinely silent.
      return t("pairing.peerDiagnostics.noFrames");
    }
    const parts: string[] = [];
    if (haveAge) {
      const s = Math.floor(ageRaw as number);
      const elapsed =
        s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
      parts.push(t("pairing.peerDiagnostics.lastFrame", { age: elapsed }));
    }
    if (haveRssi) {
      parts.push(t("pairing.peerDiagnostics.rssi", { value: rssi }));
    }
    return parts.join(" · ");
  })();

  // Injection-iface prep warning. The agent stamps `bind_precheck_ok = false`
  // when the WFB injection adapter did not reach verified monitor mode, which
  // means it radiates nothing and the bind will time out. Surfacing the real
  // cause here turns a bare 90s timeout into an actionable message. Suppressed
  // once paired (a stale precheck from a prior attempt must not nag).
  const precheckWarning = (() => {
    if (!bindSession) return null;
    if (bindSession.bind_precheck_ok !== false) return null;
    if (bindSession.state === "paired") return null;
    if (bindSession.bind_precheck_reason === "iface_not_found") {
      return t("pairing.precheck.noAdapter");
    }
    return t("pairing.precheck.notReady", {
      mode: bindSession.injection_mode ?? "unknown",
    });
  })();

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        {paired ? (
          <ShieldCheck size={16} className="text-status-success" />
        ) : (
          <ShieldAlert size={16} className="text-status-warning" />
        )}
        <h3 className="text-sm font-semibold text-text-primary">
          {t("pairing.title")}
        </h3>
      </div>

      {wfbFailoverState === "cloud_relay" ? (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-status-warning" />
          <div className="flex-1">
            <p className="font-medium text-text-primary">
              {t("pairing.failover.cloudRelay.title")}
            </p>
            <p className="text-xs text-text-secondary">
              {t("pairing.failover.cloudRelay.message")}
            </p>
            <button
              type="button"
              onClick={onRetryLocal}
              disabled={retryBusy}
              className="mt-2 inline-flex items-center rounded border border-border-default bg-bg-tertiary px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-bg-secondary disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {retryBusy
                ? t("pairing.failover.retrying")
                : t("pairing.failover.retryButton")}
            </button>
          </div>
        </div>
      ) : null}

      {wfbFailoverState === "failed" ? (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-md border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-status-error" />
          <div className="flex-1">
            <p className="font-medium text-text-primary">
              {t("pairing.failover.failed")}
            </p>
          </div>
        </div>
      ) : null}

      {paired ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-xs text-status-success">
              {t("pairing.statusPaired", { peer: peer ?? t("pairing.selfDevice") })}
            </span>
          </div>
          {fingerprint ? (
            <p className="font-mono text-xs text-text-secondary">
              {t("pairing.fingerprintLabel")}: {fingerprint}
            </p>
          ) : null}
          {pairedAt ? (
            <p className="text-xs text-text-tertiary">
              {t("pairing.pairedAtLabel")}: {pairedAt}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenLocalBind}
              disabled={bindBusy || unpairBusy}
            >
              {t("pairing.actionRepair")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onUnpair}
              disabled={bindBusy || unpairBusy}
            >
              {t("pairing.actionUnpair")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs ${
                autoArmed
                  ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                  : "border-status-warning/40 bg-status-warning/10 text-status-warning"
              }`}
            >
              {autoArmed
                ? t("pairing.statusAutoArmed")
                : t("pairing.statusUnpaired")}
            </span>
          </div>
          {autoArmed ? (
            <p className="text-xs text-text-secondary">
              {t("pairing.armedDescription")}
            </p>
          ) : null}
          {showProgress ? (
            <p className="font-mono text-xs text-accent-primary">
              {progressLabel}
            </p>
          ) : null}
          {phaseChipLabel ? (
            <span
              className="inline-flex w-fit items-center rounded border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-1 font-mono text-[11px] text-accent-primary"
              aria-live="polite"
            >
              {phaseChipLabel}
            </span>
          ) : null}
          {peerDiagnosticsLabel ? (
            <p
              className="font-mono text-[11px] text-text-secondary"
              aria-live="polite"
            >
              {peerDiagnosticsLabel}
            </p>
          ) : null}
          {precheckWarning ? (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5 text-status-warning" />
              <span className="flex-1 text-text-secondary">{precheckWarning}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={onOpenLocalBind}
              disabled={bindBusy || unpairBusy}
            >
              {bindBusy ? progressLabel : t("pairing.actionPairLocal")}
            </Button>
          </div>
          {bindSession?.state === "failed" && bindSession.error ? (
            <p className="text-xs text-status-error">
              {t("pairing.errorAgentError", { message: bindSession.error })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
