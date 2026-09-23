/**
 * @license GPL-3.0-only
 *
 * The shared named-icon registry resolves each vocabulary name to a real lucide
 * glyph, and the corrected entries (circle / circle-stop / zoom) map to their
 * intended glyphs rather than a stand-in.
 */

import { describe, it, expect } from "vitest";
import { Circle, CircleStop, Orbit, ZoomIn } from "lucide-react";

import {
  resolveNamedIcon,
  hasNamedIcon,
  normalizeIconName,
  FALLBACK_ICON,
} from "../icon-registry";

describe("icon-registry vocabulary corrections", () => {
  it("circle resolves to Circle, not Orbit", () => {
    expect(resolveNamedIcon("circle")).toBe(Circle);
    expect(resolveNamedIcon("circle")).not.toBe(Orbit);
  });

  it("orbit still resolves to Orbit", () => {
    expect(resolveNamedIcon("orbit")).toBe(Orbit);
  });

  it("circle-stop / stop-follow resolve to CircleStop", () => {
    expect(resolveNamedIcon("circle-stop")).toBe(CircleStop);
    expect(resolveNamedIcon("circlestop")).toBe(CircleStop);
    expect(resolveNamedIcon("stop-follow")).toBe(CircleStop);
  });

  it("zoom resolves to a real zoom glyph (ZoomIn)", () => {
    expect(resolveNamedIcon("zoom")).toBe(ZoomIn);
  });

  it("normalizes separators and casing before lookup", () => {
    expect(resolveNamedIcon("Circle-Stop")).toBe(CircleStop);
    expect(normalizeIconName("Zoom In")).toBe("zoomin");
  });

  it("an unknown name falls back rather than crashing", () => {
    expect(resolveNamedIcon("not-a-real-icon")).toBe(FALLBACK_ICON);
    expect(hasNamedIcon("not-a-real-icon")).toBe(false);
    expect(hasNamedIcon("circle-stop")).toBe(true);
  });

  it("never resolves an inherited Object member from a manifest name", () => {
    for (const name of ["constructor", "Constructor", "con-structor", "toString", "__proto__"]) {
      expect(resolveNamedIcon(name)).toBe(FALLBACK_ICON);
      expect(hasNamedIcon(name)).toBe(false);
    }
  });
});
