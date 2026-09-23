/**
 * Component tests for FirmwareApPeriphSection. Covers the no-nodes empty
 * state, the demo-mode synthetic node table, the flash button gating, and
 * the post-flash prompts surfaced once the OTA store reaches DONE.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { screen, fireEvent, act } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";

vi.mock("lucide-react", () => {
  const Stub = (name: string) => {
    const Icon = (props: Record<string, unknown>) =>
      <span data-testid={`icon-${name}`} {...props} />;
    Icon.displayName = `Icon-${name}`;
    return Icon;
  };
  return {
    Plug: Stub("Plug"),
    Power: Stub("Power"),
    Send: Stub("Send"),
    RotateCcw: Stub("RotateCcw"),
    HardDrive: Stub("HardDrive"),
    Zap: Stub("Zap"),
    RefreshCw: Stub("RefreshCw"),
    Cpu: Stub("Cpu"),
    ChevronDown: Stub("ChevronDown"),
    ChevronLeft: Stub("ChevronLeft"),
    ChevronRight: Stub("ChevronRight"),
    Activity: Stub("Activity"),
    AlertTriangle: Stub("AlertTriangle"),
    CheckCircle2: Stub("CheckCircle2"),
    Circle: Stub("Circle"),
    Loader2: Stub("Loader2"),
    XCircle: Stub("XCircle"),
    Pause: Stub("Pause"),
    Play: Stub("Play"),
    Trash2: Stub("Trash2"),
    Filter: Stub("Filter"),
    Search: Stub("Search"),
  };
});

// Stub the manifest network calls so listChannels/listBoards/getBoardManifest
// never hit the proxy in tests.
vi.mock("@/lib/protocol/firmware/ap-periph-manifest", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/protocol/firmware/ap-periph-manifest")>(
      "@/lib/protocol/firmware/ap-periph-manifest",
    );
  class StubManifest {
    listChannels = vi.fn().mockResolvedValue(["stable", "beta", "latest"]);
    listBoards = vi.fn().mockResolvedValue(["MatekL431-GPS", "f303-GPS"]);
    getBoardManifest = vi.fn().mockResolvedValue({
      board: "MatekL431-GPS",
      channel: "stable",
      files: [
        {
          name: "AP_Periph.bin",
          sizeBytes: 80_000,
          url: "https://firmware.ardupilot.org/AP_Periph/stable/MatekL431-GPS/AP_Periph.bin",
          kind: "app",
        },
      ],
      version: "1.7.0",
      gitCommit: null,
      dateLabel: null,
    });
    downloadFirmware = vi.fn();
    clearCache = vi.fn().mockResolvedValue(undefined);
  }
  return {
    ...actual,
    ApPeriphManifest: StubManifest,
  };
});

import { FirmwareApPeriphSection } from "@/components/fc/firmware/FirmwareApPeriphSection";
import { useDroneCanFlashStore } from "@/stores/dronecan/flash-store";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

describe("FirmwareApPeriphSection", () => {
  beforeEach(() => {
    useDroneCanFlashStore.getState().reset();
    useDroneCanNodeStore.getState().clear();
    useAgentCapabilitiesStore.setState({ canBuses: undefined } as never);
    // Clear demo flag.
    delete (globalThis as Record<string, unknown>).__demoMode;
    if (typeof window !== "undefined") {
      useSettingsStore.setState({ demoMode: false });
    }
  });

  afterEach(() => {
    useDroneCanFlashStore.getState().reset();
    useDroneCanNodeStore.getState().clear();
    useAgentCapabilitiesStore.setState({ canBuses: undefined } as never);
  });

  it("shows the no-nodes empty state when the bus is empty and demo mode is off", () => {
    renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={false}
        isFlashing={false}
        onFlash={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No DroneCAN nodes detected/i),
    ).toBeDefined();
  });

  it("renders the three synthetic node rows in demo mode", () => {
    // Activate demo mode via URL param (matches isDemoMode() probe).
    useSettingsStore.setState({ demoMode: true });

    renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={false}
        isFlashing={false}
        onFlash={vi.fn()}
      />,
    );

    expect(screen.getByText("MatekL431-GPS")).toBeDefined();
    expect(screen.getByText("MatekL431-Airspeed")).toBeDefined();
    expect(screen.getByText("f303-MatekGPS")).toBeDefined();
  });

  it("disables the flash button until checklist, node, and firmware are selected", () => {
    useSettingsStore.setState({ demoMode: true });

    const onFlash = vi.fn();
    const { rerender } = renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={false}
        isFlashing={false}
        onFlash={onFlash}
      />,
    );

    const button = screen.getByRole("button", { name: /Flash node/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onFlash).not.toHaveBeenCalled();

    // Re-render with the checklist passed AND a node selected; the manifest
    // load is async via the stubbed client but kicks off on mount.
    rerender(
      <FirmwareApPeriphSection
        checklistAllChecked={true}
        isFlashing={false}
        onFlash={onFlash}
      />,
    );
    // Without picking a node the button stays disabled.
    expect((screen.getByRole("button", { name: /Flash node/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces the post-flash prompts once the OTA store hits DONE", () => {
    useSettingsStore.setState({ demoMode: true });

    renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={true}
        isFlashing={false}
        onFlash={vi.fn()}
      />,
    );

    // No prompts before flash completes.
    expect(screen.queryByTestId("ap-periph-post-flash")).toBeNull();

    // Pick the first demo node so selectedNodeId is set.
    act(() => {
      const firstRow = screen.getByText("MatekL431-GPS").closest("tr");
      if (firstRow) fireEvent.click(firstRow);
    });

    // Drive the OTA store to DONE.
    act(() => {
      useDroneCanFlashStore.getState().setSnapshot({
        state: "DONE",
        percent: 100,
        bytesSent: 80_000,
        bytesTotal: 80_000,
        lastOffset: 80_000,
        lastChunkLen: 256,
        retries: 0,
        timeouts: 0,
        errorMessage: undefined,
        transitionLog: [],
        rpcTrace: [],
      });
    });

    expect(screen.getByTestId("ap-periph-post-flash")).toBeDefined();
    expect(screen.getByText(/FLASH_BOOTLOADER=1/i)).toBeDefined();
    expect(screen.getByText(/Change node ID/i)).toBeDefined();
  });

  it("disables the CAN_FORWARD radio when the agent has not advertised any CAN buses yet", () => {
    // canBuses is `undefined` from beforeEach — the agent capability
    // heartbeat hasn't populated, so CAN_FORWARD stays unreachable.
    renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={false}
        isFlashing={false}
        onFlash={vi.fn()}
      />,
    );
    const canForwardRadio = screen.getByRole("radio", { name: /CAN_FORWARD/i }) as HTMLButtonElement;
    expect(canForwardRadio.disabled).toBe(true);
  });

  it("enables the CAN_FORWARD radio once the agent advertises at least one CAN bus", () => {
    useAgentCapabilitiesStore.setState({
      canBuses: [{ port: 1, bitrate: 1_000_000, driver: "dronecan", nodeId: 10 }],
    } as never);

    renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={false}
        isFlashing={false}
        onFlash={vi.fn()}
      />,
    );

    const canForwardRadio = screen.getByRole("radio", { name: /CAN_FORWARD/i }) as HTMLButtonElement;
    expect(canForwardRadio.disabled).toBe(false);
  });

  it("enables the CAN_FORWARD radio in demo mode even without an agent capability payload", () => {
    useSettingsStore.setState({ demoMode: true });

    renderWithIntl(
      <FirmwareApPeriphSection
        checklistAllChecked={false}
        isFlashing={false}
        onFlash={vi.fn()}
      />,
    );

    const canForwardRadio = screen.getByRole("radio", { name: /CAN_FORWARD/i }) as HTMLButtonElement;
    expect(canForwardRadio.disabled).toBe(false);
  });
});
