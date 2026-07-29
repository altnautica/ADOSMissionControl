"use client";

/**
 * @module VisionDetectionsBridge
 * @description Always-mounted, route-agnostic opener for the per-drone detection
 * WebSocket — the detection-feed counterpart of `CloudStatusBridge` (which does
 * the same for the WHEP video host). It resolves the SELECTED drone's LAN host +
 * pairing key LOCAL-FIRST from `local-nodes-store` (by device id) and opens
 * `connectVisionDetections`, so bounding boxes flow for a locally-paired drone
 * regardless of which tab is showing — instead of depending on
 * `useAgentConnectionStore.agentUrl`, which the cockpit's own opener gated on and
 * which is null for a LAN pairing. Renders null; no-op in demo (the mock stream
 * feeds the store directly) and until a reachable host + selected drone exist.
 *
 * On an HTTPS origin `resolveLanAgentUrl` returns null (a browser can't `ws://`
 * a private LAN host from an https page — mixed content); that path is served by
 * the cloud-relay detection topic (`MqttBridge`'s `vision/detections` handler).
 *
 * A drone reached ONLY through a ground station's WFB relay (no LAN, no cloud
 * pairing of its own) has no `resolveLanAgentUrl` either, so it fell through to
 * nothing: `CockpitTargetOverlay` saw an empty batch forever even while the
 * ground station was faithfully relaying the drone's own detection stream.
 *
 * The relay branch below POLLS instead of opening a WebSocket. The ground
 * station's relay-proxy (`gs_relay_proxy.rs`) tunnels one unary HTTP
 * request/response pair over the aux radio lane per call (`AUX_MAX_PAYLOAD`
 * bounds the request; there is no upgrade passthrough for a persistent duplex
 * stream) — a raw WebSocket cannot cross it. The agent's `GET
 * /api/vision/detections/latest` reads one frame off the SAME last-state
 * broadcast socket the WS route streams from and returns it as JSON, which
 * DOES fit the relay-proxy's unary shape. The relay branch polls that
 * endpoint through `/api/lan-pair/vision-detections-latest` (server-side, so
 * an HTTPS page never mixed-content-blocks the plain-HTTP ground station) on
 * a ~250ms interval (~4 Hz — inside the plugin's own 6 Hz ceiling and the
 * documented 3-4/s click-to-track usability floor) and feeds the IDENTICAL
 * `setBatch` seam the LAN and MQTT paths use — no new store. A true
 * low-latency push tunnel over the radio remains a follow-up (see
 * `vision_detections.py`'s WFB-RELAY FOLLOW-UP note on the agent side).
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";

import { useDroneManager } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useFleetStore } from "@/stores/fleet-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  resolveLanAgentUrl,
  resolvePairedApiKey,
} from "@/stores/agent-connection/cloud-state";
import {
  connectVisionDetections,
  mapWireBatch,
  type WireDetectionBatch,
} from "@/lib/agent/vision-detections-ws";
import {
  resolveRelayReach,
  type RelayReach,
} from "@/lib/nodes/relay-reach";

/** Poll interval for the relay lane's detection feed. ~4 Hz: inside the
 * follow-me plugin's own `output_rate_hz: 6` ceiling, above the documented
 * 3-4/s floor a click-to-track loop stays usable at. */
const RELAY_POLL_INTERVAL_MS = 250;

/** Fetch one detection batch through the relay-proxy poll route, or null on
 * any failure (caller just tries again next tick — a poll miss is not an
 * error state, it is the steady state until vision comes up). */
async function pollRelayDetections(
  reach: RelayReach,
  signal: AbortSignal,
): Promise<unknown | null> {
  const res = await fetch("/api/lan-pair/vision-detections-latest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host: reach.baseUrl,
      apiKey: reach.apiKey,
      peerDeviceId: reach.peerDeviceId,
    }),
    signal,
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Poll the latest-detection endpoint for one WFB-relayed drone through its
 * ground station's relay-proxy, and feed the identical `setBatch` seam the
 * LAN path uses. Returns a handle whose `close()` tears the interval down
 * and clears the drone's batch — same contract as `connectVisionDetections`.
 */
function connectRelayVisionDetections(opts: {
  droneId: string;
  reach: RelayReach;
}): { close: () => void } {
  const { droneId, reach } = opts;
  const setBatch = useVisionDetectionsStore.getState().setBatch;
  const clearBatch = useVisionDetectionsStore.getState().clearBatch;

  let closed = false;
  let inFlight: AbortController | null = null;
  let polling = false;

  async function tick() {
    if (closed || polling) return;
    polling = true;
    inFlight = new AbortController();
    try {
      const raw = await pollRelayDetections(reach, inFlight.signal);
      if (
        !closed &&
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw)
      ) {
        const batch = mapWireBatch(raw as WireDetectionBatch);
        if (batch) setBatch(droneId, batch);
      }
    } catch {
      // Transient poll failure — the next tick tries again.
    } finally {
      inFlight = null;
      polling = false;
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), RELAY_POLL_INTERVAL_MS);

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
      inFlight?.abort();
      clearBatch(droneId);
    },
  };
}

export function VisionDetectionsBridge() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  // Subscribe to the local-nodes set so the feed reconnects the moment a node's
  // host/key appears or changes (e.g. just after a local pairing).
  const nodes = useLocalNodesStore((s) => s.nodes);
  // Minimal, primitive-valued selectors (not the whole `drones` array, which
  // gets a fresh reference on every telemetry tick) so the relay reach below
  // only recomputes when THIS drone's own relay identity actually changes.
  const droneReachedVia = useFleetStore((s) =>
    selectedDroneId
      ? s.drones.find((d) => d.id === selectedDroneId)?.reachedVia
      : undefined,
  );
  const droneCloudDeviceId = useFleetStore((s) =>
    selectedDroneId
      ? s.drones.find((d) => d.id === selectedDroneId)?.cloudDeviceId
      : undefined,
  );

  const target = useMemo(() => {
    const deviceId = selectedDroneId ? deviceIdFromNodeId(selectedDroneId) : null;
    if (!selectedDroneId || !deviceId) {
      return {
        droneId: null as string | null,
        agentUrl: null as string | null,
        apiKey: null as string | null,
        relay: null as RelayReach | null,
      };
    }
    const agentUrl = resolveLanAgentUrl(deviceId);
    if (agentUrl) {
      return {
        droneId: selectedDroneId,
        agentUrl,
        apiKey: resolvePairedApiKey(deviceId),
        relay: null as RelayReach | null,
      };
    }
    // No LAN reach: fall back to the ground station's relay-proxy for a
    // drone reached only through another node's WFB radio.
    const relay = resolveRelayReach({
      agentDeviceId: droneCloudDeviceId ?? null,
      reachedVia: droneReachedVia,
      droneDeviceId: deviceId,
    });
    return {
      droneId: selectedDroneId,
      agentUrl: null as string | null,
      apiKey: null as string | null,
      relay,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDroneId, nodes, droneReachedVia, droneCloudDeviceId]);

  useEffect(() => {
    if (!target.droneId) return;
    if (target.agentUrl) {
      const conn = connectVisionDetections({
        droneId: target.droneId,
        agentUrl: target.agentUrl,
        apiKey: target.apiKey,
      });
      return () => conn.close();
    }
    if (target.relay) {
      const conn = connectRelayVisionDetections({
        droneId: target.droneId,
        reach: target.relay,
      });
      return () => conn.close();
    }
  }, [target.droneId, target.agentUrl, target.apiKey, target.relay]);

  return null;
}
