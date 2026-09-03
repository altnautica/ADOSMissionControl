/**
 * @license GPL-3.0-only
 *
 * Tests for the Atlas World Model tab + viewport: the viewer switcher, the
 * no-reconstruction empty state, and the viewport's null-on-no-artifact gate.
 * The heavy WASM/WebGL viewers are never mounted here (artifactUrl is null), so
 * these run cleanly in jsdom.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { DroneWorldModelTab } from "@/components/drone-detail/DroneWorldModelTab";
import { WorldModelViewport } from "@/components/atlas/WorldModelViewport";
import { ATLAS_VIEWERS, DEFAULT_ATLAS_VIEWER } from "@/components/atlas/viewer-types";
import messages from "../../../../locales/en.json";

afterEach(cleanup);

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneWorldModelTab />
    </NextIntlClientProvider>,
  );
}

describe("ATLAS_VIEWERS registry", () => {
  it("ships Rerun + Splat + Cloud, Rerun first/default", () => {
    const ids = ATLAS_VIEWERS.map((v) => v.id);
    expect(ids).toContain("rerun");
    expect(ids).toContain("splat");
    // The point-cloud viewer renders .ply on the repo's three 0.183, sidestepping
    // the Potree loader's older-three pin (the historical blocker).
    expect(ids).toContain("cloud");
    expect(DEFAULT_ATLAS_VIEWER).toBe("rerun");
    expect(ATLAS_VIEWERS[0].id).toBe(DEFAULT_ATLAS_VIEWER);
  });
});

describe("DroneWorldModelTab (setup surface)", () => {
  // With no reconstruction (and no artifact) the tab renders the self-explaining
  // setup surface — a how-it-works explainer + a requirements checklist + the
  // Enable / Start capture controls — NOT the viewer switcher. The viewer only
  // takes over once a reconstruction artifact exists (a separate path that mounts
  // the heavy viewers, exercised elsewhere).
  it("shows the requirements + how-it-works setup surface with no viewer switcher", () => {
    renderTab();
    expect(
      screen.getByText(messages.atlas.capture.requirementsTitle),
    ).toBeTruthy();
    expect(
      screen.getByText(messages.atlas.capture.howItWorksTitle),
    ).toBeTruthy();
    // The viewer switcher is absent until a reconstruction exists.
    expect(screen.queryByRole("button", { name: "World" })).toBeNull();
  });

  it("lists the three capture requirements and an Enable control", () => {
    renderTab();
    expect(screen.getByText(messages.atlas.capture.reqCameras)).toBeTruthy();
    expect(screen.getByText(messages.atlas.capture.reqCompute)).toBeTruthy();
    expect(screen.getByText(messages.atlas.capture.reqService)).toBeTruthy();
    expect(screen.getByText(messages.atlas.capture.enableCapture)).toBeTruthy();
  });

  // The shared-data world model mounts INSIDE this node-detail tab, never as a
  // route or a second dashboard surface. With nothing published it reports the
  // absent state, which is not the empty-world state.
  it("mounts the shared world-model descriptor card in the setup surface", () => {
    renderTab();
    expect(screen.getByTestId("world-presence").dataset.presence).toBe("absent");
    expect(screen.getByTestId("world-stream-status")).toBeTruthy();
  });
});

describe("WorldModelViewport", () => {
  it("renders nothing without an artifact (no heavy viewer mounts)", () => {
    const { container } = render(
      <WorldModelViewport viewer="rerun" artifactUrl={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
