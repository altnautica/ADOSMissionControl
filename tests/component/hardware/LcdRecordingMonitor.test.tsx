/**
 * @module LcdRecordingMonitor.test
 * @description Verifies the recording-state card: badge state from the
 * capabilities store, file list rendering, and the Start / Stop
 * toggle invoking the agent client.
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
    Disc: makeStub("Disc"),
    RefreshCw: makeStub("RefreshCw"),
    Loader2: makeStub("Loader2"),
  };
});

const mockClient = {
  listRecordings: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  getVideoStatus: vi.fn(),
};

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ agentUrl: "http://testnode.local:8080", apiKey: null, client: mockClient }),
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { LcdRecordingMonitor } from "@/components/hardware/LcdRecordingMonitor";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const initialCaps = useAgentCapabilitiesStore.getState();

beforeEach(() => {
  toastFn.mockClear();
  mockClient.listRecordings.mockReset();
  mockClient.startRecording.mockReset();
  mockClient.stopRecording.mockReset();
  mockClient.getVideoStatus.mockReset();
  mockClient.listRecordings.mockResolvedValue({
    recording: false,
    current_filename: null,
    items: [
      {
        filename: "rec-2026-05-08-1.mp4",
        size_bytes: 1234567,
        mtime: 1715199600,
        duration_sec: 95,
      },
      {
        filename: "rec-2026-05-08-0.mp4",
        size_bytes: 999000,
        mtime: 1715195000,
        duration_sec: 60,
      },
    ],
  });
  mockClient.getVideoStatus.mockResolvedValue({
    state: "running",
    whep_url: null,
    encoder: "h264",
    cameras: { cameras: [], assignments: {} },
    mediamtx: { running: true, webrtc_port: 8889 },
  });
  mockClient.startRecording.mockResolvedValue({ status: "recording", recording: true });
  mockClient.stopRecording.mockResolvedValue({ status: "stopped", recording: false });
  useAgentCapabilitiesStore.setState(
    { ...initialCaps, videoRecording: false },
    true,
  );
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initialCaps, true);
});

describe("LcdRecordingMonitor", () => {
  it("shows the Idle badge when the heartbeat reports videoRecording=false", () => {
    renderWithIntl(<LcdRecordingMonitor />);
    const badge = screen.getByTestId("recording-badge");
    expect(badge.getAttribute("data-recording")).toBe("false");
    expect(badge.textContent).toBe("Idle");
  });

  it("shows the Recording badge when videoRecording=true", () => {
    useAgentCapabilitiesStore.setState(
      { ...initialCaps, videoRecording: true },
      true,
    );
    renderWithIntl(<LcdRecordingMonitor />);
    const badge = screen.getByTestId("recording-badge");
    expect(badge.getAttribute("data-recording")).toBe("true");
    expect(badge.textContent).toBe("Recording");
  });

  it("renders the recording file list newest-first", async () => {
    renderWithIntl(<LcdRecordingMonitor />);
    await waitFor(() => {
      expect(screen.getByText("rec-2026-05-08-1.mp4")).toBeDefined();
      expect(screen.getByText("rec-2026-05-08-0.mp4")).toBeDefined();
    });
    const rows = document.querySelectorAll("[data-recording-row]");
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute("data-recording-row")).toBe(
      "rec-2026-05-08-1.mp4",
    );
  });

  it("fires startRecording when the operator clicks Start", async () => {
    renderWithIntl(<LcdRecordingMonitor />);
    await waitFor(() => {
      // Stream-publishing probe completed and Start is enabled.
      const btn = screen.getByTestId("start-recording") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("start-recording"));
    await waitFor(() => {
      expect(mockClient.startRecording).toHaveBeenCalledTimes(1);
    });
    // Optimistic flip: badge now reads Recording.
    await waitFor(() => {
      const badge = screen.getByTestId("recording-badge");
      expect(badge.getAttribute("data-recording")).toBe("true");
    });
  });

  it("fires stopRecording when the operator clicks Stop", async () => {
    useAgentCapabilitiesStore.setState(
      { ...initialCaps, videoRecording: true },
      true,
    );
    renderWithIntl(<LcdRecordingMonitor />);
    await waitFor(() => {
      const btn = screen.getByTestId("stop-recording") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("stop-recording"));
    await waitFor(() => {
      expect(mockClient.stopRecording).toHaveBeenCalledTimes(1);
    });
  });

  it("disables Start when the video pipeline is not running", async () => {
    mockClient.getVideoStatus.mockResolvedValueOnce({
      state: "stopped",
      whep_url: null,
      encoder: null,
      cameras: { cameras: [], assignments: {} },
      mediamtx: { running: false, webrtc_port: 8889 },
    });
    renderWithIntl(<LcdRecordingMonitor />);
    await waitFor(() => {
      const btn = screen.getByTestId("start-recording") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
    expect(
      screen.getByText("Start the video stream before recording."),
    ).toBeDefined();
  });

  it("rolls back the optimistic badge when startRecording rejects", async () => {
    mockClient.startRecording.mockRejectedValueOnce(new Error("kaboom"));
    renderWithIntl(<LcdRecordingMonitor />);
    await waitFor(() => {
      const btn = screen.getByTestId("start-recording") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("start-recording"));
    await waitFor(() => {
      expect(toastFn).toHaveBeenCalledWith("kaboom", "error");
    });
    const badge = screen.getByTestId("recording-badge");
    expect(badge.getAttribute("data-recording")).toBe("false");
  });
});
