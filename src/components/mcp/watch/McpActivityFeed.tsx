/**
 * @module components/mcp/watch/McpActivityFeed
 * @description Headless bridge (renders null) that streams the local MCP
 * activity file into `mcp-activity-store` over SSE. LOCAL-FIRST: it opens the
 * same-origin `/api/mcp/activity/stream` route, which tails a file on the
 * machine the GCS server runs on — no cloud, no network to the MCP. On a hosted
 * HTTPS tab (cloud mode) the local file is unreachable, so we skip the stream
 * and mark the channel `unavailable` (the panel then shows the "open locally"
 * hint). In demo mode a synthetic stream drives the panel + auto-navigate with
 * no MCP present. Mounted once, shell-wide, in CommandShell.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { useMcpActivityStore } from "@/stores/mcp-activity-store";
import { getFleetDrones } from "@/stores/node-registry/use-fleet-drones";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { isDemoMode } from "@/lib/utils";
import type { McpActivityWire, McpChannelFrame } from "@/lib/mcp/activity";

/** A small rotating script the demo emitter replays so the panel + auto-nav are
 *  exercisable with no MCP running. */
const DEMO_SCRIPT: Array<Pick<McpActivityWire, "tool" | "args" | "result" | "latencyMs">> = [
  { tool: "status.get", args: {}, result: "ok", latencyMs: 42 },
  { tool: "params.get", args: { name: "INS_HNTCH_OPTS" }, result: "2", latencyMs: 61 },
  { tool: "params.set", args: { name: "INS_HNTCH_OPTS", value: 2 }, result: "ok", latencyMs: 88 },
  { tool: "telemetry.get", args: {}, result: "ok", latencyMs: 35 },
  { tool: "flight.mode", args: { mode: "LOITER" }, result: "ok", latencyMs: 120 },
  { tool: "mission.download", args: {}, result: "12 items", latencyMs: 210 },
  { tool: "plugins.list", args: {}, result: "3 installed", latencyMs: 54 },
  { tool: "vision.status", args: {}, result: "ok", latencyMs: 47 },
];

export function McpActivityFeed() {
  const ingest = useMcpActivityStore((s) => s.ingest);
  const setChannelState = useMcpActivityStore((s) => s.setChannelState);

  useEffect(() => {
    // Demo: replay a synthetic script against a real fleet node so the panel and
    // the auto-navigate bridge have something to show and follow.
    if (isDemoMode()) {
      setChannelState("live");
      let i = 0;
      const tick = () => {
        const drones = getFleetDrones();
        const target = drones[i % Math.max(1, drones.length)];
        const node = target ? (deviceIdFromNodeId(target.id) ?? target.id) : "local";
        const step = DEMO_SCRIPT[i % DEMO_SCRIPT.length];
        ingest({ ...step, node, decision: "allowed", plane: "lan_direct", tsUs: Date.now() * 1000 });
        i++;
      };
      const id = setInterval(tick, 3500);
      return () => clearInterval(id);
    }

    // Hosted HTTPS tab = cloud mode: the local file is on a different machine,
    // so the local-first channel is unavailable. Do not open the stream.
    if (typeof window !== "undefined" && window.location.protocol === "https:") {
      setChannelState("unavailable");
      return;
    }

    const es = new EventSource("/api/mcp/activity/stream");
    es.addEventListener("activity", (ev) => {
      try {
        ingest(JSON.parse((ev as MessageEvent).data) as McpActivityWire);
      } catch {
        /* skip an unparseable line */
      }
    });
    es.addEventListener("channel", (ev) => {
      try {
        const frame = JSON.parse((ev as MessageEvent).data) as McpChannelFrame;
        setChannelState(frame.channel);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; reflect the gap without tearing down.
      setChannelState("connecting");
    };
    return () => es.close();
  }, [ingest, setChannelState]);

  return null;
}
