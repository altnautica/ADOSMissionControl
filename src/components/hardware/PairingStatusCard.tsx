"use client";

/**
 * @module PairingStatusCard
 * @description Receiver-side pairing window summary with countdown, open
 * and close controls, and the list of pending relay join requests.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";

/** Cadence of the pairing-window poll while the window is open. */
const PAIRING_POLL_MS = 1000;

export function PairingStatusCard() {
  const t = useTranslations("hardware.distributedRx");
  const role = useGroundStationStore((s) => s.role.info?.current ?? "direct");
  const distRx = useGroundStationStore((s) => s.distributedRx);
  const openPairingWindow = useGroundStationStore((s) => s.openPairingWindow);
  const closePairingWindow = useGroundStationStore((s) => s.closePairingWindow);
  const approvePairing = useGroundStationStore((s) => s.approvePairing);
  const loadPairingPending = useGroundStationStore((s) => s.loadPairingPending);
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  // Defensive: pairing controls only make sense on a receiver. If this
  // card gets reused outside the receiver branch of DistributedRxPanel,
  // render nothing rather than show a broken window control.
  const [openPending, setOpenPending] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const [approvePending, setApprovePending] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (role !== "receiver" || !distRx.pairingWindowOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [role, distRx.pairingWindowOpen]);

  useEffect(() => {
    if (role !== "receiver" || !distRx.pairingWindowOpen) return;
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    // Self-scheduling: a 1 Hz fixed interval with no in-flight guard and no
    // `document.hidden` check stacked requests onto the agent while the tab
    // was in the background.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          await loadPairingPending(api);
        } catch {
          // The store owns the operator-visible error.
        }
      }
      if (!cancelled) timer = setTimeout(tick, PAIRING_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer ?? undefined);
    };
  }, [role, distRx.pairingWindowOpen, agentUrl, apiKey, loadPairingPending]);

  if (role !== "receiver") {
    return null;
  }

  const remainingS = distRx.pairingWindowExpiresAt
    ? Math.max(0, Math.floor((distRx.pairingWindowExpiresAt - now) / 1000))
    : 0;

  const onOpen = async () => {
    if (openPending) return;
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    setOpenPending(true);
    try {
      await openPairingWindow(api, 60);
    } finally {
      setOpenPending(false);
    }
  };

  const onClose = async () => {
    if (closePending) return;
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    setClosePending(true);
    try {
      await closePairingWindow(api);
    } finally {
      setClosePending(false);
    }
  };

  const onApprove = async (deviceId: string) => {
    if (approvePending[deviceId]) return;
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    setApprovePending((prev) => ({ ...prev, [deviceId]: true }));
    try {
      await approvePairing(api, deviceId);
    } finally {
      setApprovePending((prev) => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
    }
  };

  if (!distRx.pairingWindowOpen) {
    return (
      <div className="p-4 bg-surface-primary border border-border-default/40 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-text-primary">{t("pairingTitle")}</div>
          <div className="text-xs text-text-tertiary">{t("pairingIdle")}</div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          disabled={openPending}
          aria-busy={openPending}
          className="px-3 py-1 text-xs text-accent-primary border border-accent-primary/40 hover:bg-accent-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {openPending ? t("openingPairing") : t("openPairing")}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-surface-primary border border-accent-primary/40 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-accent-primary">
            {t("pairingOpen")}
          </div>
          <div className="text-xs text-text-tertiary font-mono" aria-live="polite">
            {t("pairingRemaining", { seconds: remainingS })}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={closePending}
          aria-busy={closePending}
          className="px-3 py-1 text-xs text-text-secondary border border-border-default/60 hover:text-text-primary hover:bg-bg-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {closePending ? t("closingPairing") : t("closePairing")}
        </button>
      </div>
      {distRx.pendingRequests.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">
            {t("pendingTitle")} ({distRx.pendingRequests.length})
          </div>
          {distRx.pendingRequests.map((req) => (
            <div
              key={req.device_id}
              className="flex items-center justify-between p-2 bg-bg-primary"
            >
              <div className="flex flex-col">
                <span className="font-mono text-xs text-text-primary">{req.device_id}</span>
                <span className="text-[10px] text-text-tertiary">
                  from {req.remote_ip}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onApprove(req.device_id)}
                disabled={!!approvePending[req.device_id]}
                aria-busy={!!approvePending[req.device_id]}
                className="px-2 py-1 text-[10px] text-status-success border border-status-success/40 hover:bg-status-success/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {approvePending[req.device_id] ? t("approving") : t("approve")}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-text-tertiary italic">{t("pendingEmpty")}</div>
      )}
    </div>
  );
}
