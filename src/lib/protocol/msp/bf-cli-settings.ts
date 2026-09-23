/**
 * Betaflight full-settings surface over the CLI (`DroneProtocol.cliSettings`).
 *
 * Betaflight has no runtime name-based settings introspection (that is iNav's
 * MSP2_COMMON_SETTING protocol), so the ~810 named settings are read and
 * written over the CLI: `dump` enumerates every setting's current value, `set`
 * stages a change in RAM, `save noreboot` persists it. Metadata (type / range /
 * enum options) comes separately from the bundled catalog; this module supplies
 * the live values only.
 *
 * @module protocol/msp/bf-cli-settings
 */

import type { CommandResult } from "../types/core";
import type { CliSetting, CliSettingChange, CliSettingsCapability } from "../types/protocol";
import type { MspCliSession } from "./cli-session";

const DUMP_TIMEOUT_MS = 12000;
const SAVE_TIMEOUT_MS = 6000;

/** Parse `set name = value` lines from `dump` output into name→value settings. */
export function parseDumpSettings(text: string): CliSetting[] {
  const out: CliSetting[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*set\s+([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ name: m[1], value: m[2] });
    }
  }
  return out;
}

/** Parse a single `get <name>` response line (`name = value`). */
export function parseGetValue(text: string, name: string): string | undefined {
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) return m[2];
  }
  return undefined;
}

/** A `set` response is an error when it names an invalid setting / value. */
function isSetError(resp: string): boolean {
  return /invalid|not found|out of range|error/i.test(resp);
}

export class BfCliSettings implements CliSettingsCapability {
  constructor(private readonly session: MspCliSession) {}

  async enumerate(): Promise<CliSetting[]> {
    await this.session.enter();
    try {
      return parseDumpSettings(await this.session.run("dump", DUMP_TIMEOUT_MS));
    } finally {
      await this.session.exit();
    }
  }

  async getSetting(name: string): Promise<string | undefined> {
    await this.session.enter();
    try {
      return parseGetValue(await this.session.run(`get ${name}`), name);
    } finally {
      await this.session.exit();
    }
  }

  async applySettings(changes: CliSettingChange[], opts?: { persist?: boolean }): Promise<CommandResult> {
    if (changes.length === 0) return { success: true, resultCode: 0, message: "No changes" };
    await this.session.enter();
    try {
      const failed: string[] = [];
      for (const c of changes) {
        const resp = await this.session.run(`set ${c.name} = ${c.value}`);
        if (isSetError(resp)) failed.push(c.name);
      }
      if (opts?.persist) await this.session.run("save noreboot", SAVE_TIMEOUT_MS);
      if (failed.length) return { success: false, resultCode: -1, message: `Rejected: ${failed.join(", ")}` };
      return { success: true, resultCode: 0, message: opts?.persist ? "Saved to flash" : "Applied to RAM" };
    } finally {
      await this.session.exit();
    }
  }
}

/** Wrap a CLI session as the firmware-agnostic `DroneProtocol.cliSettings` capability. */
export function makeCliSettingsCapability(session: MspCliSession): CliSettingsCapability {
  return new BfCliSettings(session);
}
