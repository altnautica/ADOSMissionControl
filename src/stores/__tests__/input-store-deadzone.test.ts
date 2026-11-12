/**
 * @license GPL-3.0-only
 *
 * The stick deadzone survives a reload like the stick mode, and an import
 * that carries one persists it too.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => localStorage.clear());

describe("input-store deadzone", () => {
  it("is read back after a reload", async () => {
    vi.resetModules();
    const first = await import("@/stores/input-store");
    first.useInputStore.getState().setDeadzone(0.15);
    vi.resetModules();
    const second = await import("@/stores/input-store");
    expect(second.useInputStore.getState().deadzone).toBeCloseTo(0.15);
  });

  it("falls back to the default for a stored value out of range", async () => {
    localStorage.setItem("ados-gamepad-deadzone", "5");
    vi.resetModules();
    const { useInputStore } = await import("@/stores/input-store");
    expect(useInputStore.getState().deadzone).toBeCloseTo(0.08);
  });

  it("an imported deadzone persists", async () => {
    vi.resetModules();
    const { exportControls, importControls } = await import("@/stores/controls-store");
    const file = { ...exportControls(), deadzone: 0.12 };
    expect(importControls(JSON.stringify(file))).toBeNull();
    vi.resetModules();
    const { useInputStore } = await import("@/stores/input-store");
    expect(useInputStore.getState().deadzone).toBeCloseTo(0.12);
  });
});
