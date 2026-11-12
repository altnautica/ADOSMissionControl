/**
 * @module hardware/hdmi-kiosk-copy.test
 * @description The HDMI kiosk card shows on ground stations and Visors, so its
 * description names "this node" rather than a ground station, in every locale.
 * @license GPL-3.0-only
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "../../../../locales");
const OLD = "Configure the HDMI kiosk the ground station shows on a wired panel";

describe("hardware.hdmiKiosk.description", () => {
  it("names the node, not a ground station, in English", () => {
    const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
    expect(en.hardware.hdmiKiosk.description).toContain("this node");
    expect(en.hardware.hdmiKiosk.description).not.toContain("ground station");
  });

  it("is updated in every locale", () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
      expect(m.hardware.hdmiKiosk.description, f).not.toContain(OLD);
    }
  });
});
