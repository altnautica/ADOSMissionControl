/** Occupancy tile recolouring and CSS colour parsing. */

import { describe, expect, it } from "vitest";

import { FREE_ALPHA, OCCUPIED_ALPHA, parseCssColor, recolourOccupancy, withAlpha } from "../occupancy-bitmap";

function grey(...values: number[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, i) => out.set([v, v, v, 255], i * 4));
  return out;
}

describe("parseCssColor", () => {
  it("reads hex and rgb()/rgba() forms", () => {
    expect(parseCssColor("#EDEDED")).toEqual([237, 237, 237, 255]);
    expect(parseCssColor("#fff")).toEqual([255, 255, 255, 255]);
    expect(parseCssColor("#00000080")).toEqual([0, 0, 0, 128]);
    expect(parseCssColor("rgba(255, 255, 255, 0.16)")).toEqual([255, 255, 255, 41]);
    expect(parseCssColor("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 128]);
  });

  it("returns null for syntaxes it does not read", () => {
    expect(parseCssColor("oklch(0.9 0 0)")).toBeNull();
    expect(parseCssColor("")).toBeNull();
    expect(parseCssColor("#12345")).toBeNull();
  });
});

describe("recolourOccupancy", () => {
  const ink = [237, 237, 237, 255] as const;
  const occupied = withAlpha(ink, OCCUPIED_ALPHA);
  const free = withAlpha(ink, FREE_ALPHA);

  it("paints occupied ≤ 100 at 90 %, free ≥ 230 at 10 % and unknown transparent", () => {
    const px = recolourOccupancy(grey(0, 100, 101, 229, 230, 255), occupied, free);
    const alpha = (i: number) => px[i * 4 + 3];
    expect(alpha(0)).toBe(230);
    expect(alpha(1)).toBe(230);
    expect(alpha(2)).toBe(0);
    expect(alpha(3)).toBe(0);
    expect(alpha(4)).toBe(26);
    expect(alpha(5)).toBe(26);
    expect([...px.slice(0, 3)]).toEqual([237, 237, 237]);
  });

  it("keeps a transparent source pixel transparent", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0]);
    expect([...recolourOccupancy(px, occupied, free)]).toEqual([0, 0, 0, 0]);
  });
});
