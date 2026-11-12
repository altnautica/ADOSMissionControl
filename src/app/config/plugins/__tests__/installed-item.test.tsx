/**
 * @license GPL-3.0-only
 *
 * Settings › Extensions installed rows: the status reads through the shared
 * lifecycle pill words, and a node row with no cloud detail page opens that
 * node's Agent › Extensions with the row revealed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, fireEvent } from "@testing-library/react";

import messages from "../../../../../locales/en.json";

const push = vi.fn();
const selectDrone = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({ selectDrone }),
}));
vi.mock("@/stores/node-registry/use-fleet-drones", () => ({
  useFleetDrones: (sel: (drones: unknown[]) => unknown) =>
    sel([{ id: "drone-7", cloudDeviceId: "dev-7" }]),
}));

import { InstalledItem, pillLabelFor, type InstalledRow } from "../installed-item";
import { useUiStore } from "@/stores/ui-store";

const ROW: InstalledRow = {
  key: "dev-7::com.example.thermal",
  pluginId: "com.example.thermal",
  name: "Thermal",
  version: "1.2.0",
  status: "running",
  deviceId: "dev-7",
};

function renderRow(row: InstalledRow) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InstalledItem install={row} />
    </NextIntlClientProvider>,
  );
}

describe("Settings extensions installed row", () => {
  beforeEach(() => {
    push.mockReset();
    selectDrone.mockReset();
    useUiStore.setState({ pendingDetailTab: null, pendingAgentPanel: null, pendingPluginId: null } as never);
  });

  it("shows the localized lifecycle word, not the raw status", () => {
    renderRow(ROW);
    expect(screen.getByText(messages.dronePlugins.status.running)).toBeTruthy();
  });

  it("maps statuses the pill has no word for to disabled", () => {
    expect(pillLabelFor("removed")).toBe("disabled");
    expect(pillLabelFor("crashed")).toBe("crashed");
  });

  it("opens the node's Extensions page with the row revealed", () => {
    renderRow(ROW);
    fireEvent.click(screen.getByRole("button"));
    expect(selectDrone).toHaveBeenCalledWith("drone-7");
    const ui = useUiStore.getState();
    expect(ui.pendingDetailTab).toBe("agent");
    expect(ui.pendingAgentPanel).toBe("plugins");
    expect(ui.pendingPluginId).toBe("com.example.thermal");
    expect(push).toHaveBeenCalledWith("/");
  });

  it("leaves a ground-station-only install without a node link", () => {
    renderRow({ ...ROW, deviceId: null });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
