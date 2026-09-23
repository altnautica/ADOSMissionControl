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
import { activate } from "@/lib/skills";
import { useSkillRegistry } from "@/lib/skills/registry";
import { resetCooldownState } from "@/lib/skills/cooldown";
import { cancelGuidedTarget } from "@/lib/skills/guided-target";
import { flyHereSkill, parseFlyHereAltitude } from "@/lib/skills/builtins/fly-here";
import { GuidedConfirmDialog } from "@/components/flight/GuidedConfirmDialog";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useGuidedStore } from "@/stores/guided-store";
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
    flightMode: "LOITER",
    availableModes: [],
    previousMode: "LOITER",
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
  useDroneStore.setState({ armState: "armed" });
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
    expect(ctx.notify).toHaveBeenCalledWith("skills.reason.notArmed", "warning");
  });

  it("repositions an armed vehicle and supervises the target", async () => {
    await activate("fly-here", makeCtx(), { lat: 10, lon: 20, altitudeM: 30 });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 30);
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
    fireEvent.change(screen.getByLabelText(/Altitude/), { target: { value: "" } });
    const hold = screen.getByRole("button", { name: /Hold to Confirm/ });
    expect(hold).toHaveProperty("disabled", true);
    fireEvent.mouseDown(hold);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(guidedGoto).not.toHaveBeenCalled();
  });

  it("dispatches the held confirmation with the typed altitude", async () => {
    vi.useFakeTimers();
    open();
    fireEvent.change(screen.getByLabelText(/Altitude/), { target: { value: "25" } });
    fireEvent.mouseDown(screen.getByRole("button", { name: /Hold to Confirm/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(guidedGoto).toHaveBeenCalledWith(10, 20, 25);
  });
});
