/**
 * @license GPL-3.0-only
 *
 * The Map tab: status card from the nav feed, the 3D viewer launch (enabled
 * only when the mapping extension contributes its viewer page) and the live
 * local-frame map.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { DroneMapTab, WORLD_VIEWER_PANEL_ID } from "@/components/drone-detail/map/DroneMapTab";
import {
  pluginPageId,
  type AgentNavContribution,
} from "@/components/dashboard/node-detail/surface-types";
import { WORLD_ENGINE_PLUGIN_ID } from "@/lib/api/agent/sensors";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useUiStore } from "@/stores/ui-store";

const DRONE = "node:map-tab-test";

const VIEWER_PAGE: AgentNavContribution = {
  id: pluginPageId(WORLD_ENGINE_PLUGIN_ID, WORLD_VIEWER_PANEL_ID),
  pluginId: WORLD_ENGINE_PLUGIN_ID,
  installId: WORLD_ENGINE_PLUGIN_ID,
  panelId: WORLD_VIEWER_PANEL_ID,
  label: "Live World",
  icon: null,
  section: "videoVision",
  order: 0,
  render: () => null,
};

function renderTab(pages: AgentNavContribution[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneMapTab droneId={DRONE} pluginAgentPages={pages} />
    </NextIntlClientProvider>,
  );
}

describe("DroneMapTab", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useUiStore.setState({ pendingDetailTab: null, pendingAgentPanel: null });
  });
  afterEach(() => cleanup());

  it("shows the empty card and an unavailable viewer without the extension", () => {
    const { container } = renderTab([]);
    expect(container.textContent).toContain(messages.hud.mapTab.noData);
    expect(container.textContent).toContain(messages.hud.mapTab.viewerUnavailable);
    expect(screen.getByRole("button", { name: messages.hud.mapTab.openViewer })).toBeDisabled();
    expect(container.querySelector(".lfmap")).not.toBeNull();
  });

  it("renders the nav-stream map status and opens the viewer page", () => {
    useNavStreamStore.getState().setMap(DRONE, {
      sessionId: "s-7",
      placement: "onboard",
      memoryUsedMb: 100,
      memoryBudgetMb: 400,
      voxelM: 0.1,
      keyframesDropped: 0,
      sweepPoints: 10,
      areaM2: 2,
      navPose: "capture",
      upload: null,
      stream: null,
    });
    const { container } = renderTab([VIEWER_PAGE]);
    expect(container.textContent).toContain("s-7");
    expect(container.textContent).toContain("During capture only");
    fireEvent.click(screen.getByRole("button", { name: messages.hud.mapTab.openViewer }));
    expect(useUiStore.getState().pendingDetailTab).toBe("agent");
    expect(useUiStore.getState().pendingAgentPanel).toBe(VIEWER_PAGE.id);
  });
});
