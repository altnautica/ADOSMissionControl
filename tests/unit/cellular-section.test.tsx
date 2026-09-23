/**
 * Tests for the node Settings "Cellular" page: presence rendered from the
 * node's own modem-status snapshot (with the agent's reasons), the modem
 * view's sentinel connectivity legs and unreported usage excluded rather than
 * shown as facts, a write whose rendered result is the agent's own read-back
 * response, and nothing at all on a profile with no modem manager.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import {
  CellularSection,
  capMbToGbString,
  parseCapGb,
} from "@/components/command/settings/CellularSection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialConnectionState = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cap helpers", () => {
  it("formats a configured cap and rejects invalid input", () => {
    expect(capMbToGbString(2048)).toBe("2");
    expect(capMbToGbString(1536)).toBe("1.5");
    expect(capMbToGbString(0)).toBe("");
    expect(capMbToGbString(null)).toBe("");
    expect(parseCapGb("2")).toBe(2);
    expect(parseCapGb("0")).toBe(0);
    expect(parseCapGb("2.5")).toBe(2.5);
    expect(parseCapGb("")).toBeNull();
    expect(parseCapGb("-1")).toBeNull();
    expect(parseCapGb("abc")).toBeNull();
  });
});

const MODEM_VIEW = {
  enabled: true,
  connected: false,
  iface: "wwan0",
  ip: null,
  // Sentinel connectivity legs (no live modem driving them).
  signal_quality: -1,
  technology: "unknown",
  apn: "internet",
  operator: "",
  data_used_mb: 512,
  cap_mb: 2048,
  percent: 25.0,
  state: "disconnected",
};

function stubGsFetch(overrides?: {
  present?: boolean | null;
  reason?: string;
  view?: Partial<Record<keyof typeof MODEM_VIEW, unknown>>;
}) {
  const puts: Array<{ url: string; body: unknown }> = [];
  let view = { ...MODEM_VIEW, ...overrides?.view };
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/v1/ground-station/network/modem")) {
      if (init?.method === "PUT") {
        const body = JSON.parse((init.body as string) ?? "{}") as {
          apn?: string;
          cap_gb?: number;
          enabled?: boolean;
        };
        puts.push({ url: u, body });
        // The agent replies with the view over the freshly-persisted config.
        view = {
          ...view,
          ...(body.apn !== undefined ? { apn: body.apn } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.cap_gb !== undefined ? { cap_mb: body.cap_gb * 1024 } : {}),
        };
      }
      return new Response(JSON.stringify(view), { status: 200 });
    }
    if (u.endsWith("/api/v1/ground-station/modem-status")) {
      return new Response(
        JSON.stringify({
          present: overrides?.present === undefined ? false : overrides.present,
          reason: overrides?.reason ?? "no_modem",
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { puts };
}

function renderSection(profile: "drone" | "ground-station") {
  return renderWithIntl(
    <CellularSection nodeDeviceId="node-1" profile={profile} readOnly={false} />,
  );
}

describe("CellularSection on a ground station", () => {
  it("renders presence from the node's own snapshot and hides sentinel legs", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    stubGsFetch({ present: false, reason: "no_modem" });

    renderSection("ground-station");

    await waitFor(() =>
      expect(screen.getByText("No modem detected")).toBeTruthy(),
    );
    // The reported state string renders as-is.
    expect(screen.getByText("disconnected")).toBeTruthy();
    // Sentinel legs (signal -1, technology "unknown", empty operator) are
    // excluded, not rendered as facts.
    expect(screen.queryByText("-1%")).toBeNull();
    expect(screen.queryByText("Technology")).toBeNull();
    expect(screen.queryByText("Operator")).toBeNull();
    // Config + usage legs are real.
    const apn = screen.getByLabelText("APN") as HTMLInputElement;
    expect(apn.value).toBe("internet");
    const cap = screen.getByLabelText("Data cap (GB)") as HTMLInputElement;
    expect(cap.value).toBe("2");
  });

  it("names the missing ModemManager reason", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    stubGsFetch({ present: false, reason: "modemmanager_not_installed" });

    renderSection("ground-station");

    await waitFor(() =>
      expect(
        screen.getByText("ModemManager is not installed on this node"),
      ).toBeTruthy(),
    );
  });

  it("renders an unprobed modem as not reported, never as no modem", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    stubGsFetch({ present: null, reason: "not_probed" });

    renderSection("ground-station");

    await waitFor(() => expect(screen.getByText("not reported")).toBeTruthy());
    expect(screen.queryByText("No modem detected")).toBeNull();
    expect(screen.queryByText("not_probed")).toBeNull();
  });

  it("renders usage the tracker has not reported as not reported, never 0 MB", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    stubGsFetch({ view: { data_used_mb: null, percent: null } });

    renderSection("ground-station");

    await waitFor(() => expect(screen.getByText("not reported yet")).toBeTruthy());
    expect(screen.queryByText(/0 MB of 2048 MB/)).toBeNull();
  });

  it("writes the APN and renders the agent's read-back response", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    const { puts } = stubGsFetch();

    renderSection("ground-station");
    await waitFor(() =>
      expect((screen.getByLabelText("APN") as HTMLInputElement).value).toBe(
        "internet",
      ),
    );

    const apn = screen.getByLabelText("APN") as HTMLInputElement;
    fireEvent.change(apn, { target: { value: "iot.provider" } });
    const applyButtons = screen.getAllByText("Apply");
    fireEvent.click(applyButtons[0]);

    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0].body).toEqual({ apn: "iot.provider" });
    await waitFor(() => expect(apn.value).toBe("iot.provider"));
  });

  it("rejects an invalid data cap before any write", async () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://gs.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    const { puts } = stubGsFetch();

    renderSection("ground-station");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Data cap (GB)") as HTMLInputElement).value,
      ).toBe("2"),
    );

    const cap = screen.getByLabelText("Data cap (GB)") as HTMLInputElement;
    fireEvent.change(cap, { target: { value: "-3" } });
    await waitFor(() =>
      expect(
        screen.getByText("Enter a number of gigabytes (0 or more)."),
      ).toBeTruthy(),
    );
    const applyButtons = screen.getAllByText("Apply");
    fireEvent.click(applyButtons[1]);
    expect(puts.length).toBe(0);
  });

  it("never reads or writes the modem of a different node that is still attached", async () => {
    // The focused connection still belongs to another ground station while
    // this page renders node-1.
    useAgentConnectionStore.setState({
      agentUrl: "http://gs-other.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "gs-other",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderSection("ground-station");

    expect(
      screen.getByText(/Live network status needs a direct connection/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("APN")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CellularSection on other profiles", () => {
  it("renders nothing and never fetches where no modem manager runs", () => {
    useAgentConnectionStore.setState({
      agentUrl: "http://drone.local:8080",
      apiKey: "KEY",
      nodeDeviceId: "node-1",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderSection("drone");

    expect(container.textContent).toBe("");
    expect(screen.queryByText("Cellular uplink")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
