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
  summarizeRadioNetworkEvent,
  mapRadioNetworkEvents,
} from "@/lib/agent/radio-network-events";
import type { EventsRow } from "@/lib/agent/agent-client/logging";
import { useRadioNetworkHealthStore } from "../radio-network-health-store";
import { useAgentConnectionStore } from "../agent-connection-store";

function row(
  kind: string,
  data: Record<string, unknown>,
  tsUs = 1_000_000,
): EventsRow {
  return { ts: new Date(tsUs / 1000).toISOString(), ts_us: tsUs, kind, data };
}

describe("summarizeRadioNetworkEvent", () => {
  it("formats a reg re-pin with both countries and no leading em dash", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "radio.reg_reasserted",
      { from_country: "BO", to_country: "US", channel_permitted: true },
    );
    expect(summary).toBe("Regulatory domain re-pinned BO to US");
    expect(summary).not.toContain("—");
    expect(severity).toBe("success");
  });

  it("warns when a reg re-pin lands on a non-permitted channel", () => {
    const { severity } = summarizeRadioNetworkEvent("radio.reg_reasserted", {
      from_country: "BO",
      to_country: "US",
      channel_permitted: false,
    });
    expect(severity).toBe("warning");
  });

  it("maps a blocked reg-gate verdict to a warning", () => {
    const { summary, severity } = summarizeRadioNetworkEvent("radio.reg_gate", {
      result: "blocked",
      reason: "channel not permitted",
    });
    expect(summary).toBe("Reg-gate blocked: channel not permitted");
    expect(severity).toBe("warning");
  });

  it("maps an allowed reg-gate verdict to success", () => {
    const { severity } = summarizeRadioNetworkEvent("radio.reg_gate", {
      result: "allowed",
    });
    expect(severity).toBe("success");
  });

  it("maps a successful bind to success", () => {
    const { summary, severity } = summarizeRadioNetworkEvent("radio.bind", {});
    expect(summary).toBe("Bind succeeded");
    expect(severity).toBe("success");
  });

  it("maps every bind_failed reason enum to a readable error line", () => {
    const cases: Array<[string, string]> = [
      ["no_tx_key", "no transmit key"],
      ["reg_blocked", "regulatory domain blocked"],
      ["no_peer", "peer not found"],
      ["no_peer_proof", "no verified peer (phantom pairing)"],
      ["stale_key", "stale key, none transferred"],
      ["timeout", "bind timeout"],
      ["interrupted", "bind interrupted"],
      ["other", "unknown error"],
    ];
    for (const [reason, text] of cases) {
      const { summary, severity } = summarizeRadioNetworkEvent(
        "radio.bind_failed",
        { reason },
      );
      expect(summary).toBe(`Bind failed: ${text}`);
      expect(severity).toBe("error");
    }
    // Neither new reason falls through to the generic line.
    for (const reason of ["no_peer_proof", "stale_key"]) {
      const { summary } = summarizeRadioNetworkEvent("radio.bind_failed", {
        reason,
      });
      expect(summary).not.toBe("Bind failed: unknown error");
    }
  });

  it("falls back to a generic line for an unknown bind_failed reason", () => {
    const { summary } = summarizeRadioNetworkEvent("radio.bind_failed", {
      reason: "brand_new_token",
    });
    expect(summary).toBe("Bind failed: unknown error");
  });

  it("flags an rf_unverified entry as an error with the USB speed", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "radio.rf_unverified",
      { state: "entry", usb_speed_mbps: 480 },
    );
    expect(summary).toBe("Link unverified: TX active, no reception (USB 480 Mbps)");
    expect(severity).toBe("error");
  });

  it("treats an rf_unverified clear as recovery", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "radio.rf_unverified",
      { state: "clear" },
    );
    expect(summary).toBe("Link verified: reception confirmed");
    expect(severity).toBe("success");
  });

  it("summarizes a WiFi self-heal with the failure count", () => {
    const { summary, severity } = summarizeRadioNetworkEvent(
      "network.wifi_reassociated",
      { consecutive_failures: 2 },
    );
    expect(summary).toBe(
      "Onboard WiFi re-associated (gateway unreachable x2)",
    );
    expect(severity).toBe("warning");
  });

  it("falls back to the raw kind for an unknown event", () => {
    const { summary } = summarizeRadioNetworkEvent("radio.future_kind", {});
    expect(summary).toBe("radio.future_kind");
  });
});

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
    useAgentConnectionStore.setState({ client: null });
  });

  it("queries the durable store with the radio/network event kinds", async () => {
    const queryMock = vi.fn().mockResolvedValue({
      data: [
        row(
          "radio.reg_reasserted",
          { from_country: "BO", to_country: "US", channel_permitted: true },
          1_000,
        ),
        row("radio.bind_failed", { reason: "no_peer" }, 2_000),
      ],
      page: { next_cursor: null, count: 2 },
      meta: { source: "logd", v: 1, ts: "now", db_lag_ms: 0 },
    });
    // The store reaches the logging client through the connection store.
    useAgentConnectionStore.setState({
      client: { logging: { query: queryMock } } as never,
    });

    await useRadioNetworkHealthStore.getState().loadEvents();

    expect(queryMock).toHaveBeenCalledTimes(1);
    const params = queryMock.mock.calls[0][0];
    expect(params.kind).toBe("events");
    expect(params.event_kind).toEqual([...RADIO_NETWORK_EVENT_KINDS]);

    const state = useRadioNetworkHealthStore.getState();
    expect(state.available).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.recentEvents).toHaveLength(2);
    // Newest (bind_failed at 2_000us) is first.
    expect(state.recentEvents[0].kind).toBe("radio.bind_failed");
    expect(state.recentEvents[0].severity).toBe("error");
  });

  it("degrades gracefully when there is no logging surface (older agent)", async () => {
    useAgentConnectionStore.setState({ client: { logging: undefined } as never });
    await useRadioNetworkHealthStore.getState().loadEvents();
    const state = useRadioNetworkHealthStore.getState();
    expect(state.available).toBe(false);
    expect(state.recentEvents).toHaveLength(0);
    expect(state.loading).toBe(false);
  });

  it("degrades gracefully (no crash) when the store query throws", async () => {
    const queryMock = vi
      .fn()
      .mockRejectedValue(new Error("logd unavailable: no tier answered"));
    useAgentConnectionStore.setState({
      client: { logging: { query: queryMock } } as never,
    });

    await expect(
      useRadioNetworkHealthStore.getState().loadEvents(),
    ).resolves.toBeUndefined();

    const state = useRadioNetworkHealthStore.getState();
    expect(state.available).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toContain("logd unavailable");
  });

  it("clear() resets the feed and availability", async () => {
    useAgentConnectionStore.setState({
      client: {
        logging: {
          query: vi.fn().mockResolvedValue({
            data: [row("radio.bind", {})],
            page: { next_cursor: null, count: 1 },
            meta: { source: "logd", v: 1, ts: "now", db_lag_ms: 0 },
          }),
        },
      } as never,
    });
    await useRadioNetworkHealthStore.getState().loadEvents();
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
