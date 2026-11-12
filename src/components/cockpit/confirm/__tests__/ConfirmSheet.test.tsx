import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";

vi.mock("next-intl", () => {
  const t = Object.assign((k: string) => k, { has: () => false });
  return { useTranslations: () => t };
});

const recordSafetyOverride = vi.fn();
vi.mock("../confirm-text", () => ({
  recordSafetyOverride: (...a: unknown[]) => recordSafetyOverride(...a),
  translatePolicyText: (_t: unknown, v: string) => v,
}));

import { ConfirmSheet } from "../ConfirmSheet";
import { specString } from "@/lib/cockpit/spec-strings";
import { GUARD_WINDOW_MS, type ConfirmPolicy } from "@/lib/skills/types";
import { useChecklistStore } from "@/stores/checklist-store";
import { useInputStore } from "@/stores/input-store";

function policy(overrides: Partial<ConfirmPolicy> = {}): ConfirmPolicy {
  return {
    title: "confirm.arm.title",
    message: "Arm the drone",
    confirmLabel: "Hold to arm",
    variant: "primary",
    gesture: "hold",
    holdMs: 500,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  recordSafetyOverride.mockReset();
  useChecklistStore.setState({ droneId: null, items: [] });
  useInputStore.setState({ buttons: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConfirmSheet", () => {
  it("guarded sheet auto-cancels when the guard window lapses", () => {
    const onResolve = vi.fn();
    render(<ConfirmSheet policy={policy({ gesture: "guarded" })} droneId="d1" onResolve={onResolve} />);
    act(() => {
      vi.advanceTimersByTime(GUARD_WINDOW_MS + 10);
    });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(false, undefined);
  });

  it("guarded sheet completes when a hold started inside the window", () => {
    const onResolve = vi.fn();
    render(
      <ConfirmSheet policy={policy({ gesture: "guarded", holdMs: 4000 })} droneId="d1" onResolve={onResolve} />,
    );
    act(() => {
      vi.advanceTimersByTime(GUARD_WINDOW_MS - 1000);
    });
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it("checklist override unlocks the gesture and is recorded", () => {
    useChecklistStore.setState({
      droneId: "d1",
      items: [
        { id: "gps", category: "auto", label: "GPS fix", type: "auto", status: "fail" },
      ] as never,
    });
    const onResolve = vi.fn();
    render(<ConfirmSheet policy={policy({ checklistAware: true })} droneId="d1" onResolve={onResolve} />);

    // Gesture is inert while the checklist is incomplete.
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
      vi.advanceTimersByTime(1000);
    });
    expect(onResolve).not.toHaveBeenCalled();
    fireEvent.keyUp(window, { key: "Enter" });

    fireEvent.click(screen.getByRole("switch"));
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
    expect(recordSafetyOverride).toHaveBeenCalledWith("arm", "preflight_incomplete");
  });

  it("a gamepad button hold resolves true", () => {
    const onResolve = vi.fn();
    render(<ConfirmSheet policy={policy({ gamepadButton: 3 })} droneId="d1" onResolve={onResolve} />);
    act(() => {
      useInputStore.setState({ buttons: [false, false, false, true] });
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onResolve).toHaveBeenCalledWith(true, undefined);
  });

  it("Escape cancels", () => {
    const onResolve = vi.fn();
    render(<ConfirmSheet policy={policy()} droneId="d1" onResolve={onResolve} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResolve).toHaveBeenCalledWith(false, undefined);
  });

  it("names Cross as the pad confirm when no pad button opened the sheet", () => {
    render(<ConfirmSheet policy={policy()} droneId="d1" onResolve={vi.fn()} />);
    expect(screen.getByTestId("confirm-input-hint").textContent).toBe("skills.confirmPadHint");
  });

  it("says 'the same button' when a pad button opened the sheet", () => {
    render(<ConfirmSheet policy={policy({ gamepadButton: 3 })} droneId="d1" onResolve={vi.fn()} />);
    expect(screen.getByTestId("confirm-input-hint").textContent).toBe(specString("confirm.input_hint"));
  });
});
