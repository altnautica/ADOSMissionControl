/**
 * Component tests for TestUtilitiesSection. Verifies the six sub-cards
 * render, the ping tool drives a client call on success, the conflict
 * scanner reaches the client for every known node, and the ESC sweep
 * button gates execution behind the safety confirm dialog.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import { useDroneStore } from "@/stores/drone-store";

import { TestUtilitiesSection } from "@/components/config/can/TestUtilitiesSection";

interface MockGetNodeInfoResponse {
  status: {
    uptime_sec: number;
    health: number;
    mode: number;
    vendor_specific_status_code: number;
  };
  software_version: {
    major: number;
    minor: number;
    optional_field_flags: number;
    vcs_commit: number;
    image_crc: bigint;
  };
  hardware_version: {
    major: number;
    minor: number;
    unique_id: Uint8Array;
    certificate_of_authenticity: Uint8Array;
  };
  name: string;
}

function buildNodeInfo(uniqueIdByte: number, name = "node"): MockGetNodeInfoResponse {
  const uid = new Uint8Array(16);
  uid[0] = uniqueIdByte;
  return {
    status: { uptime_sec: 1, health: 0, mode: 0, vendor_specific_status_code: 0 },
    software_version: {
      major: 1,
      minor: 0,
      optional_field_flags: 0,
      vcs_commit: 0,
      image_crc: BigInt(0),
    },
    hardware_version: {
      major: 1,
      minor: 0,
      unique_id: uid,
      certificate_of_authenticity: new Uint8Array(),
    },
    name,
  };
}

describe("TestUtilitiesSection", () => {
  beforeEach(() => {
    useDroneCanNodeStore.setState({ nodes: new Map(), _version: 0 } as never);
  });

  afterEach(() => {
    useDroneCanNodeStore.setState({ nodes: new Map(), _version: 0 } as never);
  });

  it("renders all six sub-cards", () => {
    renderWithIntl(<TestUtilitiesSection client={null} transport={null} />);
    expect(screen.getByText(/Node ping/i)).toBeDefined();
    expect(screen.getByText(/Manual frame inject/i)).toBeDefined();
    expect(screen.getByText(/Node-ID conflict scanner/i)).toBeDefined();
    expect(screen.getByText(/ESC RawCommand sweep/i)).toBeDefined();
    expect(screen.getByText(/GPS fix snapshot/i)).toBeDefined();
    expect(screen.getByText(/Compass raw stream/i)).toBeDefined();
  });

  it("disables the ping button until a client is wired", () => {
    renderWithIntl(<TestUtilitiesSection client={null} transport={null} />);
    const pingBtn = screen.getByRole("button", { name: /^Ping$/i }) as HTMLButtonElement;
    expect(pingBtn.disabled).toBe(true);
  });

  it("calls client.getNodeInfo with the entered node id and surfaces the RTT result", async () => {
    const client = {
      getNodeInfo: vi.fn(async () => buildNodeInfo(0xaa, "alpha")),
    };
    renderWithIntl(<TestUtilitiesSection client={client as never} transport={null} />);

    // Scope the input lookup to the Node ping card so we don't collide
    // with the other tools that also expose a "Node ID" label.
    const pingCardTitle = screen.getByText(/^Node ping$/i);
    const pingCard = pingCardTitle.closest("div.bg-bg-secondary") as HTMLElement;
    const nodeInput = within(pingCard).getByLabelText(/Node ID/i) as HTMLInputElement;
    fireEvent.change(nodeInput, { target: { value: "11" } });

    const pingBtn = within(pingCard).getByRole("button", { name: /^Ping$/i });
    fireEvent.click(pingBtn);

    await waitFor(() => {
      expect(client.getNodeInfo).toHaveBeenCalledWith(11, { timeoutMs: 1000 });
    });

    await waitFor(() => {
      expect(screen.getByTestId("ping-result")).toBeDefined();
    });
  });

  it("conflict scanner calls client.getNodeInfo for every known node and surfaces a clean result when uids are distinct per id", async () => {
    const store = useDroneCanNodeStore.getState();
    store.upsertStatus(14, {
      uptime_sec: 10,
      health: 0,
      mode: 0,
      vendor_specific_status_code: 0,
    } as never);
    store.upsertStatus(15, {
      uptime_sec: 10,
      health: 0,
      mode: 0,
      vendor_specific_status_code: 0,
    } as never);

    const client = {
      getNodeInfo: vi.fn(async (id: number) =>
        buildNodeInfo(id === 14 ? 0xaa : 0xbb, `n${id}`),
      ),
      onNodeStatus: vi.fn(() => () => {}),
    };

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithIntl(<TestUtilitiesSection client={client as never} transport={null} />);
      fireEvent.click(screen.getByRole("button", { name: /^Scan$/i }));

      await waitFor(() => {
        expect(client.getNodeInfo).toHaveBeenCalledWith(14, expect.objectContaining({ timeoutMs: 700 }));
        expect(client.getNodeInfo).toHaveBeenCalledWith(15, expect.objectContaining({ timeoutMs: 700 }));
      });
      await vi.advanceTimersByTimeAsync(3_100);

      await waitFor(() => {
        expect(screen.getByTestId("conflict-scan-clean")).toBeDefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gates the ESC sweep button behind the safety confirm dialog", () => {
    const client = {
      getNodeInfo: vi.fn(),
      onNodeStatus: vi.fn(() => () => {}),
      sendEscRawCommand: vi.fn().mockResolvedValue(undefined),
      subscribeFix2: vi.fn().mockReturnValue(() => {}),
      subscribeMag2: vi.fn().mockReturnValue(() => {}),
    };
    renderWithIntl(
      <TestUtilitiesSection client={client} transport={null} />,
    );

    const runBtn = screen.getByTestId("esc-sweep-trigger");
    fireEvent.click(runBtn);

    // Confirm dialog opens with the safety title visible.
    expect(screen.getByText(/Props off, motors-on-bench only/i)).toBeDefined();
  });

  it("disables the ESC sweep trigger while the vehicle is armed", () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" } as never);
    try {
      const client = {
        getNodeInfo: vi.fn(),
        onNodeStatus: vi.fn(() => () => {}),
        sendEscRawCommand: vi.fn().mockResolvedValue(undefined),
        subscribeFix2: vi.fn().mockReturnValue(() => {}),
        subscribeMag2: vi.fn().mockReturnValue(() => {}),
      };
      renderWithIntl(<TestUtilitiesSection client={client} transport={null} />);
      const runBtn = screen.getByTestId("esc-sweep-trigger") as HTMLButtonElement;
      expect(runBtn.disabled).toBe(true);
      expect(screen.getByTestId("esc-sweep-armed")).toBeDefined();
    } finally {
      useDroneStore.setState({ armState: "disarmed", connectionState: "disconnected" } as never);
    }
  });

  it("disables the ESC sweep trigger when no client is wired", () => {
    renderWithIntl(<TestUtilitiesSection client={null} transport={null} />);
    const runBtn = screen.getByTestId("esc-sweep-trigger") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
  });
});
