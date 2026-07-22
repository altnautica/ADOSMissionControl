/**
 * Tests for the demo fleet's response to a board command: the deltas a command
 * leaves behind, so the simulated node's own telemetry moves instead of being
 * overwritten by the next tick.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  applyDemoNodeCommand,
  clearDemoNodeCommands,
  demoTelemetryOverride,
} from "@/mock/demo-node-commands";

const NODE = "demo-alpha";

beforeEach(() => {
  clearDemoNodeCommands();
});

describe("applyDemoNodeCommand", () => {
  it("moves arm state in both directions", () => {
    applyDemoNodeCommand(NODE, "arm");
    expect(demoTelemetryOverride(NODE)).toEqual({ armed: true });

    applyDemoNodeCommand(NODE, "disarm");
    expect(demoTelemetryOverride(NODE)).toEqual({ armed: false });
  });

  it("takes the mode from the command's own argument", () => {
    applyDemoNodeCommand(NODE, "mode", ["LOITER"]);
    expect(demoTelemetryOverride(NODE)?.mode).toBe("LOITER");
  });

  it("keeps earlier deltas when a later command touches another field", () => {
    applyDemoNodeCommand(NODE, "arm");
    applyDemoNodeCommand(NODE, "mode", ["AUTO"]);
    expect(demoTelemetryOverride(NODE)).toEqual({ armed: true, mode: "AUTO" });
  });

  it("maps the recoveries onto their own modes", () => {
    applyDemoNodeCommand(NODE, "rtl");
    expect(demoTelemetryOverride(NODE)?.mode).toBe("RTL");

    applyDemoNodeCommand(NODE, "land");
    expect(demoTelemetryOverride(NODE)?.mode).toBe("LAND");
  });

  it("leaves a node untouched by a command it has no handler for", () => {
    applyDemoNodeCommand(NODE, "reboot");
    expect(demoTelemetryOverride(NODE)).toBeUndefined();
  });

  it("ignores a mode command with no readable target", () => {
    applyDemoNodeCommand(NODE, "mode", [42]);
    expect(demoTelemetryOverride(NODE)).toBeUndefined();
  });

  it("keeps one node's deltas off another", () => {
    applyDemoNodeCommand(NODE, "disarm");
    expect(demoTelemetryOverride("demo-bravo")).toBeUndefined();
  });
});
