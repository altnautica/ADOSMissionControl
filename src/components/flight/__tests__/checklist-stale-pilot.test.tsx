/**
 * @license GPL-3.0-only
 *
 * The pre-flight checklist believes only a fresh pilot frame: once the
 * newest frame is 2 s old its readiness items read "Pilot not answering" and
 * fail, so a frozen frame can never pass the first-arm gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { ChecklistAutoRunner } from "@/components/flight/ChecklistAutoRunner";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { specString } from "@/lib/cockpit/spec-strings";
import { firstArmAllowed } from "@/lib/cockpit/preflight";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useChecklistStore } from "@/stores/checklist-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const NOW = 1_700_000_000_000;
const DRONE = "stale-pilot-checklist";

function setPilot(ageMs: number) {
  const p = parsePilotState(demoPilotWire());
  if (!p) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, p, Date.now() - ageMs);
}

const preflight = () => useChecklistStore.getState().preflight ?? [];
const pilotItems = () => preflight().filter((i) => i.id.startsWith("pilot:"));
const autoItem = (id: string) => useChecklistStore.getState().items.find((i) => i.id === id);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  useTelemetryStore.getState().clear();
  useChecklistStore.getState().resetSession();
  useDroneManager.setState({ selectedDroneId: DRONE });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useNavStreamStore.getState().clear(DRONE);
  useDroneManager.setState({ selectedDroneId: null });
});

describe("pre-flight checklist and pilot freshness", () => {
  it("takes the readiness items from a fresh frame", () => {
    setPilot(0);
    renderWithIntl(<ChecklistAutoRunner />);
    expect(pilotItems().map((i) => i.id)).toEqual(["pilot:fc_profile", "pilot:position", "pilot:agl"]);
    expect(pilotItems().every((i) => i.state === "pass")).toBe(true);
    expect(autoItem("pilot-readiness")?.status).toBe("pass");
  });

  it("fails them as 'Pilot not answering' on a 3 s old frame", () => {
    setPilot(3000);
    renderWithIntl(<ChecklistAutoRunner />);
    const items = pilotItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: "fail", label: specString("alert.pilot_not_answering") });
    expect(firstArmAllowed(preflight())).toBe(false);
    // The controller item follows the pilot's control mode, which a stale frame no longer says.
    expect(preflight().some((i) => i.id === "controller")).toBe(false);
    expect(autoItem("pilot-readiness")?.status).toBe("fail");
  });

  it("fails them once a frame crosses 2 s with no new frame", () => {
    setPilot(1500);
    renderWithIntl(<ChecklistAutoRunner />);
    expect(pilotItems().every((i) => i.state === "pass")).toBe(true);
    act(() => void vi.advanceTimersByTime(1000));
    expect(pilotItems()).toEqual([
      expect.objectContaining({ state: "fail", label: specString("alert.pilot_not_answering") }),
    ]);
  });
});
