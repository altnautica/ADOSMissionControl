/**
 * @license GPL-3.0-only
 *
 * The top bar's sensing chip: the pilot's sensing tier and the speed that
 * stops inside its seen-clear range, shown only while the pilot reports them;
 * the demo pilot flies on the 3D lidar tier.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SensingChip } from "@/components/cockpit/flight/SensingChip";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot-wire";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "sensing-test";

function mount(wire: Record<string, unknown>) {
  const pilot = parsePilotState(wire);
  if (!pilot) throw new Error("pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot);
  return render(<SensingChip droneId={DRONE} />);
}

afterEach(() => {
  cleanup();
});

describe("SensingChip", () => {
  it("shows the demo pilot's 3D lidar tier and its speed limit", () => {
    mount(demoPilotWire());
    const chip = screen.getByTestId("sensing-chip");
    expect(chip.textContent).toBe("Sensing: 3D lidar · ≤ 4.2 m/s");
    expect(chip.getAttribute("data-tier")).toBe("lidar3d");
  });

  it("names each tier in the spec's words", () => {
    const cases: [string, string][] = [
      ["depth", "Sensing: Depth camera · ≤ 3 m/s"],
      ["camera", "Sensing: Camera · ≤ 3 m/s"],
      ["planar", "Sensing: 2D lidar · ≤ 3 m/s"],
    ];
    for (const [tier, text] of cases) {
      const view = mount(demoPilotWire({ sensing: { tier, clear_range_m: 6, speed_limit_mps: 3 } }));
      expect(screen.getByTestId("sensing-chip").textContent).toBe(text);
      view.unmount();
    }
  });

  it("shows nothing while the pilot reports no sensing", () => {
    mount(demoPilotWire({ sensing: undefined }));
    expect(screen.queryByTestId("sensing-chip")).toBeNull();
  });
});
