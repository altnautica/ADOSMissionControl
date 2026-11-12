/**
 * @module shared/add-node-wording.test
 * @description One word per destination: the command palette names the nav
 * destinations by their nav labels, and every entry to the add surface says
 * "Add a node", in every locale.
 * @license GPL-3.0-only
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(__dirname, "../../../../locales");
type Messages = Record<string, Record<string, unknown>>;
const get = (m: Messages, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], m);

const ADD_SURFACE = [
  "commandPalette.connectDrone",
  "connect.title",
  "command.pairing.tab.addDrone",
  "dashboard.quickActionsBar.connectDrone",
  "fleet.addDrone",
];

describe("add surface and palette wording", () => {
  const locales = readdirSync(dir).filter((n) => n.endsWith(".json"));

  it.each(locales)("%s: every add entry uses the add-node title", (f) => {
    const m = JSON.parse(readFileSync(join(dir, f), "utf8")) as Messages;
    const title = get(m, "command.pairNode");
    for (const path of ADD_SURFACE) expect(get(m, path), path).toBe(title);
  });

  it("names palette destinations by their nav labels in English", () => {
    const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8")) as Messages;
    expect(get(en, "commandPalette.goToPlan")).toBe(`Go to ${get(en, "nav.plan")}`);
    expect(get(en, "commandPalette.goToHistory")).toBe(`Go to ${get(en, "nav.history")}`);
  });
});
