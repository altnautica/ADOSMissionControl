/**
 * @module node-detail/node-tab-strip-plugin-tabs.test
 * @description Extension tabs sit in the same scrolling strip as the built-in
 * ones, so they follow the same rule: never shrink, never wrap. A wrapping
 * "Vision Nav" label was clipped at the strip's edge on a narrow window.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => [
    { installId: "i1", panelId: "p1", title: "Vision Nav" },
  ],
}));

import { DroneDetailTabHeaders } from "@/components/plugins/DroneDetailTabHost";

afterEach(cleanup);

describe("extension tabs in the node tab strip", () => {
  it("keep a multi-word label on one line at full width", () => {
    render(
      <DroneDetailTabHeaders
        agentId="node-1"
        activeTabId="overview"
        onSelectPluginTab={() => {}}
        nodeProfile={undefined}
      />,
    );
    const tab = screen.getByRole("tab", { name: "Vision Nav" });
    expect(tab.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["shrink-0", "whitespace-nowrap"]),
    );
  });
});
