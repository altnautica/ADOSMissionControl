/**
 * @license GPL-3.0-only
 *
 * On the flight screen the emergency stop confirms in a sheet below the top
 * bar beside the right column: "Emergency stop", the kill warning, one hold
 * button labelled with the spec's hold label that counts down while held. No
 * centred dialog, no scrim, no "I understand" button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { specString } from "@/lib/cockpit/spec-strings";
import type { ConfirmPolicy } from "@/lib/skills/types";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { useFlightSheetStore } from "../../flight/flight-sheet";
import { ConfirmSheet } from "../ConfirmSheet";

const KILL: ConfirmPolicy = {
  title: "confirm.kill.title",
  message: "confirm.kill.message",
  confirmLabel: "confirm.kill.button",
  variant: "danger",
  gesture: "guarded",
  holdMs: 3000,
};

beforeEach(() => {
  vi.useFakeTimers();
  useFlightSheetStore.setState({ open: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(onResolve: (ok: boolean) => void, policy: ConfirmPolicy = KILL) {
  renderWithIntl(<div data-testid="flight-screen" style={{ ["--fs-bar-b" as string]: "52px" }} />);
  act(() => {
    renderWithIntl(<ConfirmSheet policy={policy} droneId="d1" onResolve={onResolve} />);
  });
}

describe("emergency stop sheet", () => {
  it("is a sheet below the top bar with the canonical title, body and hold button", () => {
    useFlightSheetStore.setState({ open: "mode" });
    mount(() => {});
    const sheet = screen.getByTestId("stop-sheet");
    expect(sheet.parentElement).toBe(screen.getByTestId("flight-screen"));
    expect(sheet.style.top).toContain("--fs-bar-b");
    expect(sheet.style.right).not.toBe("");
    expect(sheet.querySelector("h2")!.textContent).toBe(specString("cockpit.estop"));
    expect(sheet.textContent).toContain(specString("confirm.kill.message"));
    expect(screen.getByTestId("stop-sheet-hold").textContent).toBe(specString("stop.hold_label"));
    expect(screen.queryByTestId("confirm-scrim")).toBeNull();
    expect(sheet.textContent).not.toContain(specString("confirm.kill.button"));
    // It replaces the open sheet.
    expect(useFlightSheetStore.getState().open).toBeNull();
  });

  it("counts down while held and confirms after the full hold", () => {
    const onResolve = vi.fn();
    mount(onResolve);
    const hold = screen.getByTestId("stop-sheet-hold");
    act(() => void fireEvent.pointerDown(hold));
    act(() => void vi.advanceTimersByTime(1_000));
    expect(hold.textContent).toMatch(/^Keep holding · \d\.\d s$/);
    expect(onResolve).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2_100));
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it("stays open until cancelled, then resolves as not confirmed", () => {
    const onResolve = vi.fn();
    mount(onResolve);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("stop-sheet-cancel"));
    expect(onResolve).toHaveBeenCalledWith(false, undefined);
  });

  it("warns under the body when the link is stale and the kill goes out blind", () => {
    mount(() => {});
    expect(screen.queryByTestId("stop-sheet-stale-link")).toBeNull();
    cleanup();
    mount(() => {}, { ...KILL, staleLink: true });
    const warn = screen.getByTestId("stop-sheet-stale-link");
    expect(warn.getAttribute("role")).toBe("alert");
    expect(warn.textContent).toBe(specString("confirm.stale_link"));
    expect(warn.previousElementSibling?.id).toBe("stop-sheet-body");
  });
});
