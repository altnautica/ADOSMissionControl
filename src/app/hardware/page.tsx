"use client";

/**
 * @module HardwarePage
 * @description Hardware tab Overview sub-view. Polls the agent at 2 Hz for
 * /api/v1/ground-station/status and mirrors the tab-visibility pause pattern
 * used by agent-connection-store.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { PairModal } from "@/components/hardware/PairModal";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 500; // 2 Hz
const EMPTY = "…";

function formatRssi(rssi: number | null): string {
  if (rssi == null) return EMPTY;
  return `${rssi.toFixed(0)} dBm`;
}

function formatBitrate(mbps: number | null): string {
  if (mbps == null) return EMPTY;
  return `${mbps.toFixed(1)} Mbps`;
}

function formatChannel(channel: number | null): string {
  if (channel == null) return EMPTY;
  return `CH ${channel}`;
}

function formatProfile(profile: string): string {
  if (profile === "ground_station") return "Ground Station";
  if (profile === "drone") return "Drone";
  if (profile === "auto") return "Auto";
  return "Unconfigured";
}

export default function HardwarePage() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const status = useGroundStationStore((s) => s.status);
  const linkHealth = useGroundStationStore((s) => s.linkHealth);
  const loading = useGroundStationStore((s) => s.loading);
  const lastError = useGroundStationStore((s) => s.lastError);
  const lastFetchedAt = useGroundStationStore((s) => s.lastFetchedAt);
  const loadStatus = useGroundStationStore((s) => s.loadStatus);
  const setLoading = useGroundStationStore((s) => s.setLoading);
  const setError = useGroundStationStore((s) => s.setError);

  const [pairOpen, setPairOpen] = useState(false);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const client = groundStationApiFromAgent(agentUrlRef.current, apiKeyRef.current);
      if (!client) {
        setLoading(false);
        return;
      }
      if (!useGroundStationStore.getState().lastFetchedAt) {
        setLoading(true);
      }
      try {
        const res = await client.getStatus();
        if (cancelled) return;
        loadStatus(
          {
            paired_drone: res.paired_drone ?? null,
            profile: res.profile ?? "unconfigured",
            uplink_active: res.uplink_active ?? null,
          },
          res.link_health,
        );
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to reach ground station";
        setError(msg);
        setLoading(false);
      }
    };

    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [loadStatus, setLoading, setError]);

  const hasAgent = Boolean(agentUrl);
  const hasData = lastFetchedAt != null && hasAgent;

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-semibold text-text-primary">Hardware</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Ground station, radios, and physical peripherals.
        </p>

        <HardwareTabs />

        <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-text-primary">Ground Station Overview</h2>
            {loading && hasAgent ? (
              <span className="text-xs text-text-secondary">Loading...</span>
            ) : null}
          </div>

          {!hasAgent ? (
            <div className="py-8 text-center text-sm text-text-secondary">
              No ground station connected.
            </div>
          ) : null}

          {hasAgent && lastError && !hasData ? (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
              {lastError}
            </div>
          ) : null}

          {hasAgent && hasData ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <StatRow label="Paired drone" value={status.paired_drone ?? "None"} />
              <StatRow label="Profile" value={formatProfile(status.profile)} />
              <StatRow label="Uplink active" value={status.uplink_active ?? EMPTY} />
              <StatRow label="Link RSSI" value={formatRssi(linkHealth.rssi_dbm)} />
              <StatRow label="Bitrate" value={formatBitrate(linkHealth.bitrate_mbps)} />
              <StatRow label="Channel" value={formatChannel(linkHealth.channel)} />
              <StatRow label="FEC recovered" value={String(linkHealth.fec_rec)} />
              <StatRow label="FEC lost" value={String(linkHealth.fec_lost)} />
            </dl>
          ) : null}
        </section>

        {hasAgent ? (
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={() => setPairOpen(true)}>
              Pair with drone
            </Button>
          </div>
        ) : null}

        <PairModal open={pairOpen} onClose={() => setPairOpen(false)} />
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-primary/40 py-1.5">
      <dt className="text-xs uppercase tracking-wide text-text-secondary">{label}</dt>
      <dd className="font-mono text-sm text-text-primary">{value}</dd>
    </div>
  );
}
