/**
 * Tests for the node Settings "Discovery" page: the config-backed mDNS
 * announcement switch, and the reach names + URLs rendered verbatim from the
 * node's own setup report — with the honest LAN requirement and failure
 * states, and never a constructed hostname.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { DiscoverySection } from "@/components/command/settings/DiscoverySection";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialConnection = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentConnectionStore.setState(initialConnection, true);
  vi.restoreAllMocks();
});

const CONFIG = {
  discovery: { mdns_enabled: true, service_type: "_ados._tcp.local." },
};

function renderSection(config: Record<string, unknown> | null = CONFIG) {
  const setValue = vi.fn(async () => {});
  renderWithIntl(
    <DiscoverySection config={config} readOnly={false} setValue={setValue} />,
  );
  return { setValue };
}

/** A minimal setup report carrying only the fields this page renders. */
function reportWith(overrides: Record<string, unknown> = {}) {
  return {
    network: {
      hostname: "benchnode",
      mdns_host: "benchnode.local",
      api_port: 8080,
      hotspot_enabled: false,
      hotspot_ssid: "",
      local_ips: ["192.168.1.50"],
    },
    access_urls: [
      {
        kind: "api",
        label: "Node console",
        url: "http://192.168.1.50:8080",
        source: "local",
        primary: true,
      },
      {
        kind: "video",
        label: "Live video",
        url: "http://192.168.1.50:8889/main/whep",
        source: "local",
        primary: false,
      },
    ],
    ...overrides,
  };
}

describe("DiscoverySection config switch", () => {
  it("writes the mDNS announcement flag through the shared config writer", async () => {
    const { setValue } = renderSection();
    fireEvent.click(screen.getByText("Announce over mDNS"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith("discovery.mdns_enabled", "false"),
    );
  });

  it("shows the configured service type verbatim", () => {
    renderSection();
    expect(screen.getByText("_ados._tcp.local.")).toBeTruthy();
  });
});

describe("DiscoverySection advertised reach", () => {
  it("states the LAN requirement when no client is attached", () => {
    renderSection();
    expect(
      screen.getByText(/can only be read over the node's LAN connection/),
    ).toBeTruthy();
  });

  it("renders the node-reported names and URLs verbatim", async () => {
    useAgentConnectionStore.setState({
      client: { getSetupStatus: vi.fn(async () => reportWith()) },
    } as never);

    renderSection();

    await waitFor(() => expect(screen.getByText("benchnode")).toBeTruthy());
    expect(screen.getByText("benchnode.local")).toBeTruthy();
    expect(screen.getByText("192.168.1.50")).toBeTruthy();
    expect(screen.getByText("http://192.168.1.50:8080")).toBeTruthy();
    expect(
      screen.getByText("http://192.168.1.50:8889/main/whep"),
    ).toBeTruthy();
    // The agent's own labels, plus the primary marker.
    expect(screen.getByText("Node console")).toBeTruthy();
    expect(screen.getByText("primary")).toBeTruthy();
  });

  it("reads 'not reported' for an empty advertised name, never a guess", async () => {
    useAgentConnectionStore.setState({
      client: {
        getSetupStatus: vi.fn(async () =>
          reportWith({
            network: {
              hostname: "benchnode",
              mdns_host: "",
              api_port: 8080,
              hotspot_enabled: false,
              hotspot_ssid: "",
              local_ips: [],
            },
            access_urls: [],
          }),
        ),
      },
    } as never);

    renderSection();

    await waitFor(() => expect(screen.getByText("benchnode")).toBeTruthy());
    // Empty mDNS name + empty IP list read "not reported" — no synthesized
    // `.local` name ever appears.
    expect(screen.getAllByText("not reported").length).toBe(2);
    expect(screen.queryByText(/benchnode\.local/)).toBeNull();
    expect(screen.getByText("The node reports no reachable URLs.")).toBeTruthy();
  });

  it("says the read failed instead of showing stale names", async () => {
    useAgentConnectionStore.setState({
      client: { getSetupStatus: vi.fn(async () => Promise.reject(new Error("down"))) },
    } as never);

    renderSection();

    await waitFor(() =>
      expect(
        screen.getByText("Could not read the node's advertised names."),
      ).toBeTruthy(),
    );
  });
});
