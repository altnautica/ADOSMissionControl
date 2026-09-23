/**
 * @module mcp-activity-store
 * @description Live feed of MCP tool-call activity, tailed from the MCP server's
 * local audit file (see `McpActivityFeed`). Holds a bounded ring of recent rows
 * plus a monotonic `count` for the "new activity" rail badge (mirrors
 * `log-activity-store`). The optional running lane merges a `started` marker
 * with its later completion by `callId`. Local-first: nothing here touches the
 * network — the source is a file on the operator's own machine.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import {
  categoryForTool,
  summarizeTool,
  surfaceForTool,
  type McpActivityRow,
  type McpActivityWire,
  type McpChannelState,
} from "@/lib/mcp/activity";

/** Bounded so a long session never grows without bound. */
const MAX_ROWS = 500;

let seq = 0;

interface McpActivityState {
  /** Recent rows, oldest-first. Bounded to MAX_ROWS. */
  events: McpActivityRow[];
  /** Monotonic total ingested since mount — backs the rail "new" badge. */
  count: number;
  /** Health of the local file channel. */
  channelState: McpChannelState;
  /** The most recent terminal row, for the auto-navigate bridge to react to. */
  latestNav: McpActivityRow | null;

  /** Ingest one wire event (start marker or completion). */
  ingest: (wire: McpActivityWire) => void;
  setChannelState: (state: McpChannelState) => void;
  clear: () => void;
}

function rowFromWire(wire: McpActivityWire): McpActivityRow {
  const tool = wire.tool ?? "unknown";
  const args = wire.args ?? {};
  const lifecycle: McpActivityRow["lifecycle"] =
    wire.phase === "started"
      ? "running"
      : wire.decision === "denied" || wire.decision === "operator_absent"
        ? "error"
        : "success";
  return {
    id: `mcp-${seq++}`,
    callId: wire.callId,
    tsUs: wire.tsUs ?? Date.now() * 1000,
    tool,
    summary: summarizeTool(tool, args),
    category: categoryForTool(tool),
    node: wire.node ?? "local",
    decision: wire.decision ?? "allowed",
    lifecycle,
    result: wire.result ?? "",
    latencyMs: wire.latencyMs ?? 0,
    args,
    plane: wire.plane ?? "lan_direct",
    surface: surfaceForTool(tool),
  };
}

export const useMcpActivityStore = create<McpActivityState>((set) => ({
  events: [],
  count: 0,
  channelState: "connecting",
  latestNav: null,

  ingest: (wire) =>
    set((s) => {
      const row = rowFromWire(wire);
      // Merge a completion into its earlier `started` row (same callId) so the
      // running row flips in place rather than duplicating.
      if (row.callId && wire.phase !== "started") {
        const idx = s.events.findIndex(
          (e) => e.callId === row.callId && e.lifecycle === "running",
        );
        if (idx !== -1) {
          const merged = [...s.events];
          merged[idx] = { ...row, id: s.events[idx].id };
          return {
            events: merged,
            count: s.count + 1,
            channelState: "live",
            latestNav: merged[idx],
          };
        }
      }
      const events = [...s.events, row];
      if (events.length > MAX_ROWS) events.splice(0, events.length - MAX_ROWS);
      return {
        events,
        count: s.count + 1,
        channelState: "live",
        // Only terminal rows drive auto-navigation; a bare `started` waits for
        // its completion so the surface changes when the effect lands.
        latestNav: row.lifecycle === "running" ? s.latestNav : row,
      };
    }),

  setChannelState: (channelState) => set({ channelState }),
  clear: () => set({ events: [], latestNav: null }),
}));
