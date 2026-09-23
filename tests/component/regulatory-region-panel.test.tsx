/**
 * The operating-region card reads the rendered node's own capability slice and
 * opens its picker on that node's live posture: a node pinned to a region
 * never reads "Unrestricted", and a node whose slice exists while the focused
 * slice is empty still renders.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

import messages from "../../locales/en.json";
import { RegulatoryRegionPanel } from "@/components/command/system/RegulatoryRegionPanel";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useSettingsStore } from "@/stores/settings-store";

const initialState = useAgentCapabilitiesStore.getState();

function withNodeRadio(deviceId: string, fields: Record<string, unknown>) {
  const snapshot = {
    ...initialState,
    radio: normalizeRadio({ state: "connected", iface: "wlan1", ...fields }),
  };
  // The focused slice is empty (as after disconnect()); only the node's own
  // remembered slice carries its radio.
  useAgentCapabilitiesStore.setState(
    { ...initialState, radio: null, byDevice: { [deviceId]: snapshot } },
    true,
  );
}

function renderPanel(nodeDeviceId: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <RegulatoryRegionPanel nodeDeviceId={nodeDeviceId} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useAgentCapabilitiesStore.setState(initialState, true);
});

afterEach(() => {
  cleanup();
  useAgentCapabilitiesStore.setState(initialState, true);
  useSettingsStore.setState({ demoMode: false });
  useAgentConnectionStore.setState({ client: null, nodeDeviceId: null });
});

describe("RegulatoryRegionPanel", () => {
  it("opens the picker on the node's pinned region", () => {
    withNodeRadio("gs-1", { regPosture: "region", pinnedRegion: "DE" });
    renderPanel("gs-1");

    expect(screen.getAllByText("Germany (DE)").length).toBeGreaterThan(0);
    expect(screen.queryByText(messages.operatingRegion.optionUnrestricted)).toBeNull();
  });

  it("opens the picker on the free-text field for an uncommon pinned region", () => {
    withNodeRadio("gs-1", { regPosture: "region", pinnedRegion: "ZZ" });
    renderPanel("gs-1");

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("ZZ");
  });

  it("renders an unknown posture for a node never heard from", () => {
    renderPanel("gs-unknown");
    expect(screen.getByText(messages.operatingRegion.postureUnknown)).toBeDefined();
  });

  it("writes a demo region change through the demo's mock client, not the LAN proxy", async () => {
    useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
    const setConfigValue = vi.fn(async () => ({ persisted: true }));
    // The demo attaches one mock client and never sets a focused device id.
    useAgentConnectionStore.setState({ client: { setConfigValue } as never, nodeDeviceId: null });
    withNodeRadio("gs-1", { regPosture: "unrestricted" });
    renderPanel("gs-1");

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Germany \(DE\)/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: messages.operatingRegion.applyButton }));
    });
    expect(setConfigValue).toHaveBeenCalledWith("network.regulatory.mode", "region");
    expect(setConfigValue).toHaveBeenCalledWith("network.regulatory.region", "DE");
  });
});
