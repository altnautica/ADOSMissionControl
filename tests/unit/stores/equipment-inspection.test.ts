import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";

describe("equipment inspection interval", () => {
  beforeEach(() => {
    useEquipmentRegistryStore.setState({ items: {}, persistToIDB: vi.fn(async () => {}) });
    useEquipmentRegistryStore.getState().upsert({
      id: "props",
      type: "prop_set",
      label: "Props",
      totalFlightHours: 0,
      inspectionIntervalHours: 25,
    });
  });

  it("clears the due state when marked inspected and re-arms after another interval", () => {
    const store = () => useEquipmentRegistryStore.getState();
    store().recordFlight("props", 25 * 3600);
    expect(store().isInspectionDue("props")).toBe(true);

    store().markInspected("props", "2026-01-01");
    expect(store().isInspectionDue("props")).toBe(false);

    store().recordFlight("props", 24 * 3600);
    expect(store().isInspectionDue("props")).toBe(false);
    store().recordFlight("props", 1 * 3600);
    expect(store().isInspectionDue("props")).toBe(true);
  });
});
