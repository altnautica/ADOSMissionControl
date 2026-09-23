/**
 * Both ends of a mode/adjustment PWM range can be dragged with the pointer.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PwmRangeSlider, nearestThumb } from "../PwmRangeSlider";

function renderSlider(start: number, end: number) {
  const onChange = vi.fn();
  render(<PwmRangeSlider start={start} end={end} onChange={onChange} activePwm={undefined} />);
  const track = screen.getByTestId("pwm-range-track");
  // 48 steps across 480 px: 10 px per step.
  track.getBoundingClientRect = () => ({ left: 0, width: 480, top: 0, height: 32, right: 480, bottom: 32, x: 0, y: 0, toJSON: () => ({}) });
  return { onChange, track };
}

describe("PwmRangeSlider", () => {
  it("drags the start thumb when pressed left of the range", () => {
    const { onChange, track } = renderSlider(20, 30);
    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(10, 30);
  });

  it("drags the start thumb when pressed inside the range near its start", () => {
    const { onChange, track } = renderSlider(20, 40);
    fireEvent.pointerDown(track, { clientX: 220, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(22, 40);
    fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(15, 40);
  });

  it("drags the end thumb when pressed right of the range", () => {
    const { onChange, track } = renderSlider(20, 30);
    fireEvent.pointerDown(track, { clientX: 400, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(20, 40);
  });

  it("never lets the start pass the end", () => {
    const { onChange, track } = renderSlider(20, 30);
    fireEvent.pointerDown(track, { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 450, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(29, 30);
  });
});

describe("nearestThumb", () => {
  it("picks by side and distance", () => {
    expect(nearestThumb(5, 10, 30)).toBe("start");
    expect(nearestThumb(12, 10, 30)).toBe("start");
    expect(nearestThumb(28, 10, 30)).toBe("end");
    expect(nearestThumb(35, 10, 30)).toBe("end");
  });
});
