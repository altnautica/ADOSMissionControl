/**
 * The Operator settings page and the shared calibration wizard render every
 * label through the translator, and registry deletes/retires ask through the
 * in-app danger dialog instead of the browser's native confirm.
 *
 * The translator here echoes `namespace.key`, so any English literal left in
 * the markup is visible as plain text and fails the assertions.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OperatorProfileEditor } from "@/components/config/operator/OperatorProfileEditor";
import { AircraftRegistryEditor } from "@/components/config/operator/AircraftRegistryEditor";
import { BatteryRegistryEditor } from "@/components/config/operator/BatteryRegistryEditor";
import { EquipmentRegistryEditor } from "@/components/config/operator/EquipmentRegistryEditor";
import { CalibrationWizard } from "@/components/fc/calibration/CalibrationWizard";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

const ENGLISH_LITERALS = [
  "Pilot", "First name", "Organisation", "Insurance", "Defaults", "Not set",
  "Aircraft", "Add aircraft", "Batteries", "Add pack", "Show retired",
  "Equipment", "Add item", "All types",
];

function expectNoEnglish() {
  for (const text of ENGLISH_LITERALS) {
    expect(screen.queryByText(text, { exact: true })).toBeNull();
  }
}

describe("Operator page i18n", () => {
  beforeEach(() => {
    useAircraftRegistryStore.setState({ aircraft: {}, persistToIDB: vi.fn(async () => {}) });
    useBatteryRegistryStore.setState({ packs: {}, persistToIDB: vi.fn(async () => {}) });
    useEquipmentRegistryStore.setState({ items: {}, persistToIDB: vi.fn(async () => {}) });
  });

  it("renders the four editors through operatorRegistry keys", () => {
    render(
      <>
        <OperatorProfileEditor />
        <AircraftRegistryEditor />
        <BatteryRegistryEditor />
        <EquipmentRegistryEditor />
      </>,
    );
    expectNoEnglish();
    expect(screen.getByText("operatorRegistry.profile.pilot")).toBeDefined();
    expect(screen.getByText("operatorRegistry.aircraft.add")).toBeDefined();
    expect(screen.getByText("operatorRegistry.battery.add")).toBeDefined();
    expect(screen.getByText("operatorRegistry.equipment.add")).toBeDefined();
  });

  it("asks through the danger dialog before deleting, never window.confirm", () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    render(<AircraftRegistryEditor />);
    fireEvent.click(screen.getByText("operatorRegistry.aircraft.add"));
    expect(Object.keys(useAircraftRegistryStore.getState().aircraft)).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "operatorRegistry.aircraft.delete" }));
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(Object.keys(useAircraftRegistryStore.getState().aircraft)).toHaveLength(1);
    expect(screen.getByText("operatorRegistry.aircraft.deleteMessage")).toBeDefined();

    const confirmButtons = screen.getAllByRole("button", { name: "operatorRegistry.aircraft.delete" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(Object.keys(useAircraftRegistryStore.getState().aircraft)).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("retires a battery pack only after the dialog confirms", () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    render(<BatteryRegistryEditor />);
    fireEvent.click(screen.getByText("operatorRegistry.battery.add"));
    fireEvent.click(screen.getByRole("button", { name: "operatorRegistry.battery.retire" }));
    expect(nativeConfirm).not.toHaveBeenCalled();
    const [pack] = Object.values(useBatteryRegistryStore.getState().packs);
    expect(pack.retiredAt).toBeUndefined();
    expect(screen.getByText("operatorRegistry.battery.retireMessage")).toBeDefined();
    vi.unstubAllGlobals();
  });
});

describe("Calibration wizard i18n", () => {
  const base = { title: "T", description: "D", steps: [], currentStep: 0, onStart: vi.fn(), onCancel: vi.fn() };

  it("labels its buttons and status badge through fcCalibration.wizard keys", () => {
    const { rerender } = render(<CalibrationWizard {...base} status="idle" preTips={["tip"]} />);
    expect(screen.getByRole("button", { name: "fcCalibration.wizard.start" })).toBeDefined();
    expect(screen.getByText("fcCalibration.wizard.status.idle")).toBeDefined();
    expect(screen.getByText("fcCalibration.wizard.beforeYouStart")).toBeDefined();
    expect(screen.queryByText("Start")).toBeNull();

    rerender(<CalibrationWizard {...base} status="in_progress" waitingForConfirm onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "fcCalibration.wizard.confirmPosition" })).toBeDefined();
    expect(screen.getByRole("button", { name: "fcCalibration.wizard.cancel" })).toBeDefined();
    expect(screen.queryByText("Confirm Position")).toBeNull();
  });
});
