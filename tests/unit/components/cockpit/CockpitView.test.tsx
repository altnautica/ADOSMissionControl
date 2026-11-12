import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

// Real translations resolved against the en bundle so the cockpit's i18n strings
// render exactly as a user would see them.
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";

// The singleton video brain inside VideoCanvas cascades transports + opens
// WebRTC; replace it with a passthrough that preserves its contract (renders
// children last) so L1/L2/radar still mount inside the video rect.
vi.mock("@/components/flight/VideoCanvas", () => ({
  VideoCanvas: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="video-canvas" className={className}>
      {children}
    </div>
  ),
}));

// The gamepad poller touches navigator.getGamepads + rAF; the cockpit only needs
// to hold and release it.
vi.mock("@/lib/input/gamepad-poller", async (orig) => ({
  ...(await orig<typeof import("@/lib/input/gamepad-poller")>()),
  acquireGamepadPolling: () => () => {},
  startManualControlStream: vi.fn(),
  stopManualControlStream: vi.fn(),
}));

// Unified flight recording drives MediaRecorder + the telemetry recorder; stub
// it to a controllable object so REC is observable without media APIs.
const recToggle = vi.fn();
const rec = vi.hoisted(() => ({ isRecording: false, startedAt: null as number | null }));
vi.mock("@/hooks/use-flight-recording", () => ({
  useFlightRecording: () => ({
    isRecording: rec.isRecording,
    startedAt: rec.startedAt,
    toggle: recToggle,
  }),
  useFlightRecordingStartedAt: () => rec.startedAt,
}));

// Only the cockpit root calls this hook, once per render, so its call count is
// the root's render count.
const rootRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/hooks/use-video-streams", () => ({
  useVideoStreams: () => {
    rootRenders.count += 1;
  },
}));

// The Cockpit flag store persists to window.localStorage; replace it with an
// equivalent non-persisted store (same enabled / altitude-reference contract).
vi.mock("@/stores/cockpit-store", async () => {
  const { create } = await vi.importActual<typeof import("zustand")>("zustand");
  const useCockpitStore = create<{
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    toggle: () => void;
    altitudeRef: "rel" | "msl";
    setAltitudeRef: (ref: "rel" | "msl") => void;
  }>((set, get) => ({
    enabled: false,
    setEnabled: (enabled) => set({ enabled }),
    toggle: () => set({ enabled: !get().enabled }),
    altitudeRef: "rel",
    setAltitudeRef: (altitudeRef) => set({ altitudeRef }),
  }));
  return { useCockpitStore };
});

import { CockpitView } from "@/components/cockpit/CockpitView";
import { specString } from "@/lib/cockpit/spec-strings";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useCockpitViewStore } from "@/lib/cockpit/views";
import { useUiStore } from "@/stores/ui-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";

// Persisted stores rehydrating in the cockpit subtree (settings slice the Skill
// Bar reads) touch window.localStorage; provide an in-memory implementation.
function installLocalStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function renderCockpit() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitView droneId="drone-1" />
    </NextIntlClientProvider>,
  );
}

describe("CockpitView", () => {
  beforeEach(() => {
    installLocalStorage();
    recToggle.mockClear();
    // The Skill Bar self-gates to the skill layer; enable it so the bar projects.
    useCockpitStore.setState({ enabled: true });
    useDroneManager.setState({ selectedDroneId: "drone-1" });
    useDroneManager.setState({ selectedDroneId: "drone-1" });
    useUiStore.setState({ immersiveMode: false });
    useSkillConfirmStore.setState({ pending: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useCockpitStore.setState({ enabled: false });
    useDroneManager.setState({ selectedDroneId: null });
    useDroneManager.setState({ selectedDroneId: null });
    useUiStore.setState({ immersiveMode: false });
  });

  it("renders the video shell, the HUD layer and the minimap", () => {
    const { container, getByTestId } = renderCockpit();
    // L0 video shell.
    expect(getByTestId("video-canvas")).toBeInTheDocument();
    // The HUD layer on the measured grid's centre zone.
    expect(getByTestId("hud-layer")).toBeInTheDocument();
    // Minimap card in the `.mmap` glass frame (OverviewMap loads via
    // next/dynamic; the wrapper card is what this structural assertion checks).
    expect(container.querySelector(".mmap")).not.toBeNull();
  });

  it("renders the cockpit grid: flight-state chip, left column and skill picker, no visible skill bar", () => {
    const { getByTestId, queryByRole } = renderCockpit();
    expect(getByTestId("flight-state-chip")).toBeInTheDocument();
    expect(getByTestId("left-column")).toBeInTheDocument();
    expect(getByTestId("skill-picker")).toBeInTheDocument();
    expect(queryByRole("toolbar", { name: /skill bar/i })).toBeNull();
  });

  it("drops the skill picker but keeps the flight column when the skill layer is disabled", () => {
    useCockpitStore.setState({ enabled: false });
    const { queryByTestId, getByTestId } = renderCockpit();
    expect(getByTestId("left-column")).toBeInTheDocument();
    expect(queryByTestId("skill-picker")).toBeNull();
    // The chip always shows who flies.
    expect(getByTestId("flight-state-chip")).toBeInTheDocument();
  });

  it("words the re-enable prompt from the shared spec", () => {
    useCockpitStore.setState({ enabled: false });
    const { getByTestId } = renderCockpit();
    const prompt = getByTestId("fs-enable-skills");
    expect(prompt.querySelector("h2")?.textContent).toBe(specString("cockpit.enable.title"));
    expect(prompt.querySelector("p")?.textContent).toBe(specString("cockpit.enable.body"));
    expect(prompt.querySelector("button")?.textContent).toBe(specString("cockpit.enable.button"));
  });

  it("enters full screen from the top bar's button (does not self-mount bridges)", () => {
    const { getByTestId, queryByTestId } = renderCockpit();
    // The embedded cockpit relies on CommandShell for the bridges — it must not
    // re-mount them itself.
    expect(queryByTestId("bridge-agent-mavlink")).toBeNull();
    fireEvent.click(getByTestId("fs-fullscreen"));
    expect(useUiStore.getState().immersiveMode).toBe(true);
  });

  it("starts a flight recording from the shutter in video mode", () => {
    const { getByRole, getByTestId } = renderCockpit();
    fireEvent.click(getByRole("button", { name: specString("cockpit.camera.video") }));
    fireEvent.click(getByTestId("fs-shutter"));
    expect(recToggle).toHaveBeenCalledTimes(1);
  });

  it("does not re-render the cockpit root while a recording runs", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    rec.isRecording = true;
    rec.startedAt = Date.now();
    try {
      rootRenders.count = 0;
      renderCockpit();
      for (let i = 0; i < 12; i++) {
        act(() => {
          vi.advanceTimersByTime(250);
        });
      }
      expect(rootRenders.count).toBeLessThanOrEqual(2);
    } finally {
      rec.isRecording = false;
      rec.startedAt = null;
      vi.useRealTimers();
    }
  });

  it("draws the data layers on the main video only, never on the Map view's PiP", () => {
    try {
      useCockpitViewStore.setState({ byDrone: { "drone-1": "pilot" } });
      const { container, unmount } = renderCockpit();
      expect(container.querySelector("[data-zone='video'] [data-cockpit-layer='layer-stack']")).not.toBeNull();
      unmount();

      useCockpitViewStore.setState({ byDrone: { "drone-1": "map" } });
      const pip = renderCockpit().container;
      const card = pip.querySelector(".fs-video-pip");
      expect(card).not.toBeNull();
      expect(card!.querySelector("[data-testid='video-canvas']")).not.toBeNull();
      expect(pip.querySelector("[data-cockpit-layer='layer-stack']")).toBeNull();
    } finally {
      useCockpitViewStore.setState({ byDrone: {} });
    }
  });
});
