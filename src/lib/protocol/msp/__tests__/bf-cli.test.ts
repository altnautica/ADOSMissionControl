/**
 * @module protocol/msp/bf-cli.test
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MspCliSession, BETAFLIGHT_CLI, INAV_CLI, type CliDialect, type CliIo } from "../cli-session";
import { BfCliSettings, parseDumpSettings, parseGetValue } from "../bf-cli-settings";

/** A scripted FC that answers each CLI command with prompt-terminated text. */
class FakeIo implements CliIo {
  sent: string[] = [];
  raw: string[] = [];
  active: boolean[] = [];
  session!: MspCliSession;
  constructor(private readonly responder: (cmd: string) => string) {}
  send(bytes: Uint8Array): void {
    const text = new TextDecoder().decode(bytes);
    this.raw.push(text);
    const cmd = text.trim();
    this.sent.push(cmd);
    // Deliver synchronously so the prompt fast-path resolves without timers.
    this.session.feed(new TextEncoder().encode(this.responder(cmd)));
  }
  setActive(active: boolean): void {
    this.active.push(active);
  }
}

function makeSession(
  responder: (cmd: string) => string,
  dialect: CliDialect = BETAFLIGHT_CLI,
): { session: MspCliSession; io: FakeIo } {
  const io = new FakeIo(responder);
  const session = new MspCliSession(io, dialect);
  io.session = session;
  return { session, io };
}

describe("parseDumpSettings", () => {
  it("parses `set name = value` lines and ignores comments/dedupes", () => {
    const dump = [
      "# version",
      "# Betaflight / STM32F405",
      "set gyro_hardware_lpf = NORMAL",
      "set gyro_lpf1_static_hz = 250",
      "set motor_pwm_protocol = DSHOT600",
      "set gyro_hardware_lpf = NORMAL", // duplicate — kept once
      "feature -RX_PARALLEL_PWM",
      "# ",
    ].join("\n");
    const out = parseDumpSettings(dump);
    expect(out).toEqual([
      { name: "gyro_hardware_lpf", value: "NORMAL" },
      { name: "gyro_lpf1_static_hz", value: "250" },
      { name: "motor_pwm_protocol", value: "DSHOT600" },
    ]);
  });
});

describe("parseGetValue", () => {
  it("extracts the value line for a named setting", () => {
    const text = "gyro_hardware_lpf = NORMAL\nAllowed values: NORMAL, OPTION_1\n# ";
    expect(parseGetValue(text, "gyro_hardware_lpf")).toBe("NORMAL");
    expect(parseGetValue(text, "nonexistent")).toBeUndefined();
  });
});

describe("MspCliSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enters, runs a command, and exits without reboot", async () => {
    const { session, io } = makeSession((cmd) => {
      if (cmd === "#") return "Entering CLI Mode\r\n# ";
      if (cmd === "dump") return "set a = 1\r\nset b = 2\r\n# ";
      return "\r\n# ";
    });
    await session.enter();
    expect(session.isActive).toBe(true);
    const out = await session.run("dump");
    expect(out).toContain("set a = 1");
    await session.exit();
    expect(session.isActive).toBe(false);
    expect(io.sent).toEqual(["#", "dump", "exit noreboot"]);
    expect(io.active).toEqual([true, false]); // pauses then resumes MSP
  });

  it("enters the CLI on the first typed command, streams replies, and leaves on detach", () => {
    const streamed: string[] = [];
    const { session, io } = makeSession((cmd) => (cmd === "#" ? "Entering CLI\r\n# " : "output\r\n# "));
    session.attachInteractive((t) => streamed.push(t));
    expect(io.sent).toEqual([]); // opening the terminal does not pause telemetry
    expect(io.active).toEqual([]);
    session.sendInteractive("version");
    expect(io.active).toEqual([true]);
    expect(io.raw).toEqual(["#\r\n", "version\r\n"]);
    expect(streamed.join("")).toContain("Entering CLI");
    expect(streamed.join("")).toContain("output");
    session.detachInteractive();
    expect(io.sent).toContain("exit noreboot");
    expect(io.active).toEqual([true, false]); // resumes MSP polling on exit
    expect(session.isActive).toBe(false);
  });

  it("sends a typed Betaflight exit as exit noreboot and hands the link back to MSP", () => {
    vi.useFakeTimers();
    const streamed: string[] = [];
    const { session, io } = makeSession((cmd) => (cmd.startsWith("exit") ? "# leaving CLI mode, no reboot\r\n" : "\r\n# "));
    session.attachInteractive((t) => streamed.push(t));
    session.sendInteractive("exit");
    expect(io.sent).toEqual(["#", "exit noreboot"]);
    expect(streamed.join("")).toContain("no reboot"); // the reply still reaches the terminal
    expect(session.isActive).toBe(true);
    vi.advanceTimersByTime(500);
    expect(session.isActive).toBe(false);
    expect(io.active).toEqual([true, false]);
    session.sendInteractive("status"); // the next command re-enters the CLI
    expect(io.sent.slice(2)).toEqual(["#", "status"]);
    expect(io.active).toEqual([true, false, true]);
  });

  it("sends a typed Betaflight save as save noreboot and stays in the CLI", () => {
    const { session, io } = makeSession(() => "\r\n# ");
    session.attachInteractive(() => undefined);
    session.sendInteractive("save");
    expect(io.sent).toEqual(["#", "save noreboot"]);
    expect(session.isActive).toBe(true);
    expect(io.active).toEqual([true]);
  });

  it("treats an iNav save as leaving the CLI, since iNav reboots on save", () => {
    vi.useFakeTimers();
    const { session, io } = makeSession(() => "\r\n# ", INAV_CLI);
    session.attachInteractive(() => undefined);
    session.sendInteractive("get nav_rth_altitude");
    expect(io.raw).toEqual(["#\r\n", "get nav_rth_altitude\r\n"]); // each line is terminated
    session.sendInteractive("save");
    expect(io.sent.at(-1)).toBe("save");
    vi.advanceTimersByTime(500);
    expect(session.isActive).toBe(false);
    expect(io.active).toEqual([true, false]);
  });
});

describe("BfCliSettings (cliSettings capability)", () => {
  it("enumerate() dumps and parses every setting", async () => {
    const { session } = makeSession((cmd) => {
      if (cmd === "#") return "# ";
      if (cmd === "dump") return "set gyro_hardware_lpf = NORMAL\r\nset acc_hardware = AUTO\r\n# ";
      return "\r\n# ";
    });
    const settings = await new BfCliSettings(session).enumerate();
    expect(settings).toEqual([
      { name: "gyro_hardware_lpf", value: "NORMAL" },
      { name: "acc_hardware", value: "AUTO" },
    ]);
  });

  it("applySettings() sets each change, persists, and reports success", async () => {
    const { session, io } = makeSession(() => "\r\n# ");
    const r = await new BfCliSettings(session).applySettings(
      [{ name: "gyro_hardware_lpf", value: "OPTION_1" }, { name: "motor_pwm_protocol", value: "DSHOT300" }],
      { persist: true },
    );
    expect(r.success).toBe(true);
    expect(io.sent).toEqual([
      "#",
      "set gyro_hardware_lpf = OPTION_1",
      "set motor_pwm_protocol = DSHOT300",
      "save noreboot",
      "exit noreboot",
    ]);
  });

  it("applySettings() flags a rejected setting", async () => {
    const { session } = makeSession((cmd) =>
      cmd.startsWith("set bad") ? "Invalid name\r\n# " : "\r\n# ",
    );
    const r = await new BfCliSettings(session).applySettings([{ name: "bad_name", value: "9" }]);
    expect(r.success).toBe(false);
    expect(r.message).toContain("bad_name");
  });

  it("applySettings() with no changes is a no-op success", async () => {
    const { session, io } = makeSession(() => "\r\n# ");
    const r = await new BfCliSettings(session).applySettings([]);
    expect(r.success).toBe(true);
    expect(io.sent).toEqual([]); // never enters the CLI
  });

  it("does not cut a dump short when a chunk ends at a mid-dump `#` comment", async () => {
    // A response streamed in pieces, one boundary landing right after a bare `#`
    // (a `# comment` split from its text) — the prompt grace must not resolve early.
    const io = new FakeIo(() => ""); // manual streaming below
    const session = new MspCliSession(io, BETAFLIGHT_CLI);
    io.session = session;
    const feed = (s: string) => session.feed(new TextEncoder().encode(s));
    // override send so `dump` streams asynchronously in chunks
    io.send = (bytes: Uint8Array) => {
      const cmd = new TextDecoder().decode(bytes).trim();
      io.sent.push(cmd);
      if (cmd === "#") { feed("# "); return; }
      if (cmd === "dump") {
        feed("set a = 1\r\n#"); // chunk ends at a bare `#` of a comment
        setTimeout(() => feed(" resource block\r\nset b = 2\r\nset c = 3\r\n# "), 20);
        return;
      }
      feed("\r\n# ");
    };
    const settings = await new BfCliSettings(session).enumerate();
    expect(settings.map((s) => s.name)).toEqual(["a", "b", "c"]); // all three, not just `a`
  });
});
