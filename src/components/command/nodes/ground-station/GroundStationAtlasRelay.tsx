"use client";

/**
 * @module GroundStationAtlasRelay
 * @description Ground-station Atlas relay indicator. Polls the node's LOCAL
 * `GET /api/v1/ground-station/wfb/atlas-relay/status` (Rule 39, never the cloud
 * heartbeat) and, only when a relay is actually running (`up === true`), shows
 * the keyframes-seen / forwarded / keep-rate counters plus a staleness badge.
 * Pauses on `document.hidden`. Mounted behind the Atlas flag from the
 * ground-station node-detail surface.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import {
  groundStationApiFromAgent,
  type AtlasRelayStatus,
} from "@/lib/api/ground-station-api";

const POLL_INTERVAL_MS = 2000;
/** Past this, the snapshot is badged stale (the relay surfaces ~1 Hz). */
const STALE_MS = 15000;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/[0.02] px-2 py-1.5 text-center">
      <div className="text-sm font-mono text-text-primary tabular-nums">
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
    </div>
  );
}

export function GroundStationAtlasRelay() {
  const t = useTranslations("atlas");
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  // The snapshot is keyed to the agent it came from so a node switch never
  // shows the previous node's relay while the new poll is in flight.
  const [snap, setSnap] = useState<{
    url: string | null;
    status: AtlasRelayStatus | null;
    at: number;
  }>({ url: null, status: null, at: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || document.hidden) return;
      const next = await api.getAtlasRelayStatus();
      if (!cancelled) {
        setSnap({ url: agentUrl, status: next, at: Date.now() });
        setNow(Date.now());
      }
    };
    void poll();
    const handle = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [agentUrl, apiKey]);

  const status = snap.url === agentUrl ? snap.status : null;

  // Surface a card when a relay is running, or when the relay loop has gone
  // quiet (stale): a dead relay must not read as "no relay active".
  if (!status || (!status.stale && status.up !== true)) {
    return (
      <div className="p-4">
        <div className="text-[11px] text-text-tertiary text-center py-6 border border-border-default rounded-lg">
          {t("relayNoActive")}
        </div>
      </div>
    );
  }

  const seen = status.datagramsSeen;
  const forwarded = status.forwarded;
  const keepRate =
    seen !== null && forwarded !== null && seen > 0
      ? `${Math.round((forwarded / seen) * 100)}%`
      : "--";
  const isStale =
    status.stale ||
    (status.generatedAtMs !== null &&
      status.generatedAtMs > 0 &&
      now - status.generatedAtMs > STALE_MS);
  const fmt = (v: number | null) => (v === null ? "--" : String(v));

  return (
    <div className="p-4">
      <div className="border border-border-default rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="text-xs font-medium text-text-secondary">
              {t("atlasRelay")}
            </span>
          </div>
          {isStale && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning">
              {t("stale")}
            </span>
          )}
        </div>

        <p className="text-[10px] text-text-tertiary">{t("relayForwarding")}</p>

        <div className={cn("grid grid-cols-4 gap-2", isStale && "opacity-50")}>
          <Stat label={t("relaySeen")} value={fmt(status.datagramsSeen)} />
          <Stat label={t("relayForwarded")} value={fmt(status.forwarded)} />
          <Stat label={t("relayDropped")} value={fmt(status.malformed)} />
          <Stat label={t("relayFailed")} value={fmt(status.forwardFailed)} />
        </div>

        <div className="flex items-center justify-between border-t border-border-default pt-2">
          <span className="text-[10px] text-text-secondary">
            {t("relayKeepRate")}
          </span>
          <span className="text-[10px] font-mono text-text-primary tabular-nums">
            {keepRate}
          </span>
        </div>

        {status.computeUrl && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">
              {t("relayCompute")}
            </span>
            <span
              className="text-[10px] font-mono text-text-secondary truncate max-w-[60%]"
              title={status.computeUrl}
            >
              {status.computeUrl}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
