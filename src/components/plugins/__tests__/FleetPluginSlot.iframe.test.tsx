/**
 * @license GPL-3.0-only
 *
 * End-to-end render test: a fleet contribution mounts a REAL sandboxed iframe
 * through the real `<PluginSlot>` + `<PluginIframeHost>` (no slot stub). Proves
 * the fleet host actually renders a contribution, not a placeholder. Convex is
 * absent so the slot takes the validator-off (`PluginSlotMountPlain`) branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { PluginSlotContribution } from "@/components/plugins/PluginHostProvider";
import type { PluginSlotName } from "@/lib/plugins/types";
import { slotToCapability } from "@/lib/plugins/types";
import { ToastProvider } from "@/components/ui/toast";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";

const { contributionsRef } = vi.hoisted(() => ({
  contributionsRef: {
    value: [] as Array<PluginSlotContribution & { slot: PluginSlotName }>,
  },
}));

vi.mock("@/hooks/use-fleet-plugin-contributions", () => ({
  useFleetPluginContributions: (slot?: PluginSlotName) =>
    contributionsRef.value.filter((c) => (slot ? c.slot === slot : true)),
}));

import { FleetPluginSlot } from "../FleetPluginSlot";

const DEMO_BUNDLE = "data:text/html;charset=utf-8,%3Cp%3Edemo%3C%2Fp%3E";

function contribution(
  slot: PluginSlotName,
): PluginSlotContribution & { slot: PluginSlotName } {
  return {
    slot,
    pluginId: "com.example.fleet",
    panelId: "panel-1",
    bundleUrl: DEMO_BUNDLE,
    grantedCapabilities: new Set<string>([slotToCapability(slot)]),
    handlers: {},
    pluginInstallId: "install-1",
  };
}

function renderHost() {
  return renderWithIntl(
    <ToastProvider>
      <FleetPluginSlot name="hardware.tab" />
    </ToastProvider>,
  );
}

describe("FleetPluginSlot — real iframe mount", () => {
  beforeEach(() => {
    contributionsRef.value = [];
  });

  it("mounts a sandboxed iframe at the bundle, naming its slot and panel in the fragment", () => {
    contributionsRef.value = [contribution("hardware.tab")];
    const { container } = renderHost();
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(`${DEMO_BUNDLE}#slot=hardware.tab&panel=panel-1`);
    // No allow-same-origin: the bundle runs at a null origin.
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("drops a contribution missing the slot capability (gate enforced)", () => {
    const c = contribution("hardware.tab");
    c.grantedCapabilities = new Set<string>(); // no ui.slot.hardware-tab
    contributionsRef.value = [c];
    const { container } = renderHost();
    expect(container.querySelector("iframe")).toBeNull();
  });
});
