/**
 * @license GPL-3.0-only
 *
 * The blackbox storage card reports what the flight controller says, and a
 * connection that cannot read onboard flash says so instead of showing a
 * made-up storage gauge.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DroneProtocol } from "@/lib/protocol/types";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-panel-scroll", () => ({ usePanelScroll: () => null }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map<string, number>([["BF_BLACKBOX_DEVICE", 1]]), loading: false, error: null,
    dirtyParams: new Set<string>(), hasRamWrites: false, loadProgress: null, hasLoaded: true,
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
let protocol: Partial<DroneProtocol> = {};
vi.mock("@/stores/drone-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
  useDroneManager: (selector: (s: unknown) => unknown) =>
    selector({ drones: new Map([["d1", { protocol }]]), selectedDroneId: "d1" }),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({
  ArmedWarningBanner: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../shared/PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("@/components/ui/select", () => ({ Select: () => null }));

import { BlackboxPanel } from "../BlackboxPanel";

beforeEach(() => { protocol = { isConnected: true }; });
afterEach(cleanup);

describe("BlackboxPanel storage", () => {
  it("does not invent a storage gauge when the connection cannot read flash", async () => {
    render(<BlackboxPanel />);
    await waitFor(() => expect(screen.getByText("This connection cannot read onboard log storage.")).toBeTruthy());
    expect(screen.queryByText(/Used:/)).toBeNull();
  });

  it("shows the flight controller's reported usage", async () => {
    protocol = {
      isConnected: true,
      getDataflashSummary: async () => ({ totalSize: 4 * 1024 * 1024, usedSize: 1024 * 1024, ready: true }),
    };
    render(<BlackboxPanel />);
    await waitFor(() => expect(screen.getByText(/Used: 1\.0 MB/)).toBeTruthy());
  });
});
