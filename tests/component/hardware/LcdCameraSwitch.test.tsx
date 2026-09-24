/**
 * @module LcdCameraSwitch.test
 * @description Verifies the camera-list card: list rendering, primary
 * highlight, refresh, and the optimistic switch + restarting state.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
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
    Camera: makeStub("Camera"),
    RefreshCw: makeStub("RefreshCw"),
    Loader2: makeStub("Loader2"),
    ChevronDown: makeStub("ChevronDown"),
    Check: makeStub("Check"),
    Search: makeStub("Search"),
  };
});

const mockClient = {
  listCameras: vi.fn(),
  switchCamera: vi.fn(),
};

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: "http://testnode.local:8080", apiKey: null, client: mockClient }),
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { LcdCameraSwitch } from "@/components/hardware/LcdCameraSwitch";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  toastFn.mockClear();
  mockClient.listCameras.mockReset();
  mockClient.switchCamera.mockReset();
  mockClient.listCameras.mockResolvedValue({
    cameras: [
      {
        name: "CSI 0",
        type: "csi",
        device_path: "/dev/video0",
        hardware_role: "primary",
        resolution: "1920x1080",
        label: "Front CSI",
      },
      {
        name: "USB UVC",
        type: "uvc",
        device_path: "/dev/video2",
        hardware_role: "secondary",
        resolution: "1280x720",
        label: "Belly USB",
      },
    ],
    assignments: { primary: "/dev/video0" },
  });
  mockClient.switchCamera.mockResolvedValue({ ok: true, restarting: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LcdCameraSwitch", () => {
  it("renders the list of cameras after the initial load", async () => {
    const { container } = renderWithIntl(<LcdCameraSwitch />);
    await waitFor(() => expect(mockClient.listCameras).toHaveBeenCalled());
    await waitFor(() => {
      expect(
        container.querySelector('[data-camera-path="/dev/video0"]'),
      ).toBeTruthy();
      expect(
        container.querySelector('[data-camera-path="/dev/video2"]'),
      ).toBeTruthy();
    });
    // Each camera row carries its label text.
    const front = container.querySelector('[data-camera-path="/dev/video0"]');
    const belly = container.querySelector('[data-camera-path="/dev/video2"]');
    expect(front?.textContent).toContain("Front CSI");
    expect(belly?.textContent).toContain("Belly USB");
  });

  it("highlights the current primary with a Primary badge", async () => {
    const { container } = renderWithIntl(<LcdCameraSwitch />);
    await waitFor(() => {
      expect(
        container.querySelector('[data-camera-path="/dev/video0"]'),
      ).toBeTruthy();
    });
    const primary = container.querySelector(
      '[data-camera-path="/dev/video0"]',
    );
    expect(primary?.getAttribute("data-primary")).toBe("true");
    const secondary = container.querySelector(
      '[data-camera-path="/dev/video2"]',
    );
    expect(secondary?.getAttribute("data-primary")).toBe("false");
    // Badge appears exactly once (only on primary).
    expect(screen.getAllByTestId("primary-badge").length).toBe(1);
  });

  it("fires switchCamera and shows the restarting indicator after a successful switch", async () => {
    const { container } = renderWithIntl(<LcdCameraSwitch />);
    await waitFor(() =>
      expect(
        container.querySelector('[data-camera-path="/dev/video2"]'),
      ).toBeTruthy(),
    );

    // Open the Select trigger and pick the secondary device.
    const trigger = container.querySelector('button[role="combobox"]');
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger!);
    // The portal renders into document.body. Pick the secondary
    // camera by its label.
    const option = await waitFor(() => {
      const els = Array.from(document.querySelectorAll('[role="option"]'));
      const match = els.find((el) => el.textContent?.includes("Belly USB"));
      if (!match) throw new Error("option not yet rendered");
      return match;
    });
    fireEvent.click(option);

    await waitFor(() => {
      expect(mockClient.switchCamera).toHaveBeenCalledWith("/dev/video2");
    });
    // Restarting indicator is up while the timeout is pending.
    expect(screen.getByTestId("restarting-indicator")).toBeDefined();
  });

  it("shows the empty state when the agent reports zero cameras", async () => {
    mockClient.listCameras.mockResolvedValueOnce({
      cameras: [],
      assignments: {},
    });
    renderWithIntl(<LcdCameraSwitch />);
    await waitFor(() => {
      expect(
        screen.getByText(
          "No cameras detected. Plug a CSI or USB camera into the companion board and refresh.",
        ),
      ).toBeDefined();
    });
  });

  it("toasts an error when listCameras rejects", async () => {
    mockClient.listCameras.mockRejectedValueOnce(new Error("boom"));
    renderWithIntl(<LcdCameraSwitch />);
    await waitFor(() => {
      expect(toastFn).toHaveBeenCalledWith("boom", "error");
    });
  });
});
