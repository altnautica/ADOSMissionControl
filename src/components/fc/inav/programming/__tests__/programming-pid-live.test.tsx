/**
 * @license GPL-3.0-only
 *
 * Programming PID outputs read as live only while the status poll is recent.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClockStore } from "@/stores/clock-store";
import { useProgrammingStore } from "@/stores/programming-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import { ProgrammingPidPanel } from "../ProgrammingPidPanel";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-armed-lock", () => ({ useArmedLock: () => ({ isArmed: false }) }));
const droneState = { getSelectedProtocol: () => null };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));

function seed(statusAt: number, now: number): void {
  useClockStore.setState({ now });
  useProgrammingStore.setState({
    loaded: true,
    pidStatus: [{ id: 0, output: 42 }],
    pidStatusAt: statusAt,
  });
}

afterEach(() => {
  cleanup();
  useProgrammingStore.getState().clear();
});

describe("ProgrammingPidPanel live output", () => {
  it("shows the output while the last status read is fresh", () => {
    const now = 1_000_000;
    seed(now - 500, now);
    render(<ProgrammingPidPanel />);
    expect(screen.getByText("output: 42")).toBeTruthy();
  });

  it("hides the output once the status read is stale", () => {
    const now = 1_000_000;
    seed(now - TELEMETRY_STALE_MS - 1, now);
    render(<ProgrammingPidPanel />);
    expect(screen.queryByText("output: 42")).toBeNull();
  });
});
