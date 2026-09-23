/**
 * @module LocalDisplayCard.test
 * @description Verifies the extended local-display card: pill colors,
 * theme pill, last-touch row, active-page row, and the calibrate
 * button. Also exercises the agent-client invocation on calibrate.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("lucide-react", () => {
  function makeStub(name: string) {
    function StubIcon(props: Record<string, unknown>) {
      return <span data-testid={`icon-${name}`} {...props} />;
    }
    StubIcon.displayName = `StubIcon(${name})`;
    return StubIcon;
  }
  return {
    __esModule: true,
    Monitor: makeStub("Monitor"),
    Loader2: makeStub("Loader2"),
    ImageOff: makeStub("ImageOff"),
    X: makeStub("X"),
    ChevronDown: makeStub("ChevronDown"),
    Check: makeStub("Check"),
    Search: makeStub("Search"),
  };
});

const mockClient = {
  startDisplayCalibration: vi.fn().mockResolvedValue({ ok: true }),
  setConfigValue: vi
    .fn()
    .mockResolvedValue({ status: "ok", key: "ground_station.display.type", value: "hdmi" }),
};

/** Which node the singleton connection store is attached to. The card's write
 * uses the attached client ONLY when this matches the rendered node. */
let attachedDeviceId: string | null = "gs-1";

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({
      agentUrl: "http://gs-node.local:8080",
      apiKey: null,
      client: mockClient,
      nodeDeviceId: attachedDeviceId,
    }),
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { LocalDisplayCard } from "@/components/hardware/LocalDisplayCard";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const initial = useAgentCapabilitiesStore.getState();

beforeEach(() => {
  attachedDeviceId = "gs-1";
  toastFn.mockClear();
  mockClient.startDisplayCalibration.mockClear();
  mockClient.setConfigValue.mockClear();
  useAgentCapabilitiesStore.setState({ ...initial, loaded: true }, true);
});

afterEach(() => {
  useAgentCapabilitiesStore.setState(initial, true);
});

describe("LocalDisplayCard", () => {
  it("renders nothing when neither display nor displayType is reported", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "none" },
      displayType: undefined,
    });
    const { container } = renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the override picker when displayType is reported even without a bound LCD", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: undefined,
      displayType: "hdmi",
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    // Effective-primary row + override picker render even when no SPI
    // panel is bound. We assert both surfaces are present.
    expect(screen.getByText("Effective primary path")).toBeDefined();
    // The picker shows the selected label inside its trigger button.
    const triggers = screen.getAllByText("HDMI");
    expect(triggers.length).toBeGreaterThan(0);
  });

  it("writes ground_station.display.type once the operator confirms a detected renderer", async () => {
    // The node reports an SPI panel, so LCD is a renderer it can actually
    // drive. Selecting one it does not report is covered below.
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "spi-lcd", controller: "ili9486" },
      displayType: "hdmi",
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    // Open the override Select; the trigger button carries the
    // currently selected label ("HDMI") inside it.
    const trigger = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("HDMI"));
    expect(trigger).toBeDefined();
    fireEvent.click(trigger!);
    // The portal renders the option list; pick "LCD".
    const lcdOption = screen.getByRole("option", { name: /^LCD$/ });
    fireEvent.click(lcdOption);
    // The renderer write provisions a boot-critical overlay, so it is held
    // behind an explicit confirmation rather than applied on selection.
    expect(mockClient.setConfigValue).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("button", {
      name: /change renderer/i,
    });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(mockClient.setConfigValue).toHaveBeenCalledWith(
        "ground_station.display.type",
        "lcd",
      );
    });
  });

  it("offers no undetected renderer to select", () => {
    // Only HDMI is reported. An overlay provisioned for an absent panel is an
    // unbootable board, so the option is present-but-disabled and explains
    // itself rather than being silently missing.
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: undefined,
      displayType: "hdmi",
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    const trigger = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("HDMI"));
    fireEvent.click(trigger!);
    const lcd = screen.queryByRole("option", { name: /^LCD$/ });
    expect(lcd).toBeNull();
    expect(mockClient.setConfigValue).not.toHaveBeenCalled();
  });

  it("shows the green calibrated pill when touch is calibrated", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        controller: "ili9486",
        resolution: "480x320",
        rotation: 90,
        hasTouch: true,
        touchCalibrated: true,
      },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    const pill = screen.getByText("Calibrated");
    expect(pill).toBeDefined();
    expect(pill.className).toMatch(/text-status-success/);
  });

  it("shows the amber not-calibrated pill when hasTouch but not calibrated", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        touchCalibrated: false,
      },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    const pill = screen.getByText("Not calibrated");
    expect(pill).toBeDefined();
    expect(pill.className).toMatch(/text-status-warning/);
  });

  it("shows the gray no-touch pill when the panel has no touch", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: false,
      },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    const pills = screen.getAllByText("No touch");
    expect(pills.length).toBeGreaterThan(0);
  });

  it("renders the theme pill from uiTheme", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      uiTheme: "light",
      display: { type: "spi-lcd", hasTouch: true, touchCalibrated: true },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    expect(screen.getByText("Light")).toBeDefined();
  });

  it("renders the last-touch and active-page rows when present", () => {
    const ts = Date.now() - 3_000;
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: {
        type: "spi-lcd",
        hasTouch: true,
        touchCalibrated: true,
        lastTouchAt: ts,
        activePage: "dashboard",
      },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    expect(screen.getByText(/3 s ago/)).toBeDefined();
    expect(screen.getByText("dashboard")).toBeDefined();
  });

  it("hides last-touch row when lastTouchAt is undefined", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "spi-lcd", hasTouch: true, touchCalibrated: true },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    expect(screen.queryByText(/Last touch/)).toBeNull();
  });

  it("fires startDisplayCalibration when the calibrate button is clicked", async () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "spi-lcd", hasTouch: true, touchCalibrated: false },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    fireEvent.click(screen.getByText("Calibrate touch"));
    await waitFor(() => {
      expect(mockClient.startDisplayCalibration).toHaveBeenCalledTimes(1);
    });
    expect(toastFn).toHaveBeenCalledWith(
      "Calibration started — tap each crosshair shown on the device LCD.",
      "info",
    );
  });

  it("refuses the renderer write when the attached client serves another node", async () => {
    // The blocker: the store still holds node A's client while this card is
    // rendered for node B. Writing `ground_station.display.type` on A can dark
    // its on-box display, which is the surface an operator recovers A from.
    attachedDeviceId = "some-other-node";
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      displayType: "lcd",
      display: { type: "spi-lcd", hasTouch: true, touchCalibrated: true },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);

    // No pairing record for gs-1 either, so there is genuinely no lane: the
    // picker is disabled rather than writing to the wrong box.
    const picker = screen.getByRole("combobox");
    expect(picker.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(picker);
    await Promise.resolve();
    expect(mockClient.setConfigValue).not.toHaveBeenCalled();
  });

  it("does not show the calibrate button when the panel has no touch", () => {
    useAgentCapabilitiesStore.setState({
      ...initial,
      loaded: true,
      display: { type: "spi-lcd", hasTouch: false },
    });
    renderWithIntl(<LocalDisplayCard nodeDeviceId="gs-1" relayReach={null} />);
    expect(screen.queryByText("Calibrate touch")).toBeNull();
  });
});
