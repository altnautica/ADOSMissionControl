/**
 * The demo world-engine install mirrors its manifest (id, name, version,
 * entrypoint, every page on its profiles), the live-world stand-in shows the
 * capture monitor rather than a live map, the demo map budget fits the drone's
 * plugin RAM cap, and no developer fixture page is offered in demo.
 *
 * @license GPL-3.0-only
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { WORLD_ENGINE_TAGGED_MANIFEST } from "@/mock/extension-manifests";
import { LiveWorldMonitorDemo } from "@/mock/live-world-monitor-demo";
import { demoMapStatus } from "@/mock/mock-nav";
import { getDemoNodePageInstallRows } from "@/mock/mock-plugins";
import { DEMO_CAPTURE_INSTALL_ROW, DEMO_WORLD_ENGINE_CONTRIBUTIONS } from "@/mock/mock-visor-surfaces";

const manifest = YAML.parse(WORLD_ENGINE_TAGGED_MANIFEST) as {
  version: string;
  name: string;
  gcs: { entrypoint: string };
};

describe("demo world-engine install", () => {
  it("carries the manifest's name and version", () => {
    expect(DEMO_CAPTURE_INSTALL_ROW.name).toBe("ADOS World Engine");
    expect(DEMO_CAPTURE_INSTALL_ROW.version).toBe(manifest.version);
  });

  it("declares every page and surface on the manifest's profiles", () => {
    const rows = DEMO_CAPTURE_INSTALL_ROW.gcsContributes.map((r) => [r.slot, r.panelId, [...(r.profile ?? [])].sort()]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["node.agent.page", "world-model", ["drone"]],
        ["node.agent.page", "world-model-setup", ["drone"]],
        ["node.agent.page", "live-world", ["drone"]],
        ["node.agent.page", "offload", ["compute", "drone", "workstation"]],
        ["node.agent.page", "atlas-relay", ["ground-station"]],
        ["node.surface", "overview", ["compute", "workstation"]],
        ["node.surface", "compute", ["compute", "workstation"]],
        ["node.surface", "sessions", ["drone", "visor"]],
      ]),
    );
  });

  it("trusts the manifest's entrypoint and version for every page body", () => {
    for (const { contribution } of DEMO_WORLD_ENGINE_CONTRIBUTIONS) {
      const trust = contribution.inline?.status === "ready" ? contribution.inline.bundle.trust : null;
      expect(trust?.entrypoint).toBe(manifest.gcs.entrypoint);
      expect(trust?.version).toBe(manifest.version);
    }
  });

  it("offers no developer fixture page", () => {
    const ids = getDemoNodePageInstallRows().map((r) => r.pluginId);
    expect(ids.some((id) => id.startsWith("com.example."))).toBe(false);
  });
});

describe("demo live-world page", () => {
  it("is a capture monitor with inert controls and no live map", () => {
    const { container } = render(<LiveWorldMonitorDemo tr={(_key, fallback) => fallback} />);
    expect(container.querySelector("[data-testid='live-world-capture']")).not.toBeNull();
    expect(container.querySelector("[data-testid='live-world-stream']")).not.toBeNull();
    expect(container.querySelector("[data-testid='live-world-reconstruction']")).not.toBeNull();
    expect(container.querySelector("[data-testid='live-world-occupancy']")).toBeNull();
    const buttons = [...container.querySelectorAll("[data-testid='live-world-controls'] button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe("demo map status", () => {
  it("keeps the memory budget within the drone's 768 MB plugin cap", () => {
    for (const t of [0, 60, 600, 6000]) {
      const s = demoMapStatus(t, 10);
      expect(s.memoryBudgetMb).toBeLessThanOrEqual(768);
      expect(s.memoryUsedMb).toBeLessThanOrEqual(s.memoryBudgetMb ?? -1);
    }
  });
});
