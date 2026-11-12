/**
 * The demo map-overlay card sits in a map corner, not over the plan in the
 * middle of the map; the opaque panel bundles stay centred.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Load the fleet fixtures with the Blob URL API absent, so every bundle is a
 * readable `data:` URL. */
async function fleetBundles(): Promise<Map<string, string>> {
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: undefined }));
  // Imported after the stub: the fixtures build their bundle URLs at module
  // load, so a static import would capture blob: URLs that cannot be read.
  const { getDemoFleetPluginContributions } = await import("@/mock/mock-plugins");
  return new Map(
    getDemoFleetPluginContributions().map((c) => {
      const url = c.bundleUrl ?? "";
      const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
      return [c.slot, html];
    }),
  );
}

describe("demo fleet bundles", () => {
  it("keeps the map-overlay card out of the map centre", async () => {
    const html = (await fleetBundles()).get("map.overlay") ?? "";
    expect(html).toContain("Map overlay");
    expect(html).not.toMatch(/justify-content:center/);
    expect(html).not.toMatch(/align-items:center/);
    expect(html).toMatch(/align-items:flex-end;justify-content:flex-start/);
  });

  it("keeps the opaque panel bundles centred", async () => {
    const html = (await fleetBundles()).get("settings.section") ?? "";
    expect(html).toMatch(/align-items:center;justify-content:center/);
  });
});
