import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CompassProgressDisplay, compassProgressEntries } from "../compass-display";

afterEach(cleanup);

function compass(direction?: { x: number; y: number; z: number }) {
  return {
    compassProgress: new Map([[0, 40]]),
    compassStatus: new Map([[0, 2]]),
    compassCompletionMask: new Map<number, number[]>(),
    compassDirection: new Map(direction ? [[0, direction]] : []),
  };
}

describe("compass calibration angular rate", () => {
  it("shows no rate and no rotation hint before the vehicle reports one", () => {
    render(<CompassProgressDisplay entries={compassProgressEntries(compass())} />);
    for (const axis of ["x", "y", "z"]) {
      expect(screen.getByTestId(`compass-0-rate-${axis}`).textContent).toBe("\u2014");
    }
    expect(screen.queryByText(/(Yaw|Roll) (LEFT|RIGHT)|Tilt nose/)).toBeNull();
  });

  it("shows the reported rate and the rotation hint it implies", () => {
    render(<CompassProgressDisplay entries={compassProgressEntries(compass({ x: 0.1, y: 0, z: 1.2 }))} />);
    expect(screen.getByTestId("compass-0-rate-z").textContent).toBe("1.20");
    expect(screen.getByText("Yaw RIGHT")).toBeTruthy();
  });
});
