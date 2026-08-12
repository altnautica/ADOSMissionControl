"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { AgentClient } from "@/lib/agent/client";
import {
  ChannelHistoryChart,
  type HoppingState,
} from "@/components/hardware/ChannelHistoryChart";

// Heartbeat older than this marks the link telemetry as stale. The panel
// polls at 1 Hz, so a few missed polls still reads fresh; this only trips
// when the agent has gone quiet for a meaningful stretch.
const TELEMETRY_STALE_MS = 6000;

type VideoConfigRadio = {
  channel: number | null;
  band: string | null;
  mcs_index: number | null;
  fec_k: number | null;
  fec_n: number | null;
  tx_power_dbm: number | null;
  preset: string | null;
};

type VideoConfigEncoder = {
  bitrate_kbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
};

type AdaptiveTier = {
  idx: number;
  name: string;
  bitrate_kbps: number;
  fec_k: number;
  fec_n: number;
};

type VideoConfigAdaptive = {
  available: boolean;
  enabled?: boolean;
  auto?: boolean;
  tier_idx?: number;
  tier_name?: string;
  bitrate_kbps?: number;
  fec_k?: number;
  fec_n?: number;
  bad_streak?: number;
  clean_streak?: number;
  last_action_reason?: string;
  tiers?: AdaptiveTier[];
};

// Link-liveness fields the agent reports alongside the config. All
// optional and defaulted — older agents omit them and the panel reads
// them defensively so it still renders on older firmware.
type VideoConfigLink = {
  // Per-stream transmit/receive throughput counters. Flat counters while
  // the link reports connected indicate a silently dead radio pipe.
  tx_bytes_per_s?: number | null;
  valid_rx_packets_per_s?: number | null;
  video_inbound_bytes_per_s?: number | null;
  rx_silent_seconds?: number | null;
  // Single-node acquisition signal. Each agent reports only its own
  // radio state: the channel it sits on, whether it has locked onto the
  // peer, and where it is in the acquisition flow. There is no peer
  // channel on this payload, so lock is the only cross-link truth.
  channel?: number | null;
  channel_locked?: boolean | null;
  acquire_state?: string | null;
};

type VideoConfig = {
  radio: VideoConfigRadio;
  encoder: VideoConfigEncoder;
  adaptive: VideoConfigAdaptive;
  link?: VideoConfigLink;
  hopping?: HoppingState;
  warnings?: string[];
};

type VideoLatency = {
  latency_ms: number | null;
  ewma_ms?: number | null;
  samples?: number | null;
  source?: string;
};

const _POLL_INTERVAL_MS = 1000;

/**
 * Live operator surface for the closed-loop video bitrate / FEC
 * controller. Polls /api/video/config + /api/video/latency at 1 Hz
 * and surfaces the controller's tier ladder, the current radio
 * config, and the SEI-probe glass-to-glass latency. Manual override
 * controls let an operator pin a specific tier or toggle the
 * controller into manual mode.
 *
 * Renders nothing when the agent doesn't expose /api/video/config
 * (older agent build) — fail-quiet so the Hardware tab still loads
 * on older firmware.
 */
export function VideoLinkPanel() {
  const t = useTranslations("hardware.videoLink");
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const [config, setConfig] = useState<VideoConfig | null>(null);
  const [latency, setLatency] = useState<VideoLatency | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wall-clock of the last successful config fetch. Drives the
  // telemetry-stale badge: a heartbeat older than the threshold means the
  // link readouts can no longer be trusted as current.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const client = useMemo(() => {
    if (!agentUrl) return null;
    return new AgentClient(agentUrl, apiKey);
  }, [agentUrl, apiKey]);

  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const [cfg, lat] = await Promise.all([
        client.getVideoConfig() as Promise<VideoConfig | null>,
        client.getVideoLatency() as Promise<VideoLatency | null>,
      ]);
      if (cfg) {
        setConfig(cfg);
        setLastUpdatedAt(Date.now());
      }
      if (lat) setLatency(lat);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void refresh();
    pollRef.current = window.setInterval(() => {
      void refresh();
      // Tick a clock so the stale badge reflects the gap even when polls
      // stop returning data.
      setNow(Date.now());
    }, _POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [client, refresh]);

  const telemetryStale =
    lastUpdatedAt != null && now - lastUpdatedAt > TELEMETRY_STALE_MS;

  const onSetAuto = useCallback(
    async (next: boolean) => {
      if (!client) return;
      setBusy(true);
      try {
        await client.setVideoConfig({ auto: next });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [client, refresh],
  );

  const onPinTier = useCallback(
    async (idx: number) => {
      if (!client) return;
      setBusy(true);
      try {
        await client.setVideoConfig({ tier_idx: idx });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [client, refresh],
  );

  if (!client || !config) {
    return null;
  }

  const { radio, encoder, adaptive } = config;
  const link = config.link ?? {};
  const tiers = adaptive.tiers ?? [];
  const activeTierIdx = adaptive.tier_idx ?? -1;
  const auto = adaptive.auto ?? true;

  // Acquisition signal. A single agent payload only knows its own radio
  // state, so we cannot compare peer channels here. The link is still
  // acquiring when it has not locked onto the peer (channel_locked is
  // explicitly false) or the agent reports it is searching. Once locked,
  // the banner clears.
  const acquiring =
    link.channel_locked === false || link.acquire_state === "searching";

  const fmtRate = (v: number | null | undefined, unit: string): string =>
    v == null ? "—" : `${Math.round(v)} ${unit}`;

  return (
    <>
    <section className="rounded border border-border-default bg-surface-primary">
      <header className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-mono uppercase tracking-widest text-text-primary">
            {t("title")}
          </div>
          {telemetryStale ? (
            <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-widest text-status-warning">
              {t("stale")}
            </span>
          ) : null}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary">
          {adaptive.available
            ? auto
              ? "Adaptive"
              : "Manual"
            : "Static"}
        </div>
      </header>

      {acquiring ? (
        <div className="border-b border-status-warning/40 bg-status-warning/10 px-3 py-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-status-warning">
            {t("acquiring")}
          </div>
          <div className="mt-1 text-[10px] font-mono text-text-secondary">
            {t("acquiringDetail")}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 p-3 text-[11px] font-mono">
        <ReadoutRow
          label="Latency"
          value={
            latency?.latency_ms != null
              ? `${Math.round(latency.latency_ms)} ms`
              : "—"
          }
          hint={
            latency?.ewma_ms != null
              ? `ewma ${Math.round(latency.ewma_ms)} ms`
              : undefined
          }
        />
        <ReadoutRow
          label="Encoder"
          value={
            encoder.bitrate_kbps != null
              ? `${encoder.bitrate_kbps} kbps`
              : "—"
          }
          hint={
            encoder.codec
              ? `${encoder.codec.toUpperCase()} ${encoder.width ?? "?"}x${
                  encoder.height ?? "?"
                }@${encoder.fps ?? "?"}`
              : undefined
          }
        />
        <ReadoutRow
          label="Radio FEC"
          value={
            radio.fec_k != null && radio.fec_n != null
              ? `${radio.fec_k}/${radio.fec_n}`
              : "—"
          }
          hint={
            radio.mcs_index != null ? `MCS ${radio.mcs_index}` : undefined
          }
        />
        <ReadoutRow
          label="Channel"
          value={radio.channel != null ? String(radio.channel) : "—"}
          hint={radio.tx_power_dbm != null ? `${radio.tx_power_dbm} dBm` : undefined}
        />
      </div>

      {/* Link liveness counters. Rendered only when the agent reports the
          link block; older builds omit it. */}
      {config.link ? (
        <div className="grid grid-cols-2 gap-2 border-t border-border-default p-3 text-[11px] font-mono">
          <ReadoutRow
            label={t("txRate")}
            value={fmtRate(link.tx_bytes_per_s, "B/s")}
          />
          <ReadoutRow
            label={t("rxPackets")}
            value={fmtRate(link.valid_rx_packets_per_s, "pkt/s")}
          />
          <ReadoutRow
            label={t("videoInbound")}
            value={fmtRate(link.video_inbound_bytes_per_s, "B/s")}
          />
          <ReadoutRow
            label={t("rxSilent")}
            value={
              link.rx_silent_seconds != null
                ? `${Math.round(link.rx_silent_seconds)} s`
                : "—"
            }
          />
        </div>
      ) : null}

      {adaptive.available && tiers.length > 0 ? (
        <div className="border-t border-border-default px-3 py-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary">
              Tier ladder
            </span>
            <label className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-text-primary">
              <input
                type="checkbox"
                checked={auto}
                disabled={busy}
                onChange={(e) => onSetAuto(e.target.checked)}
              />
              auto
            </label>
          </div>
          <div className="flex flex-wrap gap-1">
            {tiers.map((tier) => {
              const active = tier.idx === activeTierIdx;
              return (
                <button
                  key={tier.idx}
                  type="button"
                  disabled={busy}
                  onClick={() => onPinTier(tier.idx)}
                  className={`px-2 py-1 text-[10px] font-mono uppercase tracking-widest rounded border transition-colors ${
                    active
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-border-default text-text-secondary hover:border-accent-primary/50"
                  }`}
                  title={`${tier.bitrate_kbps} kbps · FEC ${tier.fec_k}/${tier.fec_n}`}
                >
                  {tier.name}
                </button>
              );
            })}
          </div>
          {adaptive.last_action_reason ? (
            <div className="mt-2 text-[10px] font-mono text-text-tertiary">
              last: {adaptive.last_action_reason}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="border-t border-border-default px-3 py-2 text-[10px] font-mono text-status-error">
          {error}
        </div>
      ) : null}
    </section>
    <ChannelHistoryChart
      hopping={config.hopping}
      currentChannel={radio.channel}
    />
    </>
  );
}

function ReadoutRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
        {label}
      </span>
      <span className="text-text-primary">{value}</span>
      {hint ? <span className="text-text-tertiary">{hint}</span> : null}
    </div>
  );
}
