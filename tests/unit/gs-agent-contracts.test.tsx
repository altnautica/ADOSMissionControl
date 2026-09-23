/**
 * Agent-to-GCS contracts on the ground-station and system surfaces. Each case
 * feeds the body the agent actually sends (ados-control routes) through the
 * GCS reader and checks what the operator is shown or what the store holds.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { normaliseGroundStationStatus } from "@/lib/api/ground-station/status";
import { restartService, restartSupervisor } from "@/lib/agent/agent-client/system";
import { getConfigViaAccess, type ConfigAccess } from "@/lib/agent/config-access";
import { setPrimaryGamepad } from "@/lib/api/ground-station/peripherals";
import { getWfbReceiverCombined, getWfbReceiverRelays, openLocalBind } from "@/lib/api/ground-station/wfb";
import { applyUplinkEvent } from "@/stores/ground-station/uplink-ws";
import { applyPicEvent } from "@/stores/ground-station/pic-actions";
import { CellularSection } from "@/components/hardware/network/CellularSection";
import { CombinedStreamStats } from "@/components/hardware/CombinedStreamStats";
import { useGroundStationStore } from "@/stores/ground-station-store";
import type { UplinkSlice } from "@/stores/ground-station/types";

const CTX = { baseUrl: "http://192.168.1.50:8080", apiKey: "k" };

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The deadline each request armed, in the order they were made. */
function captureDeadlines(): number[] {
  const seen: number[] = [];
  const real = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    seen.push(ms);
    return real(ms);
  });
  return seen;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ground-station status", () => {
  it("reads an unpaired station as unpaired and maps the radio view", () => {
    const status = normaliseGroundStationStatus({
      profile: "ground-station",
      paired_drone: { device_id: null, key_fingerprint: null, fc_mode: null },
      link: { rssi_dbm: -61, bitrate_mbps: 4.1, fec_recovered: 3, fec_lost: 1, channel: 149 },
    });
    expect(status.paired_drone).toBeNull();
    expect(status.profile).toBe("ground_station");
    expect(status.link_health).toEqual({ rssi_dbm: -61, bitrate_mbps: 4.1, fec_rec: 3, fec_lost: 1, channel: 149 });
  });

  it("reads the paired drone's id as a string", () => {
    const status = normaliseGroundStationStatus({
      profile: "ground-station",
      paired_drone: { device_id: "drone-7", key_fingerprint: "ab12" },
      link: {},
    });
    expect(status.paired_drone).toBe("drone-7");
  });
});

describe("service restart", () => {
  it("surfaces the agent's error body, which arrives as HTTP 200", async () => {
    stubFetch({ status: "error", message: "Unknown service: ados-foo" });
    await expect(restartService(CTX, "foo")).rejects.toThrow("Unknown service: ados-foo");
  });

  it("accepts the agent's success body and waits past the restart confirm window", async () => {
    const deadlines = captureDeadlines();
    stubFetch({ status: "ok", message: "restarted", unit: "ados-video", aliased_from: null });
    await expect(restartService(CTX, "video")).resolves.toMatchObject({ status: "ok" });
    expect(deadlines[0]).toBeGreaterThan(35_000);
  });

  it("restarts everything through the supervisor route", async () => {
    const fetchMock = stubFetch({ ok: true, message: "ados-supervisor restart scheduled" });
    await restartSupervisor(CTX);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://192.168.1.50:8080/api/v1/system/restart-supervisor",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("config proxy deadline", () => {
  it("waits past the route's own upstream deadline on both lanes", async () => {
    const deadlines = captureDeadlines();
    stubFetch({ mavlink: {} });
    await getConfigViaAccess({ mode: "proxy", target: { host: "192.168.1.50", apiKey: null } });
    const relay = {
      mode: "relay",
      reach: { baseUrl: "http://192.168.1.60:8080/api/v1/ground-station/relay-proxy/drone-7", apiKey: "k", peerDeviceId: "drone-7" },
    } as unknown as ConfigAccess;
    await getConfigViaAccess(relay);
    // The route waits 12 s on the LAN and 15 s on the relay before answering.
    expect(deadlines[0]).toBeGreaterThan(12_000);
    expect(deadlines[1]).toBeGreaterThan(15_000);
  });
});

describe("cellular modem", () => {
  it("renders a present modem from the agent's modem view", () => {
    render(
      <CellularSection
        modem={{
          enabled: true, apn: "internet", cap_mb: 2048, connected: null, iface: null, ip: null,
          signal_quality: null, technology: null, operator: null, state: null, data_used_mb: 512, percent: 25,
        }}
        onConfigure={() => {}}
      />,
    );
    expect(screen.queryByText(/No modem detected/)).toBeNull();
    expect(screen.getByText("internet")).toBeTruthy();
  });
});

describe("primary gamepad", () => {
  it("sends the key the agent's update requires", async () => {
    const fetchMock = stubFetch({ primary_id: "pad-1", result: null });
    await setPrimaryGamepad(CTX, "pad-1");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ device_id: "pad-1" });
  });
});

describe("distributed receive, stale snapshot", () => {
  it("reads a stale relay list as unknown rather than empty", async () => {
    stubFetch({ relays: null, stale: true });
    await expect(getWfbReceiverRelays(CTX)).resolves.toEqual({ relays: null, stale: true });
  });

  it("renders stale combined counters as not measured instead of crashing", async () => {
    stubFetch({ fragments_after_dedup: null, fec_repaired: null, output_kbps: null, up: null, stale: true });
    const combined = await getWfbReceiverCombined(CTX);
    useGroundStationStore.setState((s) => ({ distributedRx: { ...s.distributedRx, combined } }));
    renderWithIntl(<CombinedStreamStats />);
    expect(screen.getAllByText("--").length).toBe(3);
  });
});

describe("uplink events", () => {
  const base = {
    active: "wifi_client",
    health: "ok",
    failover_log: [],
    data_cap: null,
  } as unknown as UplinkSlice;

  it("derives health and a failover entry from the agent's only frame", () => {
    const next = applyUplinkEvent(
      base,
      {
        kind: "health_changed",
        active_uplink: "modem_4g",
        available: ["modem_4g"],
        internet_reachable: false,
        data_cap_state: null,
        timestamp_ms: 1_000,
      },
      2_000,
    );
    expect(next?.health).toBe("degraded");
    expect(next?.active).toBe("modem_4g");
    expect(next?.failover_log[0]).toMatchObject({ from: "wifi_client", to: "modem_4g", timestamp: 1_000 });
  });
});

describe("pilot-in-command events", () => {
  const idle = {
    state: "claimed",
    claimed_by: "gcs-1",
    claim_counter: 3,
    primary_gamepad_id: null,
    loading: false,
    error: null,
  };

  it("follows a claim by another station and a release", () => {
    const claimed = applyPicEvent(idle, { event: "claimed", client_id: "gcs-2", claim_counter: 4, timestamp_ms: 1 });
    expect(claimed.claimed_by).toBe("gcs-2");
    const released = applyPicEvent(claimed, { event: "released", client_id: "gcs-2", claim_counter: 5, timestamp_ms: 2 });
    expect(released.claimed_by).toBeNull();
    expect(released.state).toBe("unclaimed");
  });

  it("reports the arbiter being unreachable", () => {
    const next = applyPicEvent(idle, { event: "error", code: "E_PIC_BUS_UNAVAILABLE", message: "connection refused" });
    expect(next.error).toBe("connection refused");
  });
});

describe("local radio bind", () => {
  it("waits past the agent's 300 s bind window", async () => {
    const deadlines = captureDeadlines();
    stubFetch({ state: "paired" });
    await openLocalBind(CTX);
    expect(deadlines[0]).toBeGreaterThan(300_000);
  });
});
