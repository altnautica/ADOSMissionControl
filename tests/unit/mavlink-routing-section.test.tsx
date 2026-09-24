/**
 * Tests for the node Settings "MAVLink" page: the endpoint list parsed from
 * the node's own config (absent vs empty as distinct facts), the validated
 * integer writes for router identity, no relay-rate knobs the agent never
 * reads, the read-only FC transport rows, and the signing block reading the
 * agent's own surface —
 * with the honest absences (no LAN client, route not exposed).
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import {
  MavlinkRoutingSection,
  parseEndpoints,
} from "@/components/command/settings/MavlinkRoutingSection";
import { parseBoundedInt } from "@/components/command/settings/ConfigFields";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialConnection = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentConnectionStore.setState(initialConnection, true);
  vi.restoreAllMocks();
});

const CONFIG = {
  mavlink: {
    source: "serial",
    serial_port: "/dev/ttyACM0",
    baud_rate: 115200,
    system_id: 1,
    component_id: 191,
    endpoints: [{ type: "websocket", host: "0.0.0.0", port: 8765, enabled: true }],
  },
};

function stubSigningClient(overrides?: {
  capability?: Record<string, unknown>;
  counters?: Record<string, unknown>;
  failWith?: Error;
}) {
  const client = {
    getSigningCapability: vi.fn(async () => {
      if (overrides?.failWith) throw overrides.failWith;
      return {
        supported: false,
        reason: "fc_not_connected",
        firmware_name: null,
        firmware_version: null,
        signing_params_present: false,
        ...(overrides?.capability ?? {}),
      };
    }),
    // Default: the agent measured signed frames and the last one arrived
    // just now.
    getSigningCounters: vi.fn(async () => ({
      observed: true,
      tx_signed_count: 12,
      rx_signed_count: 7,
      last_signed_rx_at: Date.now() / 1000,
      ...(overrides?.counters ?? {}),
    })),
  };
  useAgentConnectionStore.setState({
    agentUrl: "http://192.168.1.50:8080",
    client: client as never,
    nodeDeviceId: "node-1",
  });
  return { client };
}

function renderSection(profile: "drone" | "ground-station" = "drone") {
  const setValue = vi.fn(async () => {});
  renderWithIntl(
    <MavlinkRoutingSection
      nodeDeviceId="node-1"
      profile={profile}
      config={CONFIG}
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue };
}

describe("parseEndpoints", () => {
  it("distinguishes an absent list from an empty one and reads defensively", () => {
    expect(parseEndpoints(null)).toBeNull();
    expect(parseEndpoints({ mavlink: {} })).toBeNull();
    expect(parseEndpoints({ mavlink: { endpoints: [] } })).toEqual([]);
    expect(
      parseEndpoints({
        mavlink: {
          endpoints: [
            { type: "websocket", host: "0.0.0.0", port: 8765 },
            { port: "not-a-number" },
            null,
          ],
        },
      }),
    ).toEqual([
      { type: "websocket", host: "0.0.0.0", port: 8765, enabled: true },
      { type: null, host: null, port: null, enabled: true },
    ]);
  });
});

describe("parseBoundedInt", () => {
  it("accepts whole numbers in range and rejects the rest", () => {
    expect(parseBoundedInt("42", 1, 255)).toBe(42);
    expect(parseBoundedInt(" 255 ", 1, 255)).toBe(255);
    expect(parseBoundedInt("0", 1, 255)).toBeNull();
    expect(parseBoundedInt("256", 1, 255)).toBeNull();
    expect(parseBoundedInt("-1", 1, 255)).toBeNull();
    expect(parseBoundedInt("1.5", 1, 255)).toBeNull();
    expect(parseBoundedInt("abc", 1, 255)).toBeNull();
    expect(parseBoundedInt("", 1, 255)).toBeNull();
  });
});

describe("MavlinkRoutingSection config surface", () => {
  it("renders the read-only transport rows and the endpoint list", async () => {
    stubSigningClient();
    renderSection();

    expect(screen.getByText("Serial / USB")).toBeTruthy();
    expect(screen.getByText("/dev/ttyACM0")).toBeTruthy();
    expect(screen.getByText("115200")).toBeTruthy();
    expect(screen.getByText("websocket")).toBeTruthy();
    expect(screen.getByText("0.0.0.0:8765 · enabled")).toBeTruthy();
  });

  it("writes a valid system id and refuses an out-of-range one", async () => {
    stubSigningClient();
    const { setValue } = renderSection();

    const sysId = screen.getByLabelText("System ID") as HTMLInputElement;
    expect(sysId.value).toBe("1");

    // Out of range: the Apply button stays disabled and nothing writes.
    fireEvent.change(sysId, { target: { value: "300" } });
    await waitFor(() =>
      expect(
        screen.getByText("Enter a whole number between 1 and 255."),
      ).toBeTruthy(),
    );
    expect(setValue).not.toHaveBeenCalled();

    // In range: the write goes through the shared config writer.
    fireEvent.change(sysId, { target: { value: "42" } });
    const applyButtons = screen.getAllByText("Apply");
    fireEvent.click(applyButtons[0]);
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("mavlink.system_id", "42"),
    );
  });

  it("offers no relay rate knobs, since the agent reads neither key", () => {
    stubSigningClient();
    renderSection();

    // Only the router identity fields write; the relay forwards every frame
    // and heartbeats on a fixed period.
    expect(screen.getAllByText("Apply")).toHaveLength(2);
    expect(screen.queryByLabelText("Telemetry rate (Hz)")).toBeNull();
    expect(screen.queryByLabelText("Heartbeat interval (s)")).toBeNull();
  });
});

describe("MavlinkRoutingSection signing block", () => {
  it("says signing needs the LAN when no client is attached", () => {
    renderSection();
    expect(
      screen.getByText("Signing status needs a LAN connection to the node."),
    ).toBeTruthy();
  });

  it("renders the agent's own capability reason and counters", async () => {
    stubSigningClient({ counters: { last_signed_rx_at: null } });
    renderSection();
    await waitFor(() =>
      expect(screen.getByText("No flight controller connected")).toBeTruthy(),
    );
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    // last_signed_rx_at null reads "none seen", never a fabricated time.
    expect(screen.getByText("None seen")).toBeTruthy();
  });

  it("reads 'not measured' when the agent has no signed-frame observer", async () => {
    // The agent's body when nothing observes signed frames.
    stubSigningClient({
      counters: {
        observed: false,
        tx_signed_count: null,
        rx_signed_count: null,
        last_signed_rx_at: null,
      },
    });
    renderSection();
    await waitFor(() =>
      expect(screen.getByText("No flight controller connected")).toBeTruthy(),
    );
    expect(screen.getByText("Not measured")).toBeTruthy();
    expect(screen.queryByText("null")).toBeNull();
  });

  it("does not read an older agent's hard-coded zero counters as measured", async () => {
    stubSigningClient({
      counters: {
        observed: undefined,
        tx_signed_count: 0,
        rx_signed_count: 0,
        last_signed_rx_at: null,
      },
    });
    renderSection();
    await waitFor(() => expect(screen.getByText("Not measured")).toBeTruthy());
    expect(screen.queryByText("0")).toBeNull();
  });

  it("never reads signing through another node's connection", async () => {
    const { client } = stubSigningClient();
    useAgentConnectionStore.setState({ nodeDeviceId: "other-node" });
    renderSection();
    expect(
      screen.getByText("Signing status needs a LAN connection to the node."),
    ).toBeTruthy();
    expect(client.getSigningCapability).not.toHaveBeenCalled();
  });

  it("reads 'not exposed' on an agent build without the routes", async () => {
    stubSigningClient({ failWith: new Error("Agent API 404: Not Found") });
    renderSection();
    await waitFor(() =>
      expect(screen.getByText("Not exposed by this agent version.")).toBeTruthy(),
    );
  });

  it("omits the signing and transport blocks on a non-drone profile", () => {
    stubSigningClient();
    renderSection("ground-station");
    expect(screen.queryByText("Message signing")).toBeNull();
    expect(screen.queryByText("Flight controller transport")).toBeNull();
    // The endpoint + identity + rate surfaces still render.
    expect(screen.getByText("Configured endpoints")).toBeTruthy();
    expect(screen.getByText("Router identity")).toBeTruthy();
  });
});
