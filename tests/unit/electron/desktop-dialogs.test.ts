/**
 * Desktop dialogs: the Bluetooth device chooser and the load / startup
 * failure boxes.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import {
  bluetoothChoiceLabels,
  createBluetoothChooser,
  loadFailureDialog,
  shouldReportLoadFailure,
  startupFailureBox,
} from "../../../electron/desktop-dialogs";

/** A timer queue the test drains by hand. */
function manualTimers() {
  const queue: Array<() => void> = [];
  return {
    setTimer: (fn: () => void) => {
      queue.push(fn);
    },
    flush: () => {
      while (queue.length) queue.shift()!();
    },
    runNext: () => queue.shift()?.(),
    get size() {
      return queue.length;
    },
  };
}

describe("Bluetooth chooser", () => {
  it("labels devices by name, falling back to the id", () => {
    expect(
      bluetoothChoiceLabels([
        { deviceId: "a1", deviceName: "Radio A" },
        { deviceId: "b2", deviceName: "  " },
      ]),
    ).toEqual(["Radio A", "b2"]);
  });

  it("asks once with every device found, and connects the chosen one", () => {
    const timers = manualTimers();
    const prompt = vi.fn(() => 1);
    const choose = createBluetoothChooser(prompt, { setTimer: timers.setTimer });
    const first = vi.fn();
    const last = vi.fn();

    choose([{ deviceId: "a1", deviceName: "Radio A" }], first);
    choose(
      [
        { deviceId: "a1", deviceName: "Radio A" },
        { deviceId: "b2", deviceName: "Radio B" },
      ],
      last,
    );
    timers.flush();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith(["Radio A", "Radio B"]);
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledWith("b2");
  });

  it("cancels when the operator presses Cancel", () => {
    const timers = manualTimers();
    const choose = createBluetoothChooser(() => 1, { setTimer: timers.setTimer });
    const callback = vi.fn();
    choose([{ deviceId: "a1", deviceName: "Radio A" }], callback);
    timers.flush();
    expect(callback).toHaveBeenCalledWith("");
  });

  it("keeps scanning while nothing is found, then gives up", () => {
    const timers = manualTimers();
    const prompt = vi.fn(() => 0);
    const choose = createBluetoothChooser(prompt, {
      setTimer: timers.setTimer,
      settleMs: 1000,
      giveUpMs: 3000,
    });
    const callback = vi.fn();
    choose([], callback);
    timers.runNext();
    timers.runNext();
    expect(callback).not.toHaveBeenCalled();
    timers.flush();
    expect(prompt).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith("");
  });
});

describe("load failure", () => {
  it("reports main-frame failures but not aborted loads or subframes", () => {
    expect(shouldReportLoadFailure(-102, true)).toBe(true);
    expect(shouldReportLoadFailure(-3, true)).toBe(false);
    expect(shouldReportLoadFailure(-102, false)).toBe(false);
  });

  it("offers Retry first and Quit as cancel", () => {
    const box = loadFailureDialog("ERR_CONNECTION_REFUSED");
    expect(box.buttons).toEqual(["Retry", "Quit"]);
    expect(box.defaultId).toBe(0);
    expect(box.cancelId).toBe(1);
    expect(box.detail).toContain("ERR_CONNECTION_REFUSED");
  });
});

describe("startup failure", () => {
  it("uses the product name and names the log file instead of printing the stack", () => {
    const box = startupFailureBox("port in use", "/logs/startup-error.log");
    expect(box.title).toBe("ADOS Mission Control could not start");
    expect(box.content).toContain("/logs/startup-error.log");
    expect(box.content).toContain("port in use");
    expect(box.content).not.toMatch(/Altnautica Command/);
  });
});
