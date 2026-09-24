/**
 * @license GPL-3.0-only
 *
 * Unit tests for the Radio / Network Health surface: the pure event
 * summary/severity mapping, the durable-store event-kind query the store
 * issues, and graceful degradation when the logging surface is absent
 * (older agent / cloud mode) so the panel falls back to live indicators.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  RADIO_NETWORK_EVENT_KINDS,
  mapRadioNetworkEvents,
} from "@/lib/agent/radio-network-events";
import type { EventsRow } from "@/lib/agent/agent-client/logging";
import { useRadioNetworkHealthStore } from "../radio-network-health-store";
import type { AgentClient } from "@/lib/agent/client";

const envelope = (data: EventsRow[]) => ({
  data,
  page: { next_cursor: null, count: data.length },
  meta: { source: "logd", v: 1, ts: "now", db_lag_ms: 0 },
});

function loggingClient(query: ReturnType<typeof vi.fn>): AgentClient {
  return { logging: { query } } as unknown as AgentClient;
}

function row(
  kind: string,
  data: Record<string, unknown>,
  tsUs = 1_000_000,
): EventsRow {
  return { ts: new Date(tsUs / 1000).toISOString(), ts_us: tsUs, kind, data };
}

describe("mapRadioNetworkEvents", () => {
  it("sorts newest-first and caps at the requested max", () => {
    const rows = [
      row("radio.bind", {}, 1_000),
      row("radio.bind_failed", { reason: "no_peer" }, 3_000),
      row("network.wifi_reassociated", { consecutive_failures: 1 }, 2_000),
    ];
    const mapped = mapRadioNetworkEvents(rows, 2);
    expect(mapped).toHaveLength(2);
    expect(mapped[0].tsUs).toBe(3_000);
    expect(mapped[1].tsUs).toBe(2_000);
    expect(mapped[0].id).toContain("radio.bind_failed");
  });

  it("yields stable unique ids for same-timestamp rows", () => {
    const rows = [
      row("radio.bind", {}, 5_000),
      row("radio.bind", {}, 5_000),
    ];
    const mapped = mapRadioNetworkEvents(rows, 15);
    expect(mapped[0].id).not.toBe(mapped[1].id);
  });
});

describe("useRadioNetworkHealthStore.loadEvents", () => {
  beforeEach(() => {
    useRadioNetworkHealthStore.getState().clear();
  });

  it("queries the durable store with the radio/network event kinds", async () => {
    const queryMock = vi.fn().mockResolvedValue(
      envelope([
        row(
          "radio.reg_reasserted",
          { from_country: "BO", to_country: "US", channel_permitted: true },
          1_000,
        ),
        row("radio.bind_failed", { reason: "no_peer" }, 2_000),
      ]),
    );

    await useRadioNetworkHealthStore.getState().loadEvents("drone-a", loggingClient(queryMock));

    expect(queryMock).toHaveBeenCalledTimes(1);
    const params = queryMock.mock.calls[0][0];
    expect(params.kind).toBe("events");
    expect(params.event_kind).toEqual([...RADIO_NETWORK_EVENT_KINDS]);

    const state = useRadioNetworkHealthStore.getState();
    expect(state.deviceId).toBe("drone-a");
    expect(state.available).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.recentEvents).toHaveLength(2);
    // Newest (bind_failed at 2_000us) is first.
    expect(state.recentEvents[0].kind).toBe("radio.bind_failed");
    expect(state.recentEvents[0].severity).toBe("error");
  });

  it("degrades gracefully when there is no logging surface (older agent)", async () => {
    await useRadioNetworkHealthStore
      .getState()
      .loadEvents("drone-a", { logging: undefined } as unknown as AgentClient);
    const state = useRadioNetworkHealthStore.getState();
    expect(state.available).toBe(false);
    expect(state.recentEvents).toHaveLength(0);
    expect(state.loading).toBe(false);
  });

  it("degrades gracefully (no crash) when the store query throws", async () => {
    const queryMock = vi
      .fn()
      .mockRejectedValue(new Error("logd unavailable: no tier answered"));

    await expect(
      useRadioNetworkHealthStore.getState().loadEvents("drone-a", loggingClient(queryMock)),
    ).resolves.toBeUndefined();

    const state = useRadioNetworkHealthStore.getState();
    expect(state.available).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toContain("logd unavailable");
  });

  it("drops the previous node's late feed after a switch", async () => {
    const pendingA = Promise.withResolvers<ReturnType<typeof envelope>>();
    const queryA = vi.fn(() => pendingA.promise);
    const queryB = vi.fn().mockResolvedValue(envelope([]));
    const store = useRadioNetworkHealthStore.getState();

    const loadA = store.loadEvents("drone-a", loggingClient(queryA));
    await store.loadEvents("drone-b", loggingClient(queryB));
    pendingA.resolve(envelope([row("radio.bind_failed", { reason: "no_peer" }, 2_000)]));
    await loadA;

    const state = useRadioNetworkHealthStore.getState();
    expect(state.deviceId).toBe("drone-b");
    expect(state.recentEvents).toHaveLength(0);
  });

  it("clear() resets the feed and availability", async () => {
    const queryMock = vi.fn().mockResolvedValue(envelope([row("radio.bind", {})]));
    await useRadioNetworkHealthStore.getState().loadEvents("drone-a", loggingClient(queryMock));
    expect(useRadioNetworkHealthStore.getState().recentEvents).toHaveLength(1);

    useRadioNetworkHealthStore.getState().clear();
    const state = useRadioNetworkHealthStore.getState();
    expect(state.recentEvents).toHaveLength(0);
    expect(state.available).toBe(false);
  });
});

describe("MockLoggingService demo-mode events", () => {
  it("returns radio/network events filtered by event_kind", async () => {
    const { MockLoggingService } = await import("@/mock/agent/logging");
    const svc = new MockLoggingService();
    const env = await svc.query<EventsRow>({
      kind: "events",
      event_kind: [...RADIO_NETWORK_EVENT_KINDS],
      limit: 50,
    });
    expect(env.data.length).toBeGreaterThan(0);
    // Every returned row is one of the queried kinds.
    for (const e of env.data) {
      expect(RADIO_NETWORK_EVENT_KINDS).toContain(
        e.kind as (typeof RADIO_NETWORK_EVENT_KINDS)[number],
      );
    }
    // Newest-first ordering holds.
    for (let i = 1; i < env.data.length; i++) {
      expect(env.data[i - 1].ts_us).toBeGreaterThanOrEqual(env.data[i].ts_us);
    }
  });

  it("filters out kinds that were not requested", async () => {
    const { MockLoggingService } = await import("@/mock/agent/logging");
    const svc = new MockLoggingService();
    const env = await svc.query<EventsRow>({
      kind: "events",
      event_kind: ["radio.bind_failed"],
    });
    expect(env.data.every((e) => e.kind === "radio.bind_failed")).toBe(true);
  });
});
