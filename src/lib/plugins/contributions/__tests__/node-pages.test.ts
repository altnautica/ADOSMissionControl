/**
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseNodePageContributions } from "@/lib/plugins/contributions/node-pages";

afterEach(() => vi.restoreAllMocks());

describe("parseNodePageContributions", () => {
  it("normalizes agent pages, keeping placement and renaming setup_for", () => {
    const rows = parseNodePageContributions({
      agent_pages: [
        { id: "world-model", title: "World Model", section: "videoVision", profile: ["drone"], order: 5 },
        { id: "world-model-setup", title: "Setup", setup_for: "world-model", after: "vision" },
      ],
    });
    expect(rows).toEqual([
      {
        slot: "node.agent.page",
        panelId: "world-model",
        title: "World Model",
        section: "videoVision",
        order: 5,
        profile: ["drone"],
      },
      {
        slot: "node.agent.page",
        panelId: "world-model-setup",
        title: "Setup",
        after: "vision",
        setupFor: "world-model",
      },
    ]);
  });

  it("drops pages with an invalid id or no title", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = parseNodePageContributions({
      agent_pages: [
        { id: "Bad_Id", title: "x" },
        { id: "a".repeat(49), title: "too long" },
        { id: "no-title" },
        { id: "ok", title: "Ok" },
      ],
    });
    expect(rows.map((r) => r.panelId)).toEqual(["ok"]);
  });

  it("requires a node surface to name at least one known profile", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = parseNodePageContributions({
      node_surfaces: [
        { id: "none", title: "None" },
        { id: "unknown", title: "Unknown", profile: ["satellite"] },
        { id: "jobs", title: "Jobs", profile: ["workstation", "compute"], group: "compute", order: 20 },
        { id: "odd-group", title: "Odd", profile: ["workstation"], group: "sidebar" },
      ],
    });
    expect(rows).toEqual([
      {
        slot: "node.surface",
        panelId: "jobs",
        title: "Jobs",
        profile: ["workstation", "compute"],
        group: "compute",
        order: 20,
      },
      { slot: "node.surface", panelId: "odd-group", title: "Odd", profile: ["workstation"] },
    ]);
  });
});
