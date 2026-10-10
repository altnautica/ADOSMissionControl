/**
 * Every first-party extension's default Skill binding must land bound on a
 * fresh install: a default that collides with a built-in Skill chord, a chord
 * the cockpit reserves, or another first-party extension's default is left
 * unbound by the seeding rules, so the operator would find the Skill dead.
 * Target-action keys are scoped to the open target popup, so they are checked
 * against the reserved chords and against each other.
 *
 * The fixtures are copies of each extension's `manifest.yaml`; refresh them
 * whenever a manifest's defaults change.
 *
 * @license GPL-3.0-only
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { isReservedChord, isReservedGamepadButton } from "../chord";
import {
  cloneDefaultLoadout,
  isBuiltinOrReservedChord,
} from "@/stores/settings/keybindings-slice";

const FIXTURE_DIR = join(__dirname, "fixtures", "first-party-manifests");

interface Binding {
  owner: string;
  key: string | null;
  gamepadButton: number | null;
}

interface ManifestDefaults {
  skills: Binding[];
  targetActions: Binding[];
}

function readDefaults(): ManifestDefaults {
  const skills: Binding[] = [];
  // The host's own Designate action shares the popup key space.
  const targetActions: Binding[] = [
    { owner: "builtin.designate", key: "d", gamepadButton: null },
  ];
  for (const file of readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".yaml"))) {
    const manifest = parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as {
      id: string;
      gcs?: {
        contributes?: {
          skills?: Array<{
            id: string;
            default_binding?: { key?: string; gamepad_button?: number };
          }>;
          target_actions?: Array<{ id: string; default_key?: string }>;
        };
      };
    };
    const contributes = manifest.gcs?.contributes ?? {};
    for (const skill of contributes.skills ?? []) {
      skills.push({
        owner: `${manifest.id}:${skill.id}`,
        key: skill.default_binding?.key?.toLowerCase() ?? null,
        gamepadButton: skill.default_binding?.gamepad_button ?? null,
      });
    }
    for (const action of contributes.target_actions ?? []) {
      targetActions.push({
        owner: `${manifest.id}:${action.id}`,
        key: action.default_key?.toLowerCase() ?? null,
        gamepadButton: null,
      });
    }
  }
  return { skills, targetActions };
}

function duplicates(bindings: Binding[], pick: (b: Binding) => string | number | null) {
  const seen = new Map<string | number, string>();
  const clashes: string[] = [];
  for (const b of bindings) {
    const value = pick(b);
    if (value === null) continue;
    const first = seen.get(value);
    if (first) clashes.push(`${String(value)}: ${first} and ${b.owner}`);
    else seen.set(value, b.owner);
  }
  return clashes;
}

describe("first-party extension default bindings", () => {
  const { skills, targetActions } = readDefaults();
  const builtinButtons = new Set(
    cloneDefaultLoadout().slots.flatMap((s) =>
      s.gamepadButton === null ? [] : [s.gamepadButton],
    ),
  );

  it("reads every fixture manifest", () => {
    expect(skills.length).toBeGreaterThan(0);
    expect(targetActions.length).toBeGreaterThan(0);
  });

  it("no Skill key collides with a built-in or reserved chord", () => {
    const clashes = skills
      .filter((s) => s.key !== null && isBuiltinOrReservedChord(s.key))
      .map((s) => `${s.key}: ${s.owner}`);
    expect(clashes).toEqual([]);
  });

  it("no Skill key uses alt+ (macOS Option rewrites the key)", () => {
    expect(skills.filter((s) => s.key?.includes("alt+")).map((s) => s.owner)).toEqual([]);
  });

  it("no two first-party Skills share a key or gamepad button", () => {
    expect(duplicates(skills, (s) => s.key)).toEqual([]);
    expect(duplicates(skills, (s) => s.gamepadButton)).toEqual([]);
  });

  it("no Skill gamepad default is cockpit-owned or a built-in's", () => {
    const clashes = skills
      .filter(
        (s) =>
          s.gamepadButton !== null &&
          (isReservedGamepadButton(s.gamepadButton) || builtinButtons.has(s.gamepadButton)),
      )
      .map((s) => s.owner);
    expect(clashes).toEqual([]);
  });

  it("no target-action key is reserved or shared with another action", () => {
    const reserved = targetActions
      .filter((a) => a.key !== null && isReservedChord(a.key))
      .map((a) => `${a.key}: ${a.owner}`);
    expect(reserved).toEqual([]);
    expect(duplicates(targetActions, (a) => a.key)).toEqual([]);
  });
});
