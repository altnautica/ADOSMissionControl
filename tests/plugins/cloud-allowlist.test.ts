/**
 * Tests for the plugin cloud.read policy gate.
 *
 * @license GPL-3.0-only
 */
import { describe, it, expect, afterEach } from "vitest";

import {
  isAllowedCloudRead,
  validateCloudArgs,
  checkCloudRateLimit,
  resetCloudRateLimits,
  ALLOWED_CLOUD_READS,
  MAX_CLOUD_ARGS_BYTES,
  MAX_CLOUD_STRING_LEN,
  CLOUD_RATE_LIMIT_MAX,
  CLOUD_RATE_LIMIT_WINDOW_MS,
} from "@/lib/plugins/cloud-allowlist";

afterEach(() => resetCloudRateLimits());

describe("cloud read allowlist", () => {
  it("accepts an on-allowlist public query", () => {
    expect(isAllowedCloudRead("clientConfig:getClientConfig")).toBe(true);
    expect(isAllowedCloudRead("communityChangelog:list")).toBe(true);
    expect(isAllowedCloudRead("communityItems:list")).toBe(true);
  });

  it("rejects off-allowlist and sensitive reads", () => {
    expect(isAllowedCloudRead("profiles:getMyProfile")).toBe(false);
    expect(isAllowedCloudRead("cmdDrones:list")).toBe(false);
    expect(isAllowedCloudRead("comments:list")).toBe(false);
    expect(isAllowedCloudRead("")).toBe(false);
  });

  it("carries only non-sensitive read names", () => {
    for (const name of ALLOWED_CLOUD_READS) {
      expect(name.startsWith("cmd")).toBe(false);
      expect(name.startsWith("profiles:")).toBe(false);
    }
  });
});

describe("validateCloudArgs", () => {
  it("accepts a small plain object", () => {
    const result = validateCloudArgs("communityChangelog:list", { limit: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args).toEqual({ limit: 10 });
  });

  it("treats null/undefined as empty args", () => {
    const a = validateCloudArgs("clientConfig:getClientConfig", undefined);
    const b = validateCloudArgs("clientConfig:getClientConfig", null);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok) expect(a.args).toEqual({});
  });

  it("rejects non-object args", () => {
    expect(validateCloudArgs("x", 42).ok).toBe(false);
    expect(validateCloudArgs("x", "hello").ok).toBe(false);
    expect(validateCloudArgs("x", [1, 2, 3]).ok).toBe(false);
    expect(validateCloudArgs("x", true).ok).toBe(false);
  });

  it("rejects args larger than the byte cap", () => {
    const big = { blob: "a".repeat(MAX_CLOUD_ARGS_BYTES + 1) };
    const result = validateCloudArgs("x", big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/size/);
  });

  it("rejects an over-long string field below the total byte cap", () => {
    // One field longer than the per-string cap but the object stays under
    // the total byte cap, so this exercises the per-field check specifically.
    const result = validateCloudArgs("x", {
      field: "b".repeat(MAX_CLOUD_STRING_LEN + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/length/);
  });

  it("rejects non-serialisable values", () => {
    const result = validateCloudArgs("x", { n: BigInt(1) });
    expect(result.ok).toBe(false);
  });
});

describe("checkCloudRateLimit", () => {
  it("allows up to the cap within one window, then trips", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < CLOUD_RATE_LIMIT_MAX; i += 1) {
      expect(checkCloudRateLimit("plugin-a", t0 + i)).toBe(true);
    }
    // The (cap + 1)-th call inside the window is denied.
    expect(checkCloudRateLimit("plugin-a", t0 + CLOUD_RATE_LIMIT_MAX)).toBe(
      false,
    );
  });

  it("resets once the window elapses", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < CLOUD_RATE_LIMIT_MAX; i += 1) {
      checkCloudRateLimit("plugin-b", t0);
    }
    expect(checkCloudRateLimit("plugin-b", t0)).toBe(false);

    const later = t0 + CLOUD_RATE_LIMIT_WINDOW_MS;
    expect(checkCloudRateLimit("plugin-b", later)).toBe(true);
  });

  it("tracks each plugin independently", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < CLOUD_RATE_LIMIT_MAX; i += 1) {
      checkCloudRateLimit("plugin-c", t0);
    }
    expect(checkCloudRateLimit("plugin-c", t0)).toBe(false);
    // A different plugin has its own fresh window.
    expect(checkCloudRateLimit("plugin-d", t0)).toBe(true);
  });

  it("reset clears all rate-limit state", () => {
    const t0 = 4_000_000;
    for (let i = 0; i < CLOUD_RATE_LIMIT_MAX; i += 1) {
      checkCloudRateLimit("plugin-e", t0);
    }
    expect(checkCloudRateLimit("plugin-e", t0)).toBe(false);

    resetCloudRateLimits();

    expect(checkCloudRateLimit("plugin-e", t0)).toBe(true);
  });
});
