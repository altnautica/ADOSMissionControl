/**
 * @description Fly Here goes through the skill dispatcher with a bounded
 * altitude.
 *
 * The target is sent in a home-relative frame, so an altitude of 0 flies the
 * vehicle down to home elevation wherever the point is. A cleared, negative,
 * non-numeric or out-of-range entry must never reach the vehicle, and the
 * reposition gets the dispatcher's arm gate like every other flight command.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { activate, SPEC_HOLD_MS } from "@/lib/skills";
import { useSkillRegistry } from "@/lib/skills/registry";
import { resetCooldownState } from "@/lib/skills/cooldown";
import { cancelGuidedTarget } from "@/lib/skills/guided-target";
import { flyHereSkill, parseFlyHereAltitude } from "@/lib/skills/builtins/fly-here";
import { GuidedConfirmDialog } from "@/components/flight/GuidedConfirmDialog";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useGuidedStore } from "@/stores/guided-store";
import { useInputStore } from "@/stores/input-store";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";
import type { SkillContext } from "@/lib/skills/types";

const ACCEPTED: CommandResult = { success: true, resultCode: 0, message: "Accepted" };

let seq = 0;
let drone = "";
let protocol: DroneProtocol;
const guidedGoto = vi.fn(async (): Promise<CommandResult> => ACCEPTED);

function makeCtx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: drone,
    protocol,
    armState: "armed",
    flightMode: "GUIDED",
    availableModes: [],
    missionState: null,
    supports: () => true,
    checklistReady: true,
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  seq += 1;
  drone = `fly-here-${seq}`;
  guidedGoto.mockClear();
  resetCooldownState();
  useSkillRegistry.setState({ skills: new Map(), states: new Map(), _order: new Map(), _seq: 0 });
  useSkillRegistry.getState().register(flyHereSkill);
  protocol = {
    isConnected: true,
    guidedGoto,
    getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
    getFirmwareHandler: () => null,
    getCapabilities: () => ({}),
  } as unknown as DroneProtocol;
  useDroneManager.setState({
    selectedDroneId: drone,
    drones: new Map([[drone, { id: drone, name: "Alpha", protocol } as unknown as ManagedDrone]]),
  });
  // Without the pilot, Fly Here repositions an FC that already flies GUIDED.
  useDroneStore.setState({ armState: "armed", connectionState: "armed", flightMode: "GUIDED", lastHeartbeat: Date.now() });
});

afterEach(() => {
  cleanup();
  cancelGuidedTarget();
  useGuidedStore.setState({ confirmPending: null, target: null });
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  vi.useRealTimers();
});

describe("Fly Here altitude", () => {
  it("accepts only a finite altitude inside the bounds", () => {
    expect(parseFlyHereAltitude("30")).toBe(30);
    expect(parseFlyHereAltitude("2")).toBe(2);
    for (const bad of ["", "0", "-5", "-", "1", "500", "abc"]) {
      expect(parseFlyHereAltitude(bad)).toBeNull();
    }
  });

  it("refuses to send an out-of-range altitude", async () => {
    const ctx = makeCtx();
    await activate("fly-here", ctx, { lat: 10, lon: 20, altitudeM: 0 });
    expect(guidedGoto).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith(expect.stringContaining("altitude"), "error");
  });

  it("is refused by the arm gate on a disarmed vehicle", async () => {
    const ctx = makeCtx({ armState: "disarmed" });
    await activate("fly-here", ctx, { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith("refusal.needs_armed", "warning");
  });

  it("repositions an armed vehicle and supervises the target", async () => {
    await activate("fly-here", makeCtx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 30, { changeMode: false });
    expect(useGuidedStore.getState().target).toMatchObject({ droneId: drone, alt: 30 });
  });
});

describe("Fly Here dialog", () => {
  function open(): void {
    useGuidedStore.setState({
      confirmPending: { droneId: drone, lat: 10, lon: 20, screenX: 0, screenY: 0 },
    });
    render(<GuidedConfirmDialog />);
  }

  it("never sends a cleared altitude box", async () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "" } });
    const hold = screen.getByRole("button", { name: /Hold to fly here/ });
    expect(hold.getAttribute("aria-disabled")).toBe("true");
    fireEvent.pointerDown(hold);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(guidedGoto).not.toHaveBeenCalled();
  });

  it("dispatches the held confirmation with the typed altitude", async () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "25" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: /Hold to fly here/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 25, { changeMode: false });
  });

  it("confirms after the spec's Fly Here hold, not before", async () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "25" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: /Hold to fly here/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_HOLD_MS.fly_here - 200);
    });
    expect(guidedGoto).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 25, { changeMode: false });
  });

  it("confirms on a held Enter as well as the pointer", async () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "25" } });
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_HOLD_MS.fly_here + 50);
    });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 25, { changeMode: false });
  });

  it("confirms on the held gamepad confirm button", async () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(screen.getByLabelText(/altitude/i), { target: { value: "25" } });
    await act(async () => {
      const down = [...useInputStore.getState().buttons];
      down[0] = true;
      useInputStore.setState({ buttons: down });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPEC_HOLD_MS.fly_here + 50);
    });
    useInputStore.setState({ buttons: [] });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 25, { changeMode: false });
  });

  it("sits below the top bar beside the left column on the flight screen", () => {
    const root = document.createElement("div");
    root.setAttribute("data-testid", "flight-screen");
    document.body.appendChild(root);
    try {
      open();
      const dialog = screen.getByTestId("fly-here-dialog");
      expect(dialog.style.top).toContain("var(--fs-bar-b");
      expect(dialog.className).not.toContain("bottom-4");
    } finally {
      root.remove();
    }
  });

  it("warns that the hold takes over a running mission or skill", () => {
    open();
    expect(screen.getByText(/Takes over from any running mission or skill/)).toBeTruthy();
    expect(screen.getByText("Fly here")).toBeTruthy();
  });
});
