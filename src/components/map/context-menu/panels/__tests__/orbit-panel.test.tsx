/**
 * Typing a radius must not clamp each keystroke: "2" on the way to "20" would
 * otherwise become 5 and then 50.
 *
 * @license GPL-3.0-only
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrbitPanel } from "../OrbitPanel";

function Harness({ onConfirm }: { onConfirm: (r: number) => void }) {
  const [radius, setRadius] = useState(50);
  const [cw, setCw] = useState(true);
  return (
    <OrbitPanel
      radius={radius}
      setRadius={setRadius}
      clockwise={cw}
      setClockwise={setCw}
      onConfirm={onConfirm}
      onCancel={() => undefined}
    />
  );
}

describe("OrbitPanel radius", () => {
  afterEach(cleanup);

  it("confirms the radius as typed", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const input = screen.getByLabelText("Orbit radius") as HTMLInputElement;
    // Each keystroke appends to what the field currently shows.
    for (const key of "20") {
      const next = input.value === "50" ? key : input.value + key;
      fireEvent.change(input, { target: { value: next } });
    }
    fireEvent.click(screen.getByText("Start Orbit"));
    expect(onConfirm).toHaveBeenCalledWith(20);
  });

  it("clamps an out-of-range entry on blur", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const input = screen.getByLabelText("Orbit radius") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    expect(input.value).toBe("5");
    fireEvent.click(screen.getByText("Start Orbit"));
    expect(onConfirm).toHaveBeenCalledWith(5);
  });
});
