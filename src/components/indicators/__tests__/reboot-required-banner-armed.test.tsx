/**
 * @license GPL-3.0-only
 *
 * The reboot-required banner's confirmation cannot be accepted once the
 * vehicle arms with it already open.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";
import messages from "../../../../locales/en.json";
import { useDroneStore } from "@/stores/drone-store";

const reboot = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({ getSelectedProtocol: () => ({ reboot }) }),
}));

import { RebootRequiredBanner } from "../RebootRequiredBanner";

const tk = messages.indicators.rebootRequiredBanner;

afterEach(() => {
  useDroneStore.setState({ armState: "unknown", connectionState: "disconnected" });
  reboot.mockClear();
});

describe("RebootRequiredBanner", () => {
  it("cannot be confirmed once the vehicle arms with the confirmation open", () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    render(<RebootRequiredBanner rebootParams={["SERIAL1_PROTOCOL"]} />, { wrapper: IntlWrapper });
    fireEvent.click(screen.getByRole("button", { name: messages.fcShared.rebootNow }));
    act(() => useDroneStore.setState({ armState: "armed" }));
    const confirm = screen.getByRole("button", { name: tk.reboot }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(reboot).not.toHaveBeenCalled();
  });
});
