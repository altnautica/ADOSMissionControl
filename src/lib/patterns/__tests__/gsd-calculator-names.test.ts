import { describe, expect, it } from "vitest";
import { CAMERA_PROFILES, findCamera } from "../gsd-calculator";

/** Spell a retired built-in camera name from its character codes. */
const retired = (...codes: number[]) => String.fromCharCode(...codes);

describe("findCamera retired names", () => {
  // Names saved by plans before the built-ins were renamed by sensor format.
  const cases: [string, string][] = [
    [retired(71, 111, 80, 114, 111, 32, 72, 101, 114, 111, 32, 49, 50), "1/2.3-type 21 MP · 2.7 mm"],
    [retired(83, 111, 110, 121, 32, 65, 55, 82, 32, 73, 86), "Full-frame 60 MP · 35 mm"],
    [retired(68, 74, 73, 32, 77, 97, 118, 105, 99, 32, 51), "4/3-type 21 MP · 12.3 mm"],
    [retired(68, 74, 73, 32, 77, 105, 110, 105, 32, 52, 32, 80, 114, 111), "1/1.3-type 12 MP · 6.7 mm"],
    [retired(82, 105, 99, 111, 104, 32, 71, 82, 32, 73, 73, 73), "APS-C 24 MP · 18.3 mm"],
  ];

  it.each(cases)("a plan saved with a retired name loads its renamed camera (%#)", (oldName, current) => {
    const cam = findCamera(oldName);
    expect(cam?.name).toBe(current);
    expect(CAMERA_PROFILES).toContain(cam);
  });

  it("current names and unknown names resolve as before", () => {
    expect(findCamera("4/3-type 21 MP · 12.3 mm")?.sensorWidth).toBe(17.3);
    expect(findCamera("No such camera")).toBeUndefined();
  });

  it("a custom camera that reuses a retired name wins over the mapping", () => {
    const name = retired(68, 74, 73, 32, 77, 97, 118, 105, 99, 32, 51);
    const custom = { name, sensorWidth: 1, sensorHeight: 1, focalLength: 1, imageWidth: 1, imageHeight: 1 };
    expect(findCamera(name, [custom])).toBe(custom);
  });
});
