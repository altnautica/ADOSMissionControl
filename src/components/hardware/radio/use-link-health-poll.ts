"use client";

/**
 * @module hardware/radio/use-link-health-poll
 * @description Self-scheduling link-health poll of the connected ground-station agent, plus its WFB TX power readings.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { POLL_INTERVAL_MS } from "./constants";

export function useLinkHealthPoll(agentUrl: string | null, apiKey: string | null) {
  const loadStatus = useGroundStationStore((s) => s.loadStatus);
  const invalidateLinkHealth = useGroundStationStore(
    (s) => s.invalidateLinkHealth,
  );
  const [wfbTxPowerDbm, setWfbTxPowerDbm] = useState<number | null>(null);
  const [wfbTxReadbackDbm, setWfbTxReadbackDbm] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Self-scheduling poll: the next tick is only armed once this one settles.
    // The link-health poll does two sequential round-trips (getStatus +
    // getWfb), so on a slow agent link a fixed-interval timer would queue
    // overlapping requests onto the agent. Re-arming in the finally guarantees
    // at most one in-flight poll at a time.
    const poll = async () => {
      if (cancelled || (typeof document !== "undefined" && document.hidden)) {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }
      try {
        const status = await api.getStatus();
        if (cancelled) return;
        loadStatus(
          {
            paired_drone: status.paired_drone ?? null,
            profile: status.profile ?? "unconfigured",
            uplink_active: status.uplink_active ?? null,
            pair_rearm: status.pair_rearm ?? null,
          },
          status.link_health,
        );
        try {
          const wfb = await api.getWfb();
          if (cancelled) return;
          setWfbTxPowerDbm(
            typeof wfb.tx_power_dbm === "number" ? wfb.tx_power_dbm : null,
          );
          setWfbTxReadbackDbm(
            typeof wfb.tx_power_readback_dbm === "number" ? wfb.tx_power_readback_dbm : null,
          );
        } catch {
          // No answer means no reading: the slider shows "—" rather than
          // the last value as if it were live.
          if (!cancelled) { setWfbTxPowerDbm(null); setWfbTxReadbackDbm(null); }
        }
        setPollError(null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "poll failed";
        setPollError(msg);
        // The agent did not answer, so the last snapshot is no longer a
        // reading. Keeping it is what let the card report "connected, -58 dBm"
        // indefinitely after the ground station lost power.
        invalidateLinkHealth(msg);
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [agentUrl, apiKey, loadStatus, invalidateLinkHealth]);

  return { wfbTxPowerDbm, wfbTxReadbackDbm, pollError };
}
