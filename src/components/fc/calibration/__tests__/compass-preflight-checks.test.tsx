/**
 * @license GPL-3.0-only
 *
 * The compass pre-flight "fix" buttons write parameters, so on an armed
 * vehicle they ask first like every other FC write, and their text is
 * localised.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import { useDroneStore } from "@/stores/drone-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { CompassPreflightChecks } from "../CompassPreflightChecks";
import type { CompassParams } from "../calibration-types";

const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
const toast = vi.fn();

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({}),
  selectSelectedProtocol: () => ({ setParameter }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

const params = {
  COMPASS_USE: 1,
  COMPASS_ORIENT: 0,
  COMPASS_AUTO_ROT: 0,
  COMPASS_OFFS_MAX: 850,
  COMPASS_LEARN: 3,
  COMPASS_EXTERNAL: 2,
} as unknown as CompassParams;

afterEach(() => {
  useDroneStore.setState({ armState: "disarmed", connectionState: "disconnected" });
  setParameter.mockClear();
});

describe("CompassPreflightChecks", () => {
  it("asks before writing on an armed vehicle and writes nothing on cancel", async () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    render(<CompassPreflightChecks compassParams={params} setCompassParams={vi.fn()} />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByText("Fix"));
    await vi.waitFor(() => expect(useArmedConfirmStore.getState().open).toBe(true));
    await act(async () => {
      useArmedConfirmStore.getState().cancel();
    });
    expect(setParameter).not.toHaveBeenCalled();
  });

  it("writes on a disarmed vehicle and renders labels from the locale", async () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    render(<CompassPreflightChecks compassParams={params} setCompassParams={vi.fn()} />, { wrapper: IntlWrapper });
    expect(screen.getByText("Forced external")).toBeTruthy();
    expect(screen.getByText("3 (In flight)")).toBeTruthy();
    fireEvent.click(screen.getByText("Increase to 2000"));
    await vi.waitFor(() => expect(setParameter).toHaveBeenCalledWith("COMPASS_OFFS_MAX", 2000));
  });
});
