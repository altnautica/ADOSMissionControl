/**
 * Locale content checks beyond key parity: translated map-tab words, removed
 * dead keys, a uniform German flight screen, and the shared wording picked for
 * transfers, devices, reboots and extensions.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const LOCALES_DIR = resolve(__dirname, "../../locales");

type Tree = Record<string, unknown>;

function load(code: string): Tree {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), "utf-8")) as Tree;
}

function get(tree: Tree, path: string): unknown {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Tree)[part];
  }
  return node;
}

const en = load("en");
const others = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith(".json") && f !== "en.json")
  .map((f) => f.replace(/\.json$/, ""));

/** Map-tab entries that are pure formats, the same in every language. */
const MAP_TAB_FORMATS: Record<string, true> = { memoryValue: true };

describe("locale wording", () => {
  it.each(others)("%s translates the map tab", (code) => {
    const enTab = get(en, "hud.mapTab") as Record<string, string>;
    const tab = get(load(code), "hud.mapTab") as Record<string, string>;
    const untranslated = Object.keys(enTab).filter(
      (k) => !MAP_TAB_FORMATS[k] && tab[k] === enTab[k],
    );
    expect(untranslated).toEqual([]);
  });

  it.each(["en", ...others])("%s carries no dead status-pill keys", (code) => {
    expect(get(load(code), "flightScreen.pill")).toBeUndefined();
  });

  it("keeps the German flight-screen backfill uniformly English", () => {
    expect(get(load("de"), "cockpit.pip.reconnecting")).toBe(get(en, "cockpit.pip.reconnecting"));
  });

  it.each(others)("%s translates the map-view and fleet-overview labels", (code) => {
    const t = load(code);
    for (const key of ["cockpit.openMapView", "fleet.overview"]) {
      expect(typeof get(t, key)).toBe("string");
      expect(get(t, key)).not.toBe(get(en, key));
    }
  });

  it("uses one verb pair for mission transfer", () => {
    for (const key of ["planner.bar.send", "planner.send.title", "planner.commands.sendToVehicle"]) {
      expect(get(en, key)).toBe("Upload to drone");
    }
    for (const key of ["planner.bar.downloadFromDrone", "planner.downloadFromFc", "flightScreen.planBanner.load"]) {
      expect(get(en, key)).toBe("Download from drone");
    }
    expect(get(en, "planner.missionUploaded")).toBe("Mission uploaded to drone");
  });

  it("uses one label for adding a node", () => {
    for (const key of [
      "fleet.addDrone",
      "command.pairNewNode",
      "command.pairNode",
      "disconnectedPage.pairANode",
      "nodeConsole.companionCta.action",
      "dronePanel.agentShowcase.cta",
    ]) {
      expect(get(en, key)).toBe("Add a node");
    }
  });

  it("names the companion computer one way", () => {
    const flat = JSON.stringify(en);
    expect(flat).not.toMatch(/onboard computer|companion board|Pair a computer/i);
  });

  it("names the flight-controller reboot in full and calls extensions extensions", () => {
    for (const key of ["droneDetail.rebootFc", "dronePanel.rebootFc", "parameters.rebootConfirmLabel"]) {
      expect(get(en, key)).toBe("Reboot flight controller");
    }
    expect(get(en, "vision.targetActions.pluginBadge")).toBe("extension");
  });
});
