import { describe, it, expect } from "vitest";
import { normalizeCapabilities } from "../normalizer";

describe("normalizeCapabilities unreported compute figures", () => {
  it("keeps NPU load null when the agent does not report it", () => {
    const caps = normalizeCapabilities({ tier: 4, compute: { npu_tops: 6 } });
    expect(caps.compute.npu_available).toBe(true);
    expect(caps.compute.npu_utilization_pct).toBeNull();
  });

  it("forwards a reported NPU load, including a genuine zero", () => {
    expect(
      normalizeCapabilities({ tier: 4, compute: { npu_tops: 6, npu_utilization_pct: 42.5 } })
        .compute.npu_utilization_pct,
    ).toBe(42.5);
    expect(
      normalizeCapabilities({ tier: 4, compute: { npu_tops: 6, npu_utilization_pct: 0 } })
        .compute.npu_utilization_pct,
    ).toBe(0);
  });

  it("keeps the model cache ceiling null when the agent does not report it", () => {
    const caps = normalizeCapabilities({
      tier: 4,
      models: { installed: [], cache_used_mb: 12 },
    });
    expect(caps.models.cache_max_mb).toBeNull();
    expect(caps.models.cache_used_mb).toBe(12);
  });
});
