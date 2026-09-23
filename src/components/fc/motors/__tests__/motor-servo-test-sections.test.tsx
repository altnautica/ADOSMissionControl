/**
 * Bench-test controls report what the FC did and drive the output the operator
 * picked: a refused motor test is not "complete", servo rows keep the FC's own
 * output numbers around GPIO pins, and a slider drag does not flood the
 * acknowledged command queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";
import type { OutputRow } from "../../misc/ServoMappingTable";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

import { MotorTestSection } from "../MotorTestSection";
import { ServoTestSection } from "../ServoTestSection";
import { ServoCommandCoalescer } from "../servo-command-coalescer";

const ROW: OutputRow = { function: 33, min: 1000, max: 2000, trim: 1500, reversed: false };

function ok(): Promise<CommandResult> {
  return Promise.resolve({ success: true, resultCode: 0, message: "ok" });
}

beforeEach(() => toast.mockClear());

describe("MotorTestSection", () => {
  it("reports a refused test as not run, never as complete", async () => {
    const protocol = {
      motorTest: vi.fn(async (): Promise<CommandResult> => ({
        success: false, resultCode: 2, message: "Command denied",
      })),
    } as Partial<DroneProtocol> as DroneProtocol;
    render(<MotorTestSection protocol={protocol} isHardBlocked={false} hardBlockMessage="" />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /Test Motor 1/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const [message, level] = toast.mock.calls[0];
    expect(level).toBe("error");
    expect(message).toContain("Command denied");
    expect(message).not.toMatch(/complete/i);
  });
});

describe("ServoTestSection", () => {
  it("keeps the FC output number for every row after a GPIO output", () => {
    const setServo = vi.fn(ok);
    const protocol = { setServo } as Partial<DroneProtocol> as DroneProtocol;
    const outputs: (OutputRow | null)[] = Array.from({ length: 16 }, () => ROW);
    outputs[15] = null;
    render(
      <ServoTestSection
        protocol={protocol}
        isHardBlocked={false}
        hardBlockMessage=""
        outputs={outputs}
        gpioOutputs={new Set([3])}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByLabelText("Servo 3 PWM")).toBeNull();
    expect(screen.queryByLabelText("Servo 16 PWM")).toBeNull();
    fireEvent.change(screen.getByLabelText("Servo 4 PWM"), { target: { value: "1600" } });
    expect(setServo).toHaveBeenCalledWith(4, 1600);
  });
});

describe("ServoCommandCoalescer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps one command in flight and sends only the latest value", async () => {
    const setServo = vi.fn(ok);
    const sender = new ServoCommandCoalescer(setServo, 100);
    for (let pwm = 1500; pwm <= 1590; pwm += 10) sender.request(4, pwm);
    expect(setServo).toHaveBeenCalledTimes(1);
    expect(setServo).toHaveBeenLastCalledWith(4, 1500);
    await vi.advanceTimersByTimeAsync(100);
    expect(setServo).toHaveBeenCalledTimes(2);
    expect(setServo).toHaveBeenLastCalledWith(4, 1590);
    await vi.advanceTimersByTimeAsync(500);
    expect(setServo).toHaveBeenCalledTimes(2);
  });
});
