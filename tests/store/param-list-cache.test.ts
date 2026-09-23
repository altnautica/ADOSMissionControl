/**
 * The Parameters grid's cached list must describe the drone and link it is
 * served for: a slower, superseded download of another drone (or of the same
 * drone before a reconnect) must never land in the cache.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";
import {
  PARAM_LIST_CACHE_TTL_MS,
  beginParamDownload,
  commitParamDownload,
  getCachedParamList,
  invalidateParamList,
  updateCachedParamList,
} from "@/stores/param-list-cache";

function protocol(): DroneProtocol {
  return {} as DroneProtocol;
}

function list(value: number): ParameterValue[] {
  return [{ name: "WPNAV_SPEED", value, type: 9, index: 0, count: 1 }];
}

beforeEach(() => invalidateParamList());

describe("param list cache", () => {
  it("never serves one drone's list for another drone", () => {
    const a = protocol();
    const b = protocol();
    const gen = beginParamDownload("A");
    expect(commitParamDownload("A", a, gen, list(500), 0)).toBe(true);
    expect(getCachedParamList("B", b, 1)).toBeNull();
    expect(getCachedParamList("A", a, 1)?.[0].value).toBe(500);
  });

  it("drops a download superseded by a newer one for the same drone", () => {
    const p = protocol();
    const slow = beginParamDownload("A");
    const fast = beginParamDownload("A");
    expect(commitParamDownload("A", p, fast, list(700), 0)).toBe(true);
    expect(commitParamDownload("A", p, slow, list(100), 1)).toBe(false);
    expect(getCachedParamList("A", p, 2)?.[0].value).toBe(700);
  });

  it("drops a download that finishes after its drone was forgotten", () => {
    const p = protocol();
    const gen = beginParamDownload("A");
    invalidateParamList("A");
    expect(commitParamDownload("A", p, gen, list(100), 0)).toBe(false);
    expect(getCachedParamList("A", p, 1)).toBeNull();
  });

  it("does not serve a list read over a previous link", () => {
    const before = protocol();
    const after = protocol();
    commitParamDownload("A", before, beginParamDownload("A"), list(100), 0);
    expect(getCachedParamList("A", after, 1)).toBeNull();
    updateCachedParamList("A", after, list(900), 1);
    expect(getCachedParamList("A", before, 2)?.[0].value).toBe(100);
  });

  it("expires after the TTL", () => {
    const p = protocol();
    commitParamDownload("A", p, beginParamDownload("A"), list(100), 0);
    expect(getCachedParamList("A", p, PARAM_LIST_CACHE_TTL_MS - 1)).not.toBeNull();
    expect(getCachedParamList("A", p, PARAM_LIST_CACHE_TTL_MS)).toBeNull();
  });
});
