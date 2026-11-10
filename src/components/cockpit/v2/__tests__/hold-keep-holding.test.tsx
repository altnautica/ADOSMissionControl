/**
 * @license GPL-3.0-only
 *
 * A hold control let go before its hold completes says to keep holding
 * (`hold.keep_holding`) next to the control for about 1.5 s; a full hold
 * fires without the hint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { HoldButton, KEEP_HOLDING_MS } from "../HoldButton";
import { HoldControl } from "../../confirm/HoldControl";
import type { ConfirmHold } from "../../confirm/use-confirm-hold";
import { specString } from "@/lib/cockpit/spec-strings";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HoldButton keep-holding hint", () => {
  it("shows the hint after a short tap, then clears it", () => {
    const onFire = vi.fn();
    render(
      <HoldButton holdMs={1500} onFire={onFire} data-testid="hold">
        Take over
      </HoldButton>,
    );
    const button = screen.getByTestId("hold");
    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(button);
    expect(onFire).not.toHaveBeenCalled();
    expect(screen.getByTestId("keep-holding-hint").textContent).toBe(specString("hold.keep_holding", { s: 1.5 }));
    act(() => vi.advanceTimersByTime(KEEP_HOLDING_MS));
    expect(screen.queryByTestId("keep-holding-hint")).toBeNull();
  });

  it("shows no hint for a pointer that only passes over", () => {
    render(
      <HoldButton holdMs={1500} onFire={() => {}} data-testid="hold">
        Take over
      </HoldButton>,
    );
    fireEvent.pointerLeave(screen.getByTestId("hold"));
    expect(screen.queryByTestId("keep-holding-hint")).toBeNull();
  });
});

describe("HoldControl keep-holding hint", () => {
  function hold(): ConfirmHold {
    return {
      holding: false,
      pointerHandlers: { onPointerDown: vi.fn(), onPointerUp: vi.fn(), onPointerLeave: vi.fn(), onPointerCancel: vi.fn() },
    };
  }

  it("shows the hint in place of the hint line after a short tap", () => {
    const h = hold();
    render(<HoldControl hold={h} holdMs={2000} label="Hold to arm" hint="Hold for 2 s" danger={false} disabled={false} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.pointerUp(button);
    expect(h.pointerHandlers.onPointerUp).toHaveBeenCalled();
    expect(screen.getByTestId("keep-holding-hint").textContent).toBe(specString("hold.keep_holding", { s: 2 }));
    act(() => vi.advanceTimersByTime(KEEP_HOLDING_MS));
    expect(screen.queryByTestId("keep-holding-hint")).toBeNull();
    expect(screen.getByText("Hold for 2 s")).toBeTruthy();
  });

  it("shows no hint when the hold ran its full time", () => {
    render(<HoldControl hold={hold()} holdMs={500} label="Hold to arm" hint="Hold" danger={false} disabled={false} />);
    const button = screen.getByRole("button");
    fireEvent.pointerDown(button);
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(button);
    expect(screen.queryByTestId("keep-holding-hint")).toBeNull();
  });
});
