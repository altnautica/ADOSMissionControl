/**
 * @license GPL-3.0-only
 *
 * The left column reflects the registry state of Land, Return home and
 * Pause: a disabled built-in reads `aria-disabled` with its reason as the
 * title, and a press still dispatches so the refusal toast explains it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const activate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/skills", async (orig) => ({
  ...(await orig<typeof import("@/lib/skills")>()),
  activate: (...a: unknown[]) => activate(...a),
  buildSkillContext: () => ({}),
}));

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { refusalText } from "@/lib/hud/refusal";
import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { useSkillRegistry } from "@/lib/skills";
import { useDroneStore } from "@/stores/drone-store";
import { FlightGridContext } from "@/components/cockpit/flight/flight-context";
import { flightGrid } from "@/components/cockpit/flight/flight-grid";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { LeftColumn } from "../LeftColumn";

const DRONE = "left-col-disabled";

function mount() {
  const grid = flightGrid({ width: 1280, height: 800, widthClass: widthClassFor(1280, false) });
  return renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <LeftColumn droneId={DRONE} />
    </FlightGridContext.Provider>,
  );
}

function setStates(entries: Record<string, { kind: "disabled" | "idle"; reason?: string }>) {
  useSkillRegistry.setState((s) => {
    const states = new Map(s.states);
    states.set(DRONE, new Map(Object.entries(entries)));
    return { states };
  });
}

afterEach(() => {
  cleanup();
  useSkillRegistry.setState((s) => {
    const states = new Map(s.states);
    states.delete(DRONE);
    return { states };
  });
  useDroneStore.setState({ armState: "disarmed" } as never);
  activate.mockClear();
});

describe("left column recovery buttons in a failsafe", () => {
  it("marks Pause disabled with the failsafe reason and still dispatches the press", () => {
    useDroneStore.setState({ armState: "armed" } as never);
    setStates({ pause: { kind: "disabled", reason: refusalText("failsafe") }, rth: { kind: "idle" } });
    mount();
    const pause = screen.getByLabelText(specBuiltin("pause").label);
    expect(pause.getAttribute("aria-disabled")).toBe("true");
    expect(pause.getAttribute("title")).toBe(refusalText("failsafe"));
    fireEvent.click(pause);
    expect(activate).toHaveBeenCalledWith("pause", expect.anything());
    const rth = screen.getByLabelText(specBuiltin("rth").label);
    expect(rth.hasAttribute("aria-disabled")).toBe(false);
    expect(rth.getAttribute("title")).toBe(specBuiltin("rth").label);
  });

  it("resolves a key reason through the spec table", () => {
    useDroneStore.setState({ armState: "armed" } as never);
    setStates({ rth: { kind: "disabled", reason: "refusal.failsafe" } });
    mount();
    const rth = screen.getByLabelText(specBuiltin("rth").label);
    expect(rth.getAttribute("title")).toBe(refusalText("failsafe"));
  });
});
