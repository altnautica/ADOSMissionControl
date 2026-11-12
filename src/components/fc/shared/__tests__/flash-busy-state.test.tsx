/**
 * @license GPL-3.0-only
 *
 * The Write to Flash buttons outside the shared save bar (flight modes header,
 * OSD element grid, Airframe, Actuators) show busy and refuse a second click
 * while the commit runs.
 */

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

let releaseCommit: (ok: boolean) => void = () => {};
const commitToFlash = vi.fn(() => new Promise<boolean>((resolve) => { releaseCommit = resolve; }));

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["SYS_AUTOSTART", 4001], ["SYS_AUTOCONFIG", 0]]),
    loading: false, error: null, dirtyParams: new Set<string>(), hasRamWrites: true,
    loadProgress: null, hasLoaded: true, missingOptional: new Set<string>(),
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash,
  }),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({
  ArmedWarningBanner: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FlightModesHeader } from "../../flight-modes/FlightModesHeader";
import { OsdElementGrid } from "../../osd/OsdElementGrid";
import { AirframePanel } from "../../frame/AirframePanel";

const flashButton = () => screen.getByRole("button", { name: /Write to Flash/i }) as HTMLButtonElement;

describe("Write to Flash busy state", () => {
  it("FlightModesHeader disables the button while flashing", () => {
    render(
      <FlightModesHeader isDirty={false} totalDirtyCount={0} dirtySlotCount={0} loading={false} saving={false}
        flashing showCommitButton onRead={vi.fn()} onSave={vi.fn()} onCommit={vi.fn()} />,
      { wrapper: IntlWrapper },
    );
    expect(flashButton().disabled).toBe(true);
  });

  it("OsdElementGrid disables the button while flashing", () => {
    render(
      <OsdElementGrid elements={[]} activeScreen={1} saving={false} flashing selectedDroneId="d1" hasRamWrites
        screenEnabled clipboard={null} videoFormat={0 as never}
        onToggleElement={vi.fn()} onScreenChange={vi.fn()} onLoadPreset={vi.fn()} onCopyScreen={vi.fn()}
        onPasteScreen={vi.fn()} onFormatChange={vi.fn()} onSave={vi.fn()} onCommitFlash={vi.fn()} onReset={vi.fn()} />,
      { wrapper: IntlWrapper },
    );
    expect(flashButton().disabled).toBe(true);
    expect(flashButton().getAttribute("aria-busy")).toBe("true");
  });

  it("AirframePanel is busy until the commit resolves", async () => {
    render(<AirframePanel />, { wrapper: IntlWrapper });
    fireEvent.click(flashButton());
    expect(flashButton().disabled).toBe(true);
    fireEvent.click(flashButton());
    expect(commitToFlash).toHaveBeenCalledTimes(1);
    await act(async () => { releaseCommit(true); });
    expect(flashButton().disabled).toBe(false);
  });
});
