/**
 * A pack added in the registry editor reports health projected from its
 * cycle count, until the operator enters an override.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { BatteryRegistryEditor } from "@/components/config/operator/BatteryRegistryEditor";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";

describe("BatteryRegistryEditor", () => {
  beforeEach(() => {
    useBatteryRegistryStore.setState({ packs: {}, persistToIDB: vi.fn(async () => {}) });
  });

  it("decays a new pack's health with its recorded cycles", () => {
    render(<BatteryRegistryEditor />);
    fireEvent.click(screen.getByText("Add pack"));
    const [pack] = Object.values(useBatteryRegistryStore.getState().packs);
    act(() => {
      for (let i = 0; i < 300; i++) useBatteryRegistryStore.getState().recordCycle(pack.id);
    });
    expect(screen.getByText("85.0%")).toBeDefined();
  });

  it("shows the operator's override instead of the projection", () => {
    render(<BatteryRegistryEditor />);
    fireEvent.click(screen.getByText("Add pack"));
    const [pack] = Object.values(useBatteryRegistryStore.getState().packs);
    act(() => {
      useBatteryRegistryStore.getState().update(pack.id, { healthOverridePercent: 72 });
      useBatteryRegistryStore.getState().recordCycle(pack.id);
    });
    expect(screen.getByText("72.0%")).toBeDefined();
  });
});
