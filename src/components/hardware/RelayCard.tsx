"use client";

/**
 * @module RelayCard
 * @description Single relay row on a receiver's Distributed RX view.
 * Shows device id, fragment count, last-seen age, and a Revoke button
 * that opens a ConfirmDialog with a typed-phrase gate.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { WfbReceiverRelay } from "@/lib/api/ground-station-api";

interface RelayCardProps {
  relay: WfbReceiverRelay;
}

function formatAge(lastSeenMs: number): string {
  if (!lastSeenMs) return "--";
  const ageS = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
  if (ageS < 60) return `${ageS}s`;
  if (ageS < 3600) return `${Math.floor(ageS / 60)}m`;
  return `${Math.floor(ageS / 3600)}h`;
}

export function RelayCard({ relay }: RelayCardProps) {
  const t = useTranslations("hardware.distributedRx");
  const tc = useTranslations("hardware.confirms.meshRevokeRelay");
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const revokeRelay = useGroundStationStore((s) => s.revokeRelay);
  const [confirming, setConfirming] = useState(false);

  const onConfirm = async () => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    await revokeRelay(api, relay.mac);
    setConfirming(false);
  };

  return (
    <div className="flex items-center justify-between p-3 bg-bg-primary border border-border-default/40">
      <div className="flex flex-col">
        <span className="font-mono text-sm text-text-primary">{relay.mac}</span>
        <span className="text-xs text-text-tertiary">
          {relay.fragments} fragments · {formatAge(relay.last_seen_ms)} ago
        </span>
      </div>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="px-3 py-1 text-xs text-status-error border border-status-error/40 hover:bg-status-error/10 transition-colors"
      >
        {t("revoke")}
      </button>
      <ConfirmDialog
        open={confirming}
        title={tc("title")}
        message={tc("body")}
        confirmLabel={tc("confirm")}
        typedPhrase={relay.mac}
        variant="danger"
        onConfirm={onConfirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
