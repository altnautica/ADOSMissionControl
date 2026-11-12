/**
 * @license GPL-3.0-only
 *
 * A plugin tab whose slot mounts nothing says why instead of leaving a header
 * over a blank body: not loaded on this node yet, or not permitted.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import type { DronePluginContribution } from "@/hooks/use-drone-plugin-contributions";

const { contributionsRef, slotRef } = vi.hoisted(() => ({
  contributionsRef: { value: [] as DronePluginContribution[] },
  slotRef: { value: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/components/plugins/PluginHostProvider", () => ({
  useSlotContributions: () => slotRef.value,
}));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => contributionsRef.value,
}));
// Nothing mounts: the slot renders its empty state, as the real slot does.
vi.mock("@/components/plugins/PluginSlot", () => ({
  PluginSlot: (props: { emptyState?: React.ReactNode }) => <>{props.emptyState}</>,
}));

import { DroneDetailTabBody, pluginTabId } from "../DroneDetailTabHost";

const c: DronePluginContribution = {
  installId: "install-1",
  pluginId: "com.example.plugin",
  panelId: "tab-1",
  title: "Plugin Tab",
  order: 60,
  version: "1.0.0",
  enabled: true,
  parameters: [],
};

function renderBody() {
  contributionsRef.value = [c];
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneDetailTabBody agentId="drone-1" activeTabId={pluginTabId(c)} />
    </NextIntlClientProvider>,
  );
  return screen.getByTestId("plugin-tab-empty").textContent;
}

afterEach(() => {
  cleanup();
  slotRef.value = [];
});

describe("plugin tab empty state", () => {
  const s = messages.dronePanel.pluginSurface;

  it("says the extension is not loaded when no bundle is mounted", () => {
    expect(renderBody()).toBe(s.unavailable);
  });

  it("says the extension is not permitted when its slot grant is missing", () => {
    slotRef.value = [
      { pluginId: c.pluginId, panelId: c.panelId, pluginInstallId: c.installId, grantedCapabilities: new Set() },
    ];
    expect(renderBody()).toBe(s.notPermitted);
  });
});
