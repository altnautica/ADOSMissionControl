/**
 * @license GPL-3.0-only
 *
 * Below md the drone Setup tab stacks a full-width panel picker above the
 * panel instead of a fixed 200 px side nav, so the panel keeps the width of a
 * phone. From md up the side nav returns and the picker hides.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";

vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ supports: () => true, firmwareType: "ardupilot-copter" }),
}));
vi.mock("@/hooks/use-fc-keyboard-shortcuts", () => ({ useFcKeyboardShortcuts: () => {} }));
vi.mock("@/hooks/use-fleet-plugin-contributions", () => ({ useFleetPluginContributions: () => [] }));
vi.mock("@/components/fc/shared/FlashCommitBanner", () => ({ FlashCommitBanner: () => null }));
vi.mock("@/components/indicators/RebootRequiredBanner", () => ({ RebootRequiredBanner: () => null }));
vi.mock("@/components/command/shared/FcSourcePicker", () => ({ FcSourcePicker: () => null }));
vi.mock("../FcPanelRouter", () => ({
  FcPanelRouter: ({ activePanel }: { activePanel: string }) => (
    <div data-testid="active-panel">{activePanel}</div>
  ),
}));

import messages from "../../../../locales/en.json";
import { DroneConfigureTab } from "../DroneConfigureTab";
import { useSettingsStore } from "@/stores/settings-store";

afterEach(cleanup);

function renderTab() {
  useSettingsStore.setState({ lastActivePanel: "outputs" });
  return render(<DroneConfigureTab droneId="d1" droneName="Alpha" isConnected />, {
    wrapper: IntlWrapper,
  });
}

describe("DroneConfigureTab below md", () => {
  it("stacks a full-width picker above the panel and keeps the side nav for md up", () => {
    const { container } = renderTab();
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("flex-col md:flex-row");

    const nav = container.querySelector("nav")!;
    const navClasses = nav.className.split(/\s+/);
    expect(navClasses).toEqual(expect.arrayContaining(["hidden", "md:block", "md:w-[200px]"]));
    expect(navClasses).not.toContain("w-[200px]");

    const picker = screen.getByTestId("fc-panel-picker");
    expect(picker.className.split(/\s+/)).toContain("md:hidden");
    // The panel area follows the picker in the column and takes the rest.
    expect(nav.nextElementSibling?.className).toContain("flex-1 min-w-0");
  });

  it("switches the panel from the picker", () => {
    renderTab();
    expect(screen.getByTestId("active-panel").textContent).toBe("outputs");
    fireEvent.click(screen.getByRole("combobox", { name: messages.droneDetail.droneConfigureTab.flightController }));
    // The first Failsafe entry is the ArduPilot panel.
    fireEvent.click(screen.getAllByRole("option", { name: messages.fcNav.failsafe })[0]);
    expect(screen.getByTestId("active-panel").textContent).toBe("failsafe");
  });
});
