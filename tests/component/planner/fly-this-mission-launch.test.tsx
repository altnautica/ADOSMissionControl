/**
 * @license GPL-3.0-only
 *
 * "Fly this mission" from the planner opens the cockpit Launch sheet with
 * "start the mission" already chosen, and only once: the request is consumed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IntlWrapper } from "../../helpers/intl-wrapper";

vi.mock("@/lib/input/pilot-stream", async (orig) => ({
  ...(await orig<typeof import("@/lib/input/pilot-stream")>()),
  requestPilotAction: () => new Promise(() => {}),
}));

import { LaunchSheet } from "@/components/cockpit/v2/LaunchSheet";
import { flyThisMission } from "@/components/planner/fly-this-mission";
import { useLaunchRequestStore } from "@/stores/launch-request-store";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { specString } from "@/lib/cockpit/spec-strings";

function pilot() {
  const p = parsePilotState(demoPilotWire({}));
  if (!p) throw new Error("demo pilot wire did not parse");
  return p;
}

function renderSheet() {
  return render(
    <IntlWrapper>
      <LaunchSheet droneId="d1" pilot={pilot()} onClose={() => {}} />
    </IntlWrapper>,
  );
}

const selected = (label: string) => screen.getByText(label).closest("button")!.className.includes("text-accent-primary");

beforeEach(() => {
  useLaunchRequestStore.setState({ pending: null });
});

describe("Fly this mission → Launch sheet", () => {
  it("opens with the mission chosen after launch", () => {
    flyThisMission("d1", () => {});
    renderSheet();
    expect(selected(specString("flow.launch.after.mission"))).toBe(true);
    expect(selected(specString("flow.launch.after.hold"))).toBe(false);
    expect(useLaunchRequestStore.getState().pending).toBeNull();
  });

  it("without the request opens on hold", () => {
    renderSheet();
    expect(selected(specString("flow.launch.after.hold"))).toBe(true);
    cleanup();
  });
});
