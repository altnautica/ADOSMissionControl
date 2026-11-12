/**
 * @license GPL-3.0-only
 *
 * A Setup panel that throws stays inside the panel area, and the OSD editor
 * and PX4 GPS panels render without re-running their parameter load forever.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";
import { FcPanelErrorBoundary } from "../FcPanelErrorBoundary";
import { OsdEditorPanel } from "@/components/fc/osd/OsdEditorPanel";
import { Px4GpsPanel } from "@/components/fc/px4/Px4GpsPanel";
import { useFcPanelActionsStore } from "@/stores/fc-panel-actions-store";

function Boom(): never {
  throw new Error("boom");
}

describe("FcPanelErrorBoundary", () => {
  it("shows the fallback in place of the panel and reports the crash", () => {
    const onError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <nav>Setup nav</nav>
        <FcPanelErrorBoundary message="Panel failed" retryLabel="Try again" onError={onError}>
          <Boom />
        </FcPanelErrorBoundary>
      </div>,
    );
    expect(screen.getByText("Setup nav")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Panel failed");
    expect(onError).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Try again"));
    expect(screen.getByRole("alert")).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe("panels with optional-only parameter lists", () => {
  it.each([
    ["OSD editor", OsdEditorPanel],
    ["PX4 GPS", Px4GpsPanel],
  ])("%s renders without an update loop", async (_name, Panel) => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a));
    // The Setup tab subscribes to the panel's registered actions, so a panel
    // that re-registers on every render re-renders itself through the tab.
    function Tab() {
      useFcPanelActionsStore((st) => st.saveToRam);
      return <Panel />;
    }
    render(<Tab />, { wrapper: IntlWrapper });
    await vi.waitFor(() => undefined);
    expect(errors.map(String).join("\n")).not.toMatch(/Maximum update depth/);
    spy.mockRestore();
  });
});
