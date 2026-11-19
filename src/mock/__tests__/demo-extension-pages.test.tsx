/**
 * The demo Capture, Reconstruct and Navigation installs mirror their
 * manifests (id, name, version, entrypoint, every page on its profiles), the
 * Capture surface stand-in is the capture monitor, the demo map budget fits
 * the drone's plugin RAM cap, and no developer fixture page is offered in
 * demo.
 *
 * @license GPL-3.0-only
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

import { CAPTURE, NAVIGATION, RECONSTRUCT, type DemoExtensionManifest } from "@/mock/extension-manifests";
import { CaptureMonitorDemo } from "@/mock/capture-monitor-demo";
import { DEMO_EXTENSION_PAGES } from "@/mock/mock-extension-pages";
import { demoMapStatus } from "@/mock/mock-nav";
import { getDemoNodePageInstallRows } from "@/mock/mock-plugins";

const raw = (m: DemoExtensionManifest) =>
  YAML.parse(m.manifestYaml) as { id: string; name: string; version: string; gcs: { entrypoint: string } };

const pagesOf = (m: DemoExtensionManifest) => {
  const pages = DEMO_EXTENSION_PAGES.find((p) => p.installRow.pluginId === raw(m).id);
  if (!pages) throw new Error(`no demo pages for ${raw(m).id}`);
  return pages;
};

const rows = (m: DemoExtensionManifest) =>
  pagesOf(m).installRow.gcsContributes.map((r) => [r.slot, r.panelId, [...(r.profile ?? [])].sort()]);

describe("demo extension installs", () => {
  it("carry each manifest's name and version", () => {
    for (const m of [CAPTURE, RECONSTRUCT, NAVIGATION]) {
      expect(pagesOf(m).installRow.name).toBe(raw(m).name);
      expect(pagesOf(m).installRow.version).toBe(raw(m).version);
    }
  });

  it("declare every page and surface on the manifests' profiles", () => {
    expect(rows(CAPTURE)).toEqual(
      expect.arrayContaining([
        ["node.surface", "capture", ["drone", "visor"]],
        ["node.agent.page", "capture-setup", ["drone", "visor"]],
        ["node.agent.page", "calibration", ["visor"]],
        ["node.agent.page", "relay", ["ground-station"]],
      ]),
    );
    expect(rows(RECONSTRUCT)).toEqual(
      expect.arrayContaining([
        ["node.surface", "reconstruct", ["compute", "workstation"]],
        ["node.agent.page", "offload", ["drone"]],
      ]),
    );
    expect(rows(NAVIGATION)).toEqual([["node.agent.page", "navigation", ["drone", "visor"]]]);
  });

  it("trust each manifest's entrypoint and version for every page body", () => {
    for (const m of [CAPTURE, RECONSTRUCT, NAVIGATION]) {
      for (const { contribution } of pagesOf(m).contributions) {
        const trust = contribution.inline?.status === "ready" ? contribution.inline.bundle.trust : null;
        expect(trust?.entrypoint).toBe(raw(m).gcs.entrypoint);
        expect(trust?.version).toBe(raw(m).version);
      }
    }
  });

  it("offer no developer fixture page", () => {
    const ids = getDemoNodePageInstallRows().map((r) => r.pluginId);
    expect(ids.some((id) => id.startsWith("com.example."))).toBe(false);
  });
});

describe("demo Capture surface", () => {
  it("is a capture monitor with inert controls", () => {
    const { container } = render(<CaptureMonitorDemo tr={(_key, fallback) => fallback} />);
    expect(container.querySelector("[data-testid='capture-capture']")).not.toBeNull();
    expect(container.querySelector("[data-testid='capture-stream']")).not.toBeNull();
    expect(container.querySelector("[data-testid='capture-reconstruction']")).not.toBeNull();
    const buttons = [...container.querySelectorAll("[data-testid='capture-controls'] button")];
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
