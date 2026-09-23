/**
 * @module normalise-system-resources.test
 * @description The `/api/system` → `SystemResources` mapping: the agent's
 * real bodies through the public client method (schema included), plus the
 * normaliser's absence and coercion rules.
 * @license GPL-3.0-only
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  getSystemResources,
  normaliseSystemResources,
} from "../agent-client/system";

const CTX = { baseUrl: "http://192.168.1.50:8080", apiKey: "k" };

/** The body ados-control's `derive_system` serves
 * (crates/ados-control/src/routes/system_resources.rs). */
const AGENT_SYSTEM = {
  cpu_percent: 12.5,
  cpu_count: 4,
  memory_total_mb: 3906,
  memory_used_mb: 1406,
  memory_available_mb: 2500,
  memory_cache_mb: 812,
  memory_percent: 36.0,
  swap_total_mb: 2048,
  swap_used_mb: 512,
  swap_percent: 25.0,
  disk_total_gb: 58.2,
  disk_used_gb: 14.6,
  disk_percent: 25.1,
  temperatures: { cpu_thermal: 47.5, gpu_thermal: 45.0 },
};

/** The same route's `degraded()` body: the store is unreachable, every
 * reading null, `available: false`. */
const AGENT_SYSTEM_DEGRADED = {
  cpu_percent: null,
  cpu_count: null,
  memory_total_mb: null,
  memory_used_mb: null,
  memory_available_mb: null,
  memory_cache_mb: null,
  memory_percent: null,
  swap_total_mb: null,
  swap_used_mb: null,
  swap_percent: null,
  disk_total_gb: null,
  disk_used_gb: null,
  disk_percent: null,
  temperatures: {},
  available: false,
};

function serve(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSystemResources", () => {
  it("maps the agent's /api/system body", async () => {
    serve(AGENT_SYSTEM);
    const res = await getSystemResources(CTX);
    expect(res).toEqual({
      cpu_percent: 12.5,
      memory_percent: 36,
      memory_used_mb: 1406,
      memory_total_mb: 3906,
      memory_available_mb: 2500,
      memory_cache_mb: 812,
      swap_total_mb: 2048,
      swap_used_mb: 512,
      swap_percent: 25,
      disk_percent: 25.1,
      disk_used_gb: 14.6,
      disk_total_gb: 58.2,
      temperature: 47.5,
    });
  });

  it("reports the degraded body's readings as unknown, not as idle or empty", async () => {
    serve(AGENT_SYSTEM_DEGRADED);
    const res = await getSystemResources(CTX);
    // MemAvailable / cache / swap unreported: absent, never a fabricated 0
    // that would read as "no free memory".
    expect([
      res.memory_available_mb,
      res.memory_cache_mb,
      res.swap_total_mb,
      res.swap_used_mb,
      res.swap_percent,
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect([
      res.cpu_percent,
      res.memory_percent,
      res.memory_used_mb,
      res.memory_total_mb,
      res.disk_percent,
      res.disk_used_gb,
      res.disk_total_gb,
    ]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(res.temperature).toBeNull();
  });
});

describe("normaliseSystemResources", () => {
  it("coerces string-valued numbers (NumberLike seam)", () => {
    const res = normaliseSystemResources({
      memory_available_mb: "1536",
      swap_used_mb: "64",
    } as Record<string, unknown>);

    expect(res.memory_available_mb).toBe(1536);
    expect(res.swap_used_mb).toBe(64);
  });

  it("leaves an unreported utilisation reading absent instead of 0", () => {
    // A node that sent no resource block has told us nothing about its load.
    // Reporting 0 would render as an idle CPU and an empty disk.
    const res = normaliseSystemResources({});

    expect(res.cpu_percent).toBeUndefined();
    expect(res.memory_percent).toBeUndefined();
    expect(res.disk_percent).toBeUndefined();
  });

  it("leaves an unreported capacity absent instead of 0", () => {
    const res = normaliseSystemResources({ cpu_percent: 5 });

    expect(res.memory_used_mb).toBeUndefined();
    expect(res.memory_total_mb).toBeUndefined();
    expect(res.disk_used_gb).toBeUndefined();
    expect(res.disk_total_gb).toBeUndefined();
  });

  it("keeps a genuine zero reading distinct from an absent one", () => {
    const res = normaliseSystemResources({ cpu_percent: 0, disk_used_gb: 0 });

    expect(res.cpu_percent).toBe(0);
    expect(res.disk_used_gb).toBe(0);
  });

  it("coerces string-valued utilisation readings", () => {
    const res = normaliseSystemResources({
      cpu_percent: "12.5",
      disk_total_gb: "32",
    } as Record<string, unknown>);

    expect(res.cpu_percent).toBeCloseTo(12.5);
    expect(res.disk_total_gb).toBe(32);
  });

  it("treats an unparseable reading as absent, not as NaN", () => {
    const res = normaliseSystemResources({
      cpu_percent: "not-a-number",
    } as Record<string, unknown>);

    expect(res.cpu_percent).toBeUndefined();
  });
});
