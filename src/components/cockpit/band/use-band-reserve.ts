"use client";

/**
 * Time to the battery reserve, for the safety band's battery cell, from the
 * node's battery engine (`GET /api/v1/battery`) over this node's own agent
 * connection.
 *
 * `null` when the node has no battery engine this browser can read (no direct
 * agent connection, the engine is off, or the route is absent): the band then
 * shows only the percentage. Otherwise the reserve state of the pack the
 * engine predicts for; its `etaS` is null when the engine has no fresh
 * prediction (stale report, idle pack), which the band shows as the no-data
 * glyph rather than a remembered figure.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import type { AgentClient } from "@/lib/agent/client";
import type { BatteryHealth } from "@/lib/agent/schemas/battery";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";

const POLL_MS = 5000;

export interface BandReserve {
  /** Seconds until the reserve, or null when no fresh prediction exists. */
  etaS: number | null;
  /** The pack is already below its reserve. */
  past: boolean;
}

/** The band's reading of one battery-engine report. */
export function reserveFromHealth(health: BatteryHealth): BandReserve | null {
  if (!health.enabled) return null;
  const pack = health.packs.find((p) => p.prediction.state !== "idle") ?? health.packs[0];
  if (!pack || health.stale || pack.stale) return { etaS: null, past: false };
  const { state, eta_s } = pack.prediction;
  if (state === "past") return { etaS: 0, past: true };
  return { etaS: state === "idle" ? null : eta_s, past: false };
}

interface ReserveRead {
  client: AgentClient | null;
  value: BandReserve | null;
}

export function useBandReserve(droneId: string): BandReserve | null {
  const client = useNodeDirectAgent(deviceIdFromNodeId(droneId) ?? droneId)?.client ?? null;
  const [read, setRead] = useState<ReserveRead>({ client: null, value: null });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const health = await client.getBatteryHealth();
        if (!cancelled) setRead({ client, value: reserveFromHealth(health) });
      } catch {
        // An absent route or a dropped read is no reading, never the last one.
        if (!cancelled) setRead({ client, value: null });
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  return read.client === client ? read.value : null;
}
