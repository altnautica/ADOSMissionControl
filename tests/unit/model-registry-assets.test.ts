import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The public model registry may only point at release assets that exist.
// Each published release tag the registry links to is listed here; a new
// tag is added only after its release is published.
const PUBLISHED_TAGS: Record<string, true> = {
  "vision-models-v2": true,
  "vision-models-v3": true,
};

interface Variant {
  url?: string;
  runtime?: string;
  platform?: string;
  sha256?: string;
  size_bytes?: number;
  filename?: string;
}
interface Model {
  id: string;
  task?: string;
  recommended?: boolean;
  recommended_for?: string[];
  variants: Variant[];
}

const registry = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "..", "..", "public", "models", "registry.json"),
    "utf8",
  ),
) as { models: Model[] };

describe("public model registry", () => {
  it("links only to published release tags of the extensions repository", () => {
    const tags = registry.models.flatMap((m) =>
      m.variants
        .map((v) => v.url?.match(/altnautica\/ADOSExtensions\/releases\/download\/([^/]+)\//)?.[1])
        .filter((t): t is string => Boolean(t)),
    );
    for (const tag of tags) expect(PUBLISHED_TAGS[tag], tag).toBe(true);
  });

  it("lists at least one variant per model", () => {
    for (const m of registry.models) expect(m.variants.length, m.id).toBeGreaterThan(0);
  });

  it("pins every downloadable file by size and sha256", () => {
    for (const m of registry.models) {
      for (const v of m.variants.filter((v) => v.url)) {
        expect(v.sha256, `${m.id} ${v.filename}`).toMatch(/^[0-9a-f]{64}$/);
        expect(v.size_bytes, `${m.id} ${v.filename}`).toBeGreaterThan(0);
      }
    }
  });

  it("names the NPU platform of every RKNN file", () => {
    // A .rknn file compiled for one NPU generation does not load on another;
    // the agent only picks one whose platform matches the board.
    for (const m of registry.models) {
      for (const v of m.variants.filter((v) => v.runtime === "rknn")) {
        expect(["rk3588", "rk3576"], `${m.id} ${v.filename}`).toContain(v.platform);
        expect(v.filename?.endsWith(`_${v.platform}.rknn`), `${m.id} ${v.filename}`).toBe(true);
      }
    }
  });

  it("recommends at most one model per task and runtime", () => {
    const keys = registry.models.flatMap((m) => [
      ...(m.recommended ? [`${m.task} *`] : []),
      ...(m.recommended_for ?? []).map((rt) => `${m.task} ${rt}`),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("defaults person detection to YOLOX-Tiny on the CPU and YOLOX-S on the NPU", () => {
    const byId = Object.fromEntries(registry.models.map((m) => [m.id, m]));
    expect(byId.person_yolox_tiny_v1?.recommended_for).toEqual(["onnx"]);
    expect(byId.person_yolox_s_v1?.recommended_for).toEqual(["rknn"]);
  });
});
