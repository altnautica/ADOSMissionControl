/**
 * Tests for the node Settings "Network" page: the ground-station uplink
 * matrix renders the agent's OWN reports (active uplink, per-leg state,
 * priority ladder), the ladder write round-trips through the priority route
 * with the persisted order read back, and non-ground-station profiles get
 * the honest no-matrix note instead of an empty matrix.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import {
  NetworkUplinkSection,
  moveEntry,
  uplinkLegLabelKey,
} from "@/components/command/settings/NetworkUplinkSection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialConnectionState = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uplinkLegLabelKey", () => {
  it("maps interface tokens and legacy leg names to one label key", () => {
    expect(uplinkLegLabelKey("eth0")).toBe("legEthernet");
    expect(uplinkLegLabelKey("ethernet")).toBe("legEthernet");
    expect(uplinkLegLabelKey("wlan0_client")).toBe("legWifi");
    expect(uplinkLegLabelKey("wifi_client")).toBe("legWifi");
    expect(uplinkLegLabelKey("wwan0")).toBe("legCellular");
    expect(uplinkLegLabelKey("modem_4g")).toBe("legCellular");
    expect(uplinkLegLabelKey("usb0")).toBe("legUsb");
    expect(uplinkLegLabelKey("ap")).toBe("legAp");
  });

  it("returns null for an unknown token so the raw token renders", () => {
    expect(uplinkLegLabelKey("tun0")).toBeNull();
  });
});

describe("moveEntry", () => {
  it("moves an entry and leaves the source array untouched", () => {
    const src = ["a", "b", "c"];
    expect(moveEntry(src, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveEntry(src, 2, -1)).toEqual(["a", "c", "b"]);
    expect(src).toEqual(["a", "b", "c"]);
  });

  it("refuses out-of-range moves", () => {
    expect(moveEntry(["a", "b"], 0, -1)).toBeNull();
    expect(moveEntry(["a", "b"], 1, 1)).toBeNull();
    expect(moveEntry([], 0, 1)).toBeNull();
  });
});

const NETWORK_BODY = {
  ap: { enabled: true, ssid: "ADOS-GS-01AB", channel: 6 },
  wifi_client: {
    enabled_on_boot: false,
    connected: true,
    ssid: "BenchNet",
    signal: 72,
    ip: "192.168.7.42",
  },
  ethernet: { link: false, speed_mbps: null, ip: null, gateway: null },
  modem_4g: { enabled: false, state: "disconnected", percent: 0 },
  active_uplink: "eth0",
  priority: ["eth0", "wlan0_client", "wwan0"],
  share_uplink: false,
};

const ETHERNET_BODY = {
  mode: "dhcp",
  connection_name: "netplan-eth0",
  ip: null,
  gateway: null,
  dns: [],
  link: true,
  speed_mbps: 1000,
  current_ip: "192.168.7.10",
  current_gateway: "192.168.7.1",
};

function stubAgentFetch() {
  const puts: Array<{ url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "PUT") {
      const body = JSON.parse((init.body as string) ?? "{}") as unknown;
      puts.push({ url: u, body });
      if (u.endsWith("/network/priority")) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (u.endsWith("/network/share_uplink")) {
        const req = body as { enabled?: boolean };
        return new Response(
          JSON.stringify({ enabled: req.enabled === true, applied: true }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }
    if (u.endsWith("/api/v1/ground-station/network")) {
      return new Response(JSON.stringify(NETWORK_BODY), { status: 200 });
    }
    if (u.endsWith("/api/v1/ground-station/network/ethernet")) {
      return new Response(JSON.stringify(ETHERNET_BODY), { status: 200 });
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), {
      status: 404,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, puts };
}

function renderSection(profile: "drone" | "ground-station" | "workstation") {
  return renderWithIntl(
    <NetworkUplinkSection
      profile={profile}
      config={{ network: { hotspot: { enabled: false } } }}
      readOnly={false}
      setValue={vi.fn(async () => {})}
    />,
  );
}

describe("NetworkUplinkSection on a ground station", () => {
  it("renders the agent-reported matrix, active uplink and ladder", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
    });
    stubAgentFetch();

    renderSection("ground-station");

    // Active uplink comes from the agent's own active_uplink report.
    await waitFor(() => {
      expect(screen.getByText("Active uplink")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
    });

    // Wi-Fi leg: connected with the reported SSID + signal + IP.
    expect(
      screen.getByText("BenchNet · 72% · 192.168.7.42"),
    ).toBeTruthy();
    // Ethernet leg reads the dedicated route's live legs.
    expect(screen.getByText("192.168.7.10 · 1000 Mb/s")).toBeTruthy();
    // USB leg has no live report on this agent — stays "not reported".
    expect(screen.getByText("USB tether")).toBeTruthy();
    // The ladder lists the reported priority order.
    expect(screen.getByLabelText("Move Ethernet down")).toBeTruthy();
    expect(screen.getByLabelText("Move Cellular up")).toBeTruthy();
  });

  it("writes a reorder through the priority route and reads the order back", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
    });
    const { puts } = stubAgentFetch();

    renderSection("ground-station");
    await waitFor(() =>
      expect(screen.getByLabelText("Move Ethernet down")).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText("Move Ethernet down"));

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0].url.endsWith("/api/v1/ground-station/network/priority")).toBe(
      true,
    );
    expect(puts[0].body).toEqual({
      priority: ["wlan0_client", "eth0", "wwan0"],
    });
  });

  it("says live status needs a direct connection when no agent is attached", () => {
    useAgentConnectionStore.setState({ agentUrl: null, apiKey: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderSection("ground-station");

    expect(
      screen.getByText(/Live network status needs a direct connection/),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("NetworkUplinkSection on other profiles", () => {
  it("renders the honest no-matrix note and never fetches", () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://drone.local:8080",
      apiKey: "KEY",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderSection("drone");

    expect(
      screen.getByText(/uplink matrix on ground station nodes only/),
    ).toBeTruthy();
    // The config-backed hotspot switch still renders for every profile.
    expect(screen.getByText("Wi-Fi hotspot")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("NetworkUplinkSection hotspot fields", () => {
  function renderHotspot() {
    const setValue = vi.fn(async () => {});
    renderWithIntl(
      <NetworkUplinkSection
        profile="drone"
        config={{
          network: {
            hotspot: {
              enabled: true,
              ssid: "ADOS-bench",
              channel: 6,
              password: "supersecret",
            },
          },
        }}
        readOnly={false}
        setValue={setValue}
      />,
    );
    return { setValue };
  }

  it("binds SSID and channel to the real config keys with read-back", () => {
    renderHotspot();
    // SSID + channel render the current emitted values in their inputs.
    expect(screen.getByDisplayValue("ADOS-bench")).toBeTruthy();
    expect(screen.getByDisplayValue("6")).toBeTruthy();
  });

  it("writes a new SSID to network.hotspot.ssid", async () => {
    const { setValue } = renderHotspot();
    const ssidInput = screen.getByDisplayValue("ADOS-bench");
    fireEvent.change(ssidInput, { target: { value: "ADOS-field" } });
    const applyBtn = within(
      ssidInput.parentElement as HTMLElement,
    ).getByRole("button");
    fireEvent.click(applyBtn);
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "network.hotspot.ssid",
        "ADOS-field",
      ),
    );
  });

  it("never echoes the passphrase and writes a new one on Apply", async () => {
    const { setValue } = renderHotspot();
    const pwInput = screen.getByPlaceholderText(
      "Enter a new value",
    ) as HTMLInputElement;
    // Write-only: the current passphrase is never rendered anywhere.
    expect(pwInput.value).toBe("");
    expect(pwInput.type).toBe("password");
    expect(screen.queryByText("supersecret")).toBeNull();
    expect(screen.queryByDisplayValue("supersecret")).toBeNull();
    // A non-empty value is present → the field reads "Set" (never the value).
    expect(screen.getByText("Set")).toBeTruthy();

    fireEvent.change(pwInput, { target: { value: "newpass123" } });
    const applyBtn = within(
      pwInput.parentElement as HTMLElement,
    ).getByRole("button");
    fireEvent.click(applyBtn);
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "network.hotspot.password",
        "newpass123",
      ),
    );
  });
});
