/**
 * @license GPL-3.0-only
 *
 * The compact minimap card in the local frame carries only the frame toggle
 * in its header (no "LOCAL · N/E" title beside it), and a card too short for
 * the zoom column hides the + / − buttons so they never sit on the toggle.
 * The full map pane keeps its title.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { specString } from "@/lib/cockpit/spec-strings";
import messages from "../../../../locales/en.json";

vi.mock("next/dynamic", () => ({
  default: () => function Stub() {
    return null;
  },
}));

import { CockpitMinimap } from "@/components/cockpit/CockpitMinimap";
import { LocalFrameMap } from "@/components/map/local/LocalFrameMap";
import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const DRONE = "node:minimap-compact";

function withIntl(node: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={messages}>{node}</NextIntlClientProvider>);
}

describe("compact minimap header", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    useMinimapModeStore.setState({ pinByVehicle: { [DRONE]: "local" } });
  });
  afterEach(() => cleanup());

  it("shows the toggle without the title in the compact card", () => {
    const { container } = withIntl(<CockpitMinimap droneId={DRONE} />);
    const head = container.querySelector(".lfmap-head")!;
    expect(head.querySelector(".mmap-seg")).not.toBeNull();
    expect(head.querySelector(".lfmap-title")).toBeNull();
    expect(head.textContent).not.toContain(specString("minimap.local_ne"));
    expect(container.querySelector(".lfmap")?.classList.contains("lfmap-compact")).toBe(true);
  });

  it("keeps the title on the full map", () => {
    const { container } = withIntl(<LocalFrameMap droneId={DRONE} />);
    expect(container.querySelector(".lfmap-title")?.textContent).toBe(specString("minimap.local_ne"));
    expect(container.querySelector(".lfmap-compact")).toBeNull();
  });

  it("hides the zoom column in a compact card too short for it", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.lfmap\.lfmap-compact\s*\{\s*container-type:\s*size;/);
    expect(css).toMatch(/@container \(max-height: 159px\) \{ \.lfmap\.lfmap-compact \.lfmap-zoom \{ display: none; \} \}/);
  });
});
