/**
 * Tests for the skill confirm host + store: the gesture tiers. A hold
 * completes only after the full hold time and never on an early release; the
 * gamepad button that opened a request satisfies the gesture while held; the
 * slide tier asks for the long hold on a key or button; the guarded (kill)
 * tier lapses when no hold starts inside its window; an incomplete pre-flight
 * checklist keeps the gesture inert until the explicit override is on; and a
 * take-off sheet returns the altitude the operator set.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";
import { SkillConfirmHost } from "@/components/cockpit/SkillConfirmHost";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { useChecklistStore } from "@/stores/checklist-store";
import { useInputStore } from "@/stores/input-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import {
  activate,
  buildSkillContext,
  registerBuiltins,
  type ConfirmPolicy,
  type ConfirmResult,
} from "@/lib/skills";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

const DRONE = "drone-1";

function checklistReady(droneId: string, ready = true) {
  useChecklistStore.setState((s) => ({
    droneId,
    items: s.items.map((item, i) => ({
      ...item,
      status: ready || i > 0 ? ("skipped" as const) : ("pending" as const),
    })),
  }));
}

function setButton(index: number, down: boolean) {
  const buttons = [...useInputStore.getState().buttons];
  buttons[index] = down;
  act(() => useInputStore.setState({ buttons }));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const HOLD_POLICY: ConfirmPolicy = {
  title: "skills.land.confirm.title",
  message: "skills.land.confirm.message",
  confirmLabel: "skills.land.confirm.button",
  variant: "danger",
  gesture: "hold",
};

const ARM_POLICY: ConfirmPolicy = {
  title: "skills.arm.confirm.title",
  message: "skills.arm.confirm.message",
  confirmLabel: "skills.arm.confirm.button",
  variant: "danger",
  gesture: "slide",
  checklistAware: true,
};

const KILL_POLICY: ConfirmPolicy = {
  title: "skills.kill.confirm.title",
  message: "skills.kill.confirm.message",
  confirmLabel: "skills.kill.confirm.button",
  variant: "danger",
  gesture: "guarded",
};

function request(policy: ConfirmPolicy, droneId?: string) {
  const outcome: { value: ConfirmResult | null } = { value: null };
  act(() => {
    void useSkillConfirmStore
      .getState()
      .request(policy, droneId)
      .then((v) => {
        outcome.value = v;
      });
  });
  return outcome;
}

function holdControl(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-hold-control='true']");
  if (!el) throw new Error("no hold control");
  return el;
}

describe("SkillConfirmHost", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    useSkillConfirmStore.setState({ pending: null, _nextId: 1 });
    useInputStore.setState({ buttons: new Array(16).fill(false) });
    checklistReady(DRONE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when there is no pending confirm", () => {
    const { container } = renderWithIntl(<SkillConfirmHost />);
    expect(container.textContent).toBe("");
  });

  it("confirms a hold only after the full hold time", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request(HOLD_POLICY, DRONE);

    fireEvent.pointerDown(holdControl(), { pointerId: 1 });
    advance(700);
    await flush();
    expect(outcome.value).toBeNull();

    advance(150);
    await flush();
    expect(outcome.value).toBe(true);
    expect(useSkillConfirmStore.getState().pending).toBeNull();
  });

  it("drops a hold released early", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request(HOLD_POLICY, DRONE);

    const control = holdControl();
    fireEvent.pointerDown(control, { pointerId: 1 });
    advance(500);
    fireEvent.pointerUp(control, { pointerId: 1 });
    advance(1000);
    await flush();
    expect(outcome.value).toBeNull();
    expect(useSkillConfirmStore.getState().pending).not.toBeNull();
  });

  it("holding Enter satisfies the hold", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request(HOLD_POLICY, DRONE);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    advance(800);
    await flush();
    expect(outcome.value).toBe(true);
  });

  it("resolves false on cancel and on Escape", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const first = request(HOLD_POLICY, DRONE);
    fireEvent.click(screen.getAllByRole("button", { name: /cancel/i })[0]);
    await flush();
    expect(first.value).toBe(false);

    const second = request(HOLD_POLICY, DRONE);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await flush();
    expect(second.value).toBe(false);
  });

  it("keeps the gesture inert until the checklist override is on", async () => {
    checklistReady(DRONE, false);
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request({ ...ARM_POLICY, gamepadButton: 0 }, DRONE);

    setButton(0, true);
    advance(2000);
    await flush();
    expect(outcome.value).toBeNull();

    // Releasing and turning the override on: a fresh full hold now confirms.
    setButton(0, false);
    fireEvent.click(screen.getByRole("switch"));
    setButton(0, true);
    advance(1500);
    await flush();
    expect(outcome.value).toBe(true);
  });

  it("treats a checklist completed for another drone as incomplete", () => {
    renderWithIntl(<SkillConfirmHost />);
    request(ARM_POLICY, "drone-2");
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("lapses the kill guard when no hold starts inside its window", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request(KILL_POLICY);
    advance(3100);
    await flush();
    expect(outcome.value).toBe(false);
  });

  it("fires kill on a 1500 ms hold inside the guard window", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request(KILL_POLICY);
    advance(1000);
    fireEvent.pointerDown(holdControl(), { pointerId: 1 });
    advance(1400);
    await flush();
    expect(outcome.value).toBeNull();
    advance(100);
    await flush();
    expect(outcome.value).toBe(true);
  });

  it("returns the altitude set on a take-off sheet", async () => {
    renderWithIntl(<SkillConfirmHost />);
    const outcome = request(
      {
        ...HOLD_POLICY,
        altitude: { defaultM: 10, minM: 1, maxM: 120, stepM: 1 },
      },
      DRONE,
    );
    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    fireEvent.click(screen.getByRole("button", { name: /increase/i }));
    fireEvent.pointerDown(holdControl(), { pointerId: 1 });
    advance(800);
    await flush();
    expect(outcome.value).toEqual({ altitudeM: 12 });
  });
});

describe("gamepad confirm of Arm through the dispatcher", () => {
  const arm = vi.fn(async () => ({ success: true, resultCode: 0 }));

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    arm.mockClear();
    registerBuiltins();
    const drone = {
      id: DRONE,
      name: DRONE,
      protocol: {
        isConnected: true,
        arm,
        getCapabilities: () => ({ supportsAutonomousNav: true }) as ProtocolCapabilities,
        getFirmwareHandler: () => null,
      },
    } as unknown as ManagedDrone;
    useDroneManager.setState({ drones: new Map([[DRONE, drone]]), selectedDroneId: DRONE });
    useDroneStore.setState({ armState: "disarmed", lastHeartbeat: Date.now() });
    useSkillConfirmStore.setState({ pending: null, _nextId: 1 });
    useInputStore.setState({ buttons: new Array(16).fill(false) });
    checklistReady(DRONE);
  });

  afterEach(() => {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    vi.useRealTimers();
  });

  function pressArmOnGamepad() {
    // The press that opens the sheet is the same button the pilot keeps held.
    setButton(0, true);
    act(() => {
      void activate("arm", buildSkillContext(DRONE), { gamepadButton: 0 });
    });
  }

  it("arms after button 0 is held for 1500 ms with the sheet open", async () => {
    renderWithIntl(<SkillConfirmHost />);
    pressArmOnGamepad();
    expect(useSkillConfirmStore.getState().pending?.policy.gesture).toBe("slide");

    // Keep the heartbeat fresh while the pilot holds.
    advance(1500);
    useDroneStore.setState({ lastHeartbeat: Date.now() });
    await flush();
    expect(arm).toHaveBeenCalledTimes(1);
  });

  it("does not arm when button 0 is released at 1000 ms", async () => {
    renderWithIntl(<SkillConfirmHost />);
    pressArmOnGamepad();

    advance(1000);
    setButton(0, false);
    advance(2000);
    await flush();
    expect(arm).not.toHaveBeenCalled();
    expect(useSkillConfirmStore.getState().pending).not.toBeNull();
  });
});
