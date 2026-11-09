import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

const setEngineDetector = vi.fn();
vi.mock("@/lib/skills/vision-detector-writer", () => ({
  setEngineDetector: (...args: unknown[]) => setEngineDetector(...args),
  uploadEngineModel: vi.fn(),
}));

vi.mock("@/lib/vision/resolve-vision-client", () => ({
  resolveVisionClient: () => ({
    listModels: async () => ({
      registry: [],
      installed: [],
      custom: [],
      active: "yolo-a",
      cache: { usedBytes: 0, maxBytes: 0, usedMb: 0, maxMb: 0 },
    }),
  }),
}));

vi.mock("@/lib/vision/model-filter", () => ({
  isDetectionModel: () => true,
  filterModelsForBoard: () => [
    {
      id: "yolo-b",
      name: "yolo-b",
      description: "",
      task: "detection",
      sources: ["installed"],
      installed: true,
      custom: false,
      active: false,
      fits: true,
      fitReason: null,
    },
  ],
}));

// Arm state per drone id: the picker must read its own drone's, not the
// selected drone's.
const armByDrone: Record<string, boolean> = {};
const lockCalls: (string | undefined)[] = [];
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: (droneId?: string) => {
    lockCalls.push(droneId);
    const armed = droneId !== undefined && armByDrone[droneId] === true;
    return { isArmed: armed, isHardBlocked: armed, lockMessage: "", hardBlockMessage: armed ? "armed" : "" };
  },
}));

import { ModelPicker } from "@/components/vision/ModelPicker";
import { useDroneStore } from "@/stores/drone-store";

describe("ModelPicker detector swap", () => {
  beforeEach(() => {
    setEngineDetector.mockReset().mockResolvedValue(true);
    toastFn.mockClear();
    lockCalls.length = 0;
  });
  afterEach(cleanup);

  it("refuses the engine-wide detector swap and upload while its drone is armed", async () => {
    // The selected drone reads disarmed; the picker's own drone is armed.
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    armByDrone.d1 = true;
    render(<ModelPicker droneId="d1" />);
    const setActive = await screen.findByRole("button", { name: "setActive" });
    expect((setActive as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "upload" })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(setActive);
    expect(setEngineDetector).not.toHaveBeenCalled();
    expect(lockCalls.every((id) => id === "d1")).toBe(true);
  });

  it("swaps the detector while its drone is disarmed", async () => {
    // The selected drone reads armed; the picker's own drone is disarmed.
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    armByDrone.d1 = false;
    render(<ModelPicker droneId="d1" />);
    fireEvent.click(await screen.findByRole("button", { name: "setActive" }));
    await waitFor(() => expect(setEngineDetector).toHaveBeenCalledWith({ droneId: "d1", modelId: "yolo-b" }));
  });
});
