import { describe, it, expect } from "vitest";
import {
  categoryForTool,
  surfaceForTool,
  summarizeTool,
  decisionStatus,
  toolNamespace,
  toolVerb,
} from "../activity";

describe("mcp activity model", () => {
  it("categorizes a tool by its namespace", () => {
    expect(categoryForTool("params.set")).toBe("config");
    expect(categoryForTool("flight.arm")).toBe("drone");
    expect(categoryForTool("mission.upload")).toBe("mission");
    expect(categoryForTool("status.get")).toBe("query");
    expect(categoryForTool("plugins.list")).toBe("config");
    expect(categoryForTool("frobnicate")).toBe("other");
  });

  it("maps a tool to its GCS surface", () => {
    expect(surfaceForTool("params.set")).toEqual({ kind: "tab", id: "parameters" });
    // The cockpit tab is the drone's Flight tab.
    expect(surfaceForTool("flight.arm")).toEqual({ kind: "tab", id: "cockpit" });
    expect(surfaceForTool("services.restart")).toEqual({ kind: "tab", id: "system" });
    expect(surfaceForTool("plugins.list")).toEqual({ kind: "tab", id: "plugins" });
    expect(surfaceForTool("mission.upload")).toEqual({ kind: "route", path: "/plan" });
    expect(surfaceForTool("fleet.list_nodes")).toEqual({ kind: "route", path: "/mcp" });
    expect(surfaceForTool("frobnicate")).toBeNull();
  });

  it("summarizes the effect in plain language, not the raw tool name", () => {
    expect(summarizeTool("params.set", { name: "INS_HNTCH_OPTS", value: 2 })).toBe(
      "Set INS_HNTCH_OPTS → 2",
    );
    expect(summarizeTool("params.get", { name: "ATC_RAT_RLL_P" })).toBe("Read ATC_RAT_RLL_P");
    expect(summarizeTool("flight.arm")).toBe("Arm");
    expect(summarizeTool("flight.mode", { mode: "LOITER" })).toBe("Set mode LOITER");
    expect(summarizeTool("status.get")).toBe("Read status");
    expect(summarizeTool("plugins.install", { plugin: "follow-me" })).toBe("Install follow-me");
    // Fallback humanizes an unmapped tool.
    expect(summarizeTool("foo.bar_baz")).toBe("foo · bar baz");
  });

  it("maps decision + lifecycle to the shared status vocabulary", () => {
    expect(decisionStatus("allowed", "success")).toBe("good");
    expect(decisionStatus("confirmed", "success")).toBe("good");
    expect(decisionStatus("denied", "error")).toBe("critical");
    expect(decisionStatus("operator_absent", "success")).toBe("warning");
    expect(decisionStatus("allowed", "running")).toBe("idle");
  });

  it("splits the dotted tool into namespace + verb", () => {
    expect(toolNamespace("params.set")).toBe("params");
    expect(toolVerb("params.set")).toBe("set");
    expect(toolNamespace("status")).toBe("status");
    expect(toolVerb("status")).toBe("");
  });
});
