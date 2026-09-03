import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

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
// it to be start/stoppable.
vi.mock("@/lib/input/gamepad-poller", () => ({
  startGamepadPolling: vi.fn(),
  stopGamepadPolling: vi.fn(),
  startManualControlStream: vi.fn(),
  stopManualControlStream: vi.fn(),
}));

// Unified flight recording drives MediaRecorder + the telemetry recorder; stub
// it to a controllable object so REC is observable without media APIs.
const recToggle = vi.fn();
vi.mock("@/hooks/use-flight-recording", () => ({
  useFlightRecording: () => ({
    isRecording: false,
    durationMs: 0,
    toggle: recToggle,
  }),
}));

// The Cockpit flag store persists to window.localStorage; replace it with an
// equivalent non-persisted store (identical enabled/setEnabled/toggle contract).
vi.mock("@/stores/cockpit-store", async () => {
  const { create } = await vi.importActual<typeof import("zustand")>("zustand");
  const useCockpitStore = create<{
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    toggle: () => void;
  }>((set, get) => ({
    enabled: false,
    setEnabled: (enabled) => set({ enabled }),
    toggle: () => set({ enabled: !get().enabled }),
  }));
  return { useCockpitStore };
});

import { CockpitView } from "@/components/cockpit/CockpitView";
import { useCockpitStore } from "@/stores/cockpit-store";
import { useDroneManager } from "@/stores/drone-manager";
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

  it("renders the video shell, instrument HUD, and minimap PiP", () => {
    const { container, getByTestId } = renderCockpit();
    // L0 video shell.
    expect(getByTestId("video-canvas")).toBeInTheDocument();
    // Instrument HUD: the glass attitude indicator (a registered cockpit widget,
    // an SVG `.hud`) replaced the old OSD canvas.
    expect(container.querySelector(".hud")).not.toBeNull();
    // Minimap PiP card in the artifact `.mmap` glass frame (OverviewMap loads via
    // next/dynamic; the wrapper card is what this structural assertion checks).
    expect(container.querySelector(".mmap")).not.toBeNull();
  });

  it("renders the Skill Bar when the skill layer is enabled", () => {
    const { getByRole } = renderCockpit();
    expect(getByRole("toolbar")).toBeInTheDocument();
  });

  it("does not render the Skill Bar when the skill layer is disabled", () => {
    useCockpitStore.setState({ enabled: false });
    const { queryByRole } = renderCockpit();
    expect(queryByRole("toolbar")).toBeNull();
  });

  it("enters immersive mode from the cockpit control (does not self-mount bridges)", () => {
    const { getByRole, queryByTestId } = renderCockpit();
    // The embedded cockpit relies on CommandShell for the bridges — it must not
    // re-mount them itself.
    expect(queryByTestId("bridge-agent-mavlink")).toBeNull();
    const btn = getByRole("button", { name: messages.cockpit.immersive });
    fireEvent.click(btn);
    expect(useUiStore.getState().immersiveMode).toBe(true);
  });

  it("triggers a flight recording from the REC control", () => {
    const { getByRole } = renderCockpit();
    const rec = getByRole("button", { name: messages.cockpit.rec });
    fireEvent.click(rec);
    expect(recToggle).toHaveBeenCalledTimes(1);
  });
});
