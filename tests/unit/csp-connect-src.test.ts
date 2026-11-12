// @vitest-environment node
/**
 * Cesium's KTX2 transcoder fetches its WebAssembly module from an inline
 * `data:` URL; the page policy must let that fetch through or the 3D view
 * logs CSP errors and the textures it backs never decode.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

async function directive(name: string): Promise<string[]> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const csp = rules
    .flatMap((r) => r.headers)
    .find((h) => h.key === "Content-Security-Policy")?.value;
  expect(csp).toBeDefined();
  const found = csp!.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  return found ? found.split(/\s+/).slice(1) : [];
}

describe("content security policy", () => {
  it("lets connect-src read inline data: URLs", async () => {
    expect(await directive("connect-src")).toContain("data:");
  });
});
