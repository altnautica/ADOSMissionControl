/**
 * The skill picker never shows raw ids: a plugin group is headed by the
 * manifest name (or the id's last part made readable), and a parameter
 * without a manifest label reads as words with its unit.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";
import { paramLabel, pluginGroupTitle } from "../SkillPicker";

describe("skill picker names", () => {
  it("heads a group with the manifest name", () => {
    expect(pluginGroupTitle("com.example.follow-me", [{ pluginId: "com.example.follow-me", title: "Follow Me" }])).toBe(
      "Follow Me",
    );
  });

  it("makes the plugin id readable when no manifest name is known", () => {
    expect(pluginGroupTitle("com.example.follow-me", [])).toBe("Follow Me");
  });

  it("labels an unlabelled parameter in words with its unit", () => {
    expect(paramLabel([{ key: "orbit_radius_m" }], "orbit_radius_m")).toBe("Orbit radius (m)");
    expect(paramLabel([{ key: "follow_angle_deg" }], "follow_angle_deg")).toBe("Follow angle (deg)");
    expect(paramLabel([{ key: "orbit_direction" }], "orbit_direction")).toBe("Orbit direction");
  });

  it("keeps the manifest label when there is one", () => {
    expect(paramLabel([{ key: "orbit_radius_m", ui: { label: "Radius" } }], "orbit_radius_m")).toBe("Radius");
  });
});
