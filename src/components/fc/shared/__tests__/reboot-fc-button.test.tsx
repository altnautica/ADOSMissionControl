/**
 * @license GPL-3.0-only
 *
 * The shared reboot control asks before rebooting, is disabled while the
 * vehicle may be armed, and cannot be confirmed once the vehicle arms with the
 * confirmation already open.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import messages from "../../../../../locales/en.json";
import { useDroneStore } from "@/stores/drone-store";
import { RebootFcButton } from "../RebootFcButton";
import { CalibrationRebootBanner } from "../../calibration/CalibrationRebootBanner";

const trigger = () => screen.getByRole("button", { name: messages.droneDetail.rebootFc }) as HTMLButtonElement;
const confirm = () => screen.getByRole("button", { name: messages.dronePanel.reboot }) as HTMLButtonElement;

afterEach(() => {
  useDroneStore.setState({ armState: "unknown", connectionState: "disconnected" });
});

describe.each([
  ["RebootFcButton", (onReboot: () => void) => <RebootFcButton onReboot={onReboot} />],
  ["CalibrationRebootBanner", (onReboot: () => void) => <CalibrationRebootBanner label="Saved" onReboot={onReboot} />],
])("%s", (_name, ui) => {
  it("reboots only after the confirmation", () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    const onReboot = vi.fn();
    render(ui(onReboot), { wrapper: IntlWrapper });
    fireEvent.click(trigger());
    expect(onReboot).not.toHaveBeenCalled();
    fireEvent.click(confirm());
    expect(onReboot).toHaveBeenCalledTimes(1);
  });

  it.each(["armed", "unknown"] as const)("is disabled while the arm state is %s", (armState) => {
    useDroneStore.setState({ armState, connectionState: "connected" });
    render(ui(vi.fn()), { wrapper: IntlWrapper });
    expect(trigger().disabled).toBe(true);
  });

  it("cannot be confirmed once the vehicle arms with the confirmation open", () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    const onReboot = vi.fn();
    render(ui(onReboot), { wrapper: IntlWrapper });
    fireEvent.click(trigger());
    act(() => useDroneStore.setState({ armState: "armed" }));
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    expect(onReboot).not.toHaveBeenCalled();
  });
});
