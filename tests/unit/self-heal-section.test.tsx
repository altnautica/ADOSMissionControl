/**
 * Tests for the node Settings "Self-heal" page: the two exposed config
 * switches writing through the shared writer, the always-on guardian and
 * camera recovery rendered as live status from the node's report (with "not
 * reported" as the honest absence), and the event feed reading the durable
 * store when a LAN client exists — or saying it cannot, instead of an empty
 * list.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import { SelfHealSection } from "@/components/command/settings/SelfHealSection";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const initialCapabilities = useAgentCapabilitiesStore.getState();
const initialConnection = useAgentConnectionStore.getState();

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialCapabilities, true);
  useAgentConnectionStore.setState(initialConnection, true);
  vi.restoreAllMocks();
});

function renderSection() {
  const setValue = vi.fn(async () => {});
  renderWithIntl(
    <SelfHealSection
      config={{
        network: { wifi_selfheal: { enabled: true } },
        video: { usb_recovery: { enabled: true } },
      }}
      readOnly={false}
      setValue={setValue}
    />,
  );
  return { setValue };
}

/** A minimal logging client whose event query answers with the given rows. */
function stubLoggingClient(rows: unknown[]) {
  const query = vi.fn(async () => ({
    data: rows,
    page: { next_cursor: null },
    meta: { source: "logd", v: 1, ts: "now", db_lag_ms: 0 },
  }));
  useAgentConnectionStore.setState({
    client: { logging: { query } } as never,
  });
  return { query };
}

describe("SelfHealSection switches", () => {
  it("writes the exposed protection switches through the shared writer", async () => {
    const { setValue } = renderSection();
    fireEvent.click(screen.getByText("Onboard Wi-Fi self-heal"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "network.wifi_selfheal.enabled",
        "false",
      ),
    );
    fireEvent.click(screen.getByText("Camera USB recovery"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "video.usb_recovery.enabled",
        "false",
      ),
    );
  });
});

describe("SelfHealSection live status", () => {
  it("renders 'not reported' when the node has not reported guardian state", () => {
    renderSection();
    // Guardian + camera recovery both unreported.
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
    // The always-on reconciler renders as status, never a toggle.
    expect(screen.getByText("Always on")).toBeTruthy();
  });

  it("renders the guardian's reported state and repair rung", () => {
    useAgentCapabilitiesStore.setState({
      managementLink: {
        state: "degraded",
        iface: "eth0",
        repairing: true,
        lastRung: "renew_dhcp",
      },
    });
    renderSection();
    expect(screen.getByText("Degraded (no data path)")).toBeTruthy();
    expect(screen.getByText(/renewing DHCP/)).toBeTruthy();
  });

  it("renders the camera recovery episode with the attempt budget", () => {
    useAgentCapabilitiesStore.setState({
      cameraUsbRecovery: {
        state: "rebinding",
        case: null,
        attempts: 2,
        maxAttempts: 3,
        cameraPresent: false,
        expected: true,
      } as never,
    });
    renderSection();
    expect(screen.getByText("Recovering (2/3)")).toBeTruthy();
  });
});

describe("SelfHealSection event feed", () => {
  it("says the store is unreachable when no LAN client exists", () => {
    renderSection();
    expect(
      screen.getByText(/needs the node's on-device log store/),
    ).toBeTruthy();
  });

  it("renders the durable-store events when the client answers", async () => {
    const { query } = stubLoggingClient([
      {
        ts: "2026-07-22T10:00:00Z",
        ts_us: 1_000_000,
        kind: "camera.usb_recovery",
        data: { state: "success" },
      },
      {
        ts: "2026-07-22T10:01:00Z",
        ts_us: 2_000_000,
        kind: "network.link_repair_attempt",
        data: { rung: "bounce_iface", interface: "eth0" },
      },
    ]);
    renderSection();

    await waitFor(() =>
      expect(screen.getByText("Camera USB recovery succeeded")).toBeTruthy(),
    );
    expect(
      screen.getByText("Management-link repair: bouncing interface (eth0)"),
    ).toBeTruthy();
    // The query names the self-heal kinds explicitly.
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "events",
        event_kind: expect.arrayContaining(["camera.usb_recovery"]),
      }),
    );
  });

  it("degrades to the unavailable note when the store query throws", async () => {
    useAgentConnectionStore.setState({
      client: {
        logging: {
          query: vi.fn(async () => {
            throw new Error("logd unavailable");
          }),
        },
      } as never,
    });
    renderSection();
    await waitFor(() =>
      expect(
        screen.getByText(/needs the node's on-device log store/),
      ).toBeTruthy(),
    );
  });
});
