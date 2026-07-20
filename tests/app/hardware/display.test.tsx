/**
 * @module HardwareDisplayPage.test
 * @description Smoke test for the Display sub-view: composes the local
 * display, HDMI kiosk, preview, remote control, theme, camera, and
 * recording cards.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(async () => {
      store.clear();
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
    entries: vi.fn(async () => Array.from(store.entries())),
  };
});

vi.mock("lucide-react", () => {
  function makeStub(name: string) {
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    }
    StubIcon.displayName = `StubIcon(${name})`;
    return StubIcon;
  }
  return {
    __esModule: true,
    Monitor: makeStub("Monitor"),
    MonitorPlay: makeStub("MonitorPlay"),
    LayoutDashboard: makeStub("LayoutDashboard"),
    Video: makeStub("Video"),
    Settings: makeStub("Settings"),
    MoreHorizontal: makeStub("MoreHorizontal"),
    Sun: makeStub("Sun"),
    Moon: makeStub("Moon"),
    RefreshCw: makeStub("RefreshCw"),
    Loader2: makeStub("Loader2"),
    ImageOff: makeStub("ImageOff"),
    X: makeStub("X"),
    Camera: makeStub("Camera"),
    Disc: makeStub("Disc"),
    ChevronDown: makeStub("ChevronDown"),
    Check: makeStub("Check"),
    Search: makeStub("Search"),
  };
});

const mockClient = {
  setDisplayPage: vi.fn().mockResolvedValue({ ok: true }),
  applySetup: vi.fn().mockResolvedValue({ ok: true }),
  getConfig: vi.fn().mockResolvedValue({}),
  setConfigValue: vi.fn().mockResolvedValue({ status: "ok" }),
  startTouchCalibration: vi
    .fn()
    .mockResolvedValue({ target_count: 9, current_step: 0 }),
  getTouchCalibrationStatus: vi
    .fn()
    .mockResolvedValue({ calibrated: true, in_progress: false }),
  startDisplayCalibration: vi.fn().mockResolvedValue({ ok: true }),
  getDisplayCalibrationStatus: vi
    .fn()
    .mockResolvedValue({ current_step: 1, complete: false, skipped: false }),
  skipDisplayCalibration: vi.fn().mockResolvedValue({ ok: true }),
  listCameras: vi.fn().mockResolvedValue({
    cameras: [
      {
        name: "CSI 0",
        type: "csi",
        device_path: "/dev/video0",
        hardware_role: "primary",
      },
    ],
    assignments: { primary: "/dev/video0" },
  }),
  switchCamera: vi.fn().mockResolvedValue({ ok: true }),
  listRecordings: vi.fn().mockResolvedValue({
    recording: false,
    current_filename: null,
    items: [],
  }),
  startRecording: vi.fn().mockResolvedValue({ status: "recording" }),
  stopRecording: vi.fn().mockResolvedValue({ status: "stopped" }),
  getVideoStatus: vi.fn().mockResolvedValue({
    state: "stopped",
    whep_url: null,
    encoder: null,
    cameras: { cameras: [], assignments: {} },
    mediamtx: { running: false, webrtc_port: 8889 },
  }),
};

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: "http://groundnode.local:8080", apiKey: null, client: mockClient }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The hardware display route retired in Stage 5; the body lives at
// the lifted Command-tab tab component.
import { DisplayTab as HardwareDisplayPage } from "@/components/command/nodes/ground-station/DisplayTab";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";

const initialCaps = useAgentCapabilitiesStore.getState();
const initialSys = useAgentSystemStore.getState();

beforeEach(() => {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: undefined,
  });
  useAgentCapabilitiesStore.setState(
    {
      ...initialCaps,
      loaded: true,
      uiTheme: "dark",
      display: {
        type: "spi-lcd",
        controller: "ili9486",
        resolution: "480x320",
        hasTouch: true,
        touchCalibrated: true,
        activePage: "dashboard",
        snapshotUrl: "http://groundnode.local:8080/api/v1/display/snapshot.png",
      },
    },
    true,
  );
  useAgentSystemStore.setState({ ...initialSys, lastUpdatedAt: Date.now() });
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialCaps, true);
  useAgentSystemStore.setState(initialSys, true);
});

describe("HardwareDisplayPage", () => {
  it("renders the page title and description", () => {
    renderWithIntl(<HardwareDisplayPage />);
    expect(screen.getByText("Display")).toBeDefined();
  });

  it("composes the display cards", () => {
    renderWithIntl(<HardwareDisplayPage />);
    // LocalDisplayCard
    expect(screen.getByText("Local Display")).toBeDefined();
    // HdmiKioskCard
    expect(screen.getByText("HDMI Cockpit")).toBeDefined();
    // LcdPagePreview
    expect(screen.getByText("Live preview")).toBeDefined();
    // LcdRemoteControl
    expect(screen.getByText("Remote control")).toBeDefined();
    // LcdThemeToggle
    expect(screen.getAllByText("Theme").length).toBeGreaterThan(0);
    // LcdCameraSwitch
    expect(screen.getByText("Cameras")).toBeDefined();
    // LcdRecordingMonitor
    expect(screen.getByText("Recording")).toBeDefined();
  });
});
