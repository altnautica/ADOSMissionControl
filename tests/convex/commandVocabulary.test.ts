/**
 * Contract tests for the cloud-relay command vocabulary.
 *
 * enqueueCommand validates the command name against this union at the queue
 * boundary so a typo or a forged name cannot land a dead row. These tests pin
 * (a) that the union validator accepts every permitted name and rejects an
 * unknown one at runtime, and (b) that enqueueCommand wires the validator
 * instead of a free-form v.string().
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AGENT_CONTROL_VERB_SCOPE,
  RELAY_COMMAND_NAMES,
  RELAY_COMMAND_SCOPE,
  relayCommandValidator,
  requiredScopeForCommand,
} from "../../convex/commandVocabulary";

describe("relay command vocabulary", () => {
  it("includes the plugin lifecycle, WFB pairing, and status-pull commands", () => {
    // The set the agent dispatcher acts on + the GCS call sites queue.
    for (const name of [
      "plugin.install",
      "plugin.enable",
      "plugin.disable",
      "plugin.uninstall",
      "wfb_pair_init_remote",
      "wfb_pair_apply_remote",
      "wfb_pair_unpair",
      "get_peripherals",
      "scan_peripherals",
      "get_enrollment",
      "get_peers",
      "get_services",
      "get_logs",
      "restart_service",
      "send_command",
    ]) {
      expect(RELAY_COMMAND_NAMES).toContain(name);
    }
  });

  it("exposes a union validator over exactly the permitted names", () => {
    // The validator's member literals must match the name list one-for-one so
    // adding a name in the array keeps the validator in sync.
    expect(relayCommandValidator.kind).toBe("union");
    const literals = relayCommandValidator.members.map(
      (m: { value: unknown }) => m.value,
    );
    expect([...literals].sort()).toEqual([...RELAY_COMMAND_NAMES].sort());
  });

  it("has no duplicate names", () => {
    const unique = new Set(RELAY_COMMAND_NAMES);
    expect(unique.size).toBe(RELAY_COMMAND_NAMES.length);
  });
});

describe("relay command scope classes", () => {
  it("assigns every relay command a scope class (exhaustive map)", () => {
    for (const name of RELAY_COMMAND_NAMES) {
      expect(RELAY_COMMAND_SCOPE[name]).toBeDefined();
    }
  });

  it("classifies read pulls as read and admin ops as admin", () => {
    expect(requiredScopeForCommand("get_logs", {})).toBe("read");
    expect(requiredScopeForCommand("get_peers", {})).toBe("read");
    expect(requiredScopeForCommand("restart_service", {})).toBe("admin");
    expect(requiredScopeForCommand("plugin.install", {})).toBe("admin");
    expect(requiredScopeForCommand("scan_peripherals", {})).toBe("safe_write");
  });

  // Every verb the agent's POST /api/command route accepts: the arms of the
  // `match cmd` in `build_command` (crates/ados-control/src/routes/command.rs),
  // each with the scope it must require. Update this list when that match changes.
  const AGENT_COMMAND_VERBS: ReadonlyArray<readonly [string, string]> = [
    ["arm", "flight"],
    ["disarm", "flight"],
    ["takeoff", "flight"],
    ["land", "flight"],
    ["rtl", "flight"],
    ["killswitch", "flight"],
    ["pausemission", "flight"],
    ["resumemission", "flight"],
    ["mode", "flight"],
  ];

  it("maps every agent control verb to its scope, and nothing more", () => {
    for (const [cmd, scope] of AGENT_COMMAND_VERBS) {
      expect(requiredScopeForCommand("send_command", { cmd, args: [] }), cmd).toBe(scope);
    }
    expect(Object.keys(AGENT_CONTROL_VERB_SCOPE).sort()).toEqual(
      AGENT_COMMAND_VERBS.map(([cmd]) => cmd).sort(),
    );
  });

  it("requires the flight scope to pause or resume a mission", () => {
    expect(requiredScopeForCommand("send_command", { cmd: "resumemission" })).toBe("flight");
    expect(requiredScopeForCommand("send_command", { cmd: "pausemission" })).toBe("flight");
  });

  it("matches verbs case-insensitively, as the agent lowercases them", () => {
    expect(requiredScopeForCommand("send_command", { cmd: "ResumeMission" })).toBe("flight");
    expect(requiredScopeForCommand("send_command", { cmd: "ARM" })).toBe("flight");
  });

  it("refuses an unknown verb or a malformed payload", () => {
    for (const args of [
      { cmd: "get_battery" },
      { cmd: "constructor" },
      { cmd: "" },
      {},
      { cmd: 123 },
      null,
    ]) {
      expect(requiredScopeForCommand("send_command", args), JSON.stringify(args)).toBeNull();
    }
  });
});

describe("enqueueCommand command-name gate", () => {
  it("validates command against the vocabulary instead of a free-form string", async () => {
    const text = await readFile(
      path.join(process.cwd(), "convex/cmdDroneCommands.ts"),
      "utf8",
    );
    expect(text).toContain('import { relayCommandValidator } from "./commandVocabulary"');
    expect(text).toContain("command: relayCommandValidator,");
    // The free-form validator must be gone from the public enqueue boundary.
    expect(text).not.toContain("command: v.string(),");
  });
});
