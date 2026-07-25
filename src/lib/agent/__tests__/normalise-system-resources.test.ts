/**
 * @module normalise-system-resources.test
 * @description Unit tests for the `/api/system` → `SystemResources`
 * normalizer, covering the memory breakdown and swap fields plus the
 * older-agent default-to-zero behaviour.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { normaliseSystemResources } from "../agent-client/system";

describe("normaliseSystemResources", () => {
  it("coerces the full memory breakdown + swap fields", () => {
    const res = normaliseSystemResources({
      cpu_percent: 12.5,
      memory_percent: 30,
      memory_used_mb: 1200,
      memory_total_mb: 4096,
      memory_available_mb: 2400,
      memory_cache_mb: 820,
      swap_total_mb: 2048,
      swap_used_mb: 160,
      swap_percent: 7.8,
      disk_percent: 42,
      disk_used_gb: 13.5,
      disk_total_gb: 32,
      temperature: 45,
    });

    expect(res.memory_available_mb).toBe(2400);
    expect(res.memory_cache_mb).toBe(820);
    expect(res.swap_total_mb).toBe(2048);
    expect(res.swap_used_mb).toBe(160);
    expect(res.swap_percent).toBeCloseTo(7.8);
  });

  it("defaults the new fields to 0 on agents that predate them", () => {
    const res = normaliseSystemResources({
      cpu_percent: 5,
      memory_percent: 20,
      memory_used_mb: 800,
      memory_total_mb: 4096,
      disk_percent: 40,
    });

    expect(res.memory_available_mb).toBe(0);
    expect(res.memory_cache_mb).toBe(0);
    expect(res.swap_total_mb).toBe(0);
    expect(res.swap_used_mb).toBe(0);
    expect(res.swap_percent).toBe(0);
    // Pre-existing fields stay intact.
    expect(res.memory_used_mb).toBe(800);
    expect(res.memory_total_mb).toBe(4096);
  });

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
