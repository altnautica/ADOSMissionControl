/**
 * @license GPL-3.0-only
 *
 * DroneCAN on PX4: the ArduPilot Bus setup (CAN_P and CAN_D families) is not offered;
 * the page opens on the node browser and says where PX4 configures CAN.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";

const state = { firmwareType: "px4" };
const panelParams = vi.fn((opts: { autoLoad: boolean }) => ({ params: new Map<string, number>(), opts }));

vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: state.firmwareType }),
}));
vi.mock("@/hooks/use-panel-params", () => ({ usePanelParams: (o: { autoLoad: boolean }) => panelParams(o) }));
vi.mock("@/stores/drone-manager", () => {
  const drone = { name: "Charlie-03", protocol: {} };
  return { useDroneManager: (sel: (x: unknown) => unknown) => sel({ getSelectedDrone: () => drone }) };
});
vi.mock("../use-dronecan-session", () => ({
  useDroneCanSession: () => ({ state: { status: "closed" }, open: vi.fn(), close: vi.fn() }),
}));
vi.mock("../CanStatusBanner", () => ({ CanStatusBanner: () => null }));
vi.mock("../CanSessionCard", () => ({ CanSessionCard: () => null }));
vi.mock("../BusSetupSection", () => ({ BusSetupSection: () => <div>bus-setup-body</div> }));
vi.mock("../NodeBrowserSection", () => ({ NodeBrowserSection: () => <div>node-browser-body</div> }));
vi.mock("../BusMonitorSection", () => ({ BusMonitorSection: () => null }));
vi.mock("../DiagnosticsSection", () => ({ DiagnosticsSection: () => null }));
vi.mock("../NodeParamEditor", () => ({ NodeParamEditor: () => null }));
vi.mock("../TestUtilitiesSection", () => ({ TestUtilitiesSection: () => null }));
vi.mock("../debug/DebugDrawer", () => ({ DebugDrawer: () => null }));

import { CanConfigPage } from "../CanConfigPage";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CanConfigPage />
    </NextIntlClientProvider>,
  );
}

describe("CanConfigPage · firmware routing", () => {
  it("PX4 hides Bus setup, opens the node browser and reads no CAN_P* params", () => {
    state.firmwareType = "px4";
    panelParams.mockClear();
    renderPage();
    expect(screen.queryByRole("button", { name: messages.canConfig.sections.busSetup })).toBeNull();
    expect(screen.queryByText("bus-setup-body")).toBeNull();
    expect(screen.getByText("node-browser-body")).toBeInTheDocument();
    expect(screen.getByText(messages.canConfig.px4BusSetup)).toBeInTheDocument();
    expect(panelParams.mock.calls.every(([o]) => o.autoLoad === false)).toBe(true);
  });

  it("ArduPilot keeps Bus setup as the first section", () => {
    state.firmwareType = "ardupilot-copter";
    renderPage();
    expect(screen.getByText("bus-setup-body")).toBeInTheDocument();
  });
});
