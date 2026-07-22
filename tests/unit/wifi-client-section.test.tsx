/**
 * Tests for the node Settings "Wi-Fi" page: the honest no-transport note,
 * the agent-reported connection state, the scan → pick → join flow (with the
 * passphrase sent write-only and cleared after a join), and the honest
 * "scanning not exposed" message on an agent build without the scan route.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { WifiClientSection } from "@/components/command/settings/WifiClientSection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialConnectionState = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function connectAgent() {
  useAgentConnectionStore.setState({
    agentUrl: "http://node.local:8080",
    apiKey: "KEY",
  });
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function stubRoutes(overrides?: {
  status?: unknown;
  scanStatus?: number;
  scanBody?: unknown;
}) {
  const calls: Call[] = [];
  const status = overrides?.status ?? {
    connected: true,
    ssid: "BenchNet",
    signal: 72,
    ip: "192.168.7.42",
    security: "WPA2",
  };
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({
      url: u,
      method,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    if (u.endsWith("/api/v1/network/client/status")) {
      return new Response(JSON.stringify(status), { status: 200 });
    }
    if (u.endsWith("/api/v1/network/client/configured")) {
      return new Response(JSON.stringify({ connections: [] }), { status: 200 });
    }
    if (u.endsWith("/api/v1/network/client/scan")) {
      return new Response(
        JSON.stringify(
          overrides?.scanBody ?? {
            networks: [
              { ssid: "FieldNet", bssid: "aa", signal: 61, security: "WPA2" },
            ],
          },
        ),
        { status: overrides?.scanStatus ?? 200 },
      );
    }
    if (u.endsWith("/api/v1/network/client/join") && method === "PUT") {
      return new Response(
        JSON.stringify({ joined: true, ip: "10.0.0.9", gateway: "10.0.0.1" }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("WifiClientSection without a transport", () => {
  it("renders the honest no-connection-path note and never fetches", () => {
    useAgentConnectionStore.setState({ agentUrl: null, apiKey: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderWithIntl(<WifiClientSection />);

    expect(
      screen.getByText(/Live network status needs a direct connection/),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WifiClientSection with an agent attached", () => {
  it("renders the agent-reported connection", async () => {
    connectAgent();
    stubRoutes();

    renderWithIntl(<WifiClientSection />);

    await waitFor(() => expect(screen.getByText("BenchNet")).toBeTruthy());
    expect(screen.getByText("72%")).toBeTruthy();
    expect(screen.getByText("192.168.7.42")).toBeTruthy();
    expect(screen.getByText("Disconnect")).toBeTruthy();
  });

  it("reports no connection honestly when the agent says so", async () => {
    connectAgent();
    stubRoutes({ status: { connected: false } });

    renderWithIntl(<WifiClientSection />);

    await waitFor(() =>
      expect(
        screen.getByText("The node's agent reports no Wi-Fi connection."),
      ).toBeTruthy(),
    );
  });

  it("scans, picks a network into the form, joins, and clears the passphrase", async () => {
    connectAgent();
    const { calls } = stubRoutes();

    renderWithIntl(<WifiClientSection />);
    await waitFor(() => expect(screen.getByText("BenchNet")).toBeTruthy());

    fireEvent.click(screen.getByText("Scan for networks"));
    await waitFor(() =>
      expect(screen.getByLabelText("Use FieldNet")).toBeTruthy(),
    );

    fireEvent.click(screen.getByLabelText("Use FieldNet"));
    const ssidInput = screen.getByLabelText(
      "Network name (SSID)",
    ) as HTMLInputElement;
    expect(ssidInput.value).toBe("FieldNet");

    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.type).toBe("password");
    fireEvent.change(password, { target: { value: "hunter22" } });
    fireEvent.click(screen.getByText("Join"));

    await waitFor(() => {
      const join = calls.find((c) => c.url.endsWith("/client/join"));
      expect(join).toBeTruthy();
      expect(join?.body).toEqual({ ssid: "FieldNet", passphrase: "hunter22" });
    });
    // Write-only secret: cleared locally once the node has it.
    await waitFor(() => expect(password.value).toBe(""));
  });

  it("says scanning is not exposed on an agent build without the route", async () => {
    connectAgent();
    stubRoutes({ scanStatus: 404, scanBody: { detail: "Not Found" } });

    renderWithIntl(<WifiClientSection />);
    await waitFor(() => expect(screen.getByText("BenchNet")).toBeTruthy());

    fireEvent.click(screen.getByText("Scan for networks"));
    await waitFor(() =>
      expect(
        screen.getByText(/Scanning is not exposed by this agent version/),
      ).toBeTruthy(),
    );
  });
});
