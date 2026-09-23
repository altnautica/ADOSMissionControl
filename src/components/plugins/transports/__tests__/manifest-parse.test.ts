/**
 * @license GPL-3.0-only
 *
 * Tests for the client-side manifest parser + install-summary projection.
 * Covers the cockpit-behavior contributions that ride the cloud install path:
 *   - `gcs.contributes.target_actions[]` parses into camelCase rows
 *   - `gcs.contributes.skills[]` carries its FULL fields (config/state wiring),
 *     not just id/label, into the install summary so the persisted denorm can
 *     drive the cockpit Skill Bar for a cloud operator
 *   - a `tabs:`-declared node-detail tab parses into `contributesTabs`
 */

import { describe, it, expect } from "vitest";

import { parseManifestYaml } from "../manifest-parse";
import { toInstallSummary } from "../manifest-summary";

const MANIFEST = `
id: com.example.follow
version: "0.1.0"
name: "Example Follow"
risk: high
gcs:
  permissions:
    - id: ui.slot.flight-skill
    - id: ui.slot.node-detail-tab
  contributes:
    skills:
      - id: follow-me
        label: "Follow-Me"
        icon: crosshair
        category: behavior
        toggle: true
        confirm: true
        arm_requirement: armed
        default_binding:
          key: "shift+f"
        activation:
          via: config
          config_key: active
        state:
          via: event
          topic: "follow.state"
    target_actions:
      - id: follow
        label: "Follow this target"
        icon: crosshair
        order: 20
        applies_to_class: person
        designate: true
        config_key: active
        config_value: true
        default_key: "f"
      - id: stop-follow
        label: "Stop following"
        designate: false
        config_key: active
        config_value: false
        default_key: "x"
    tabs:
      - id: follow-me-tab
        slot: node.detail.tab
        profile: ["drone"]
        title: "Follow-Me"
        order: 70
`;

describe("parseManifestYaml — target actions", () => {
  it("parses gcs.contributes.target_actions into camelCase rows", () => {
    const parsed = parseManifestYaml(MANIFEST);
    expect(parsed.contributesTargetActions).toEqual([
      {
        id: "follow",
        label: "Follow this target",
        icon: "crosshair",
        order: 20,
        appliesToClass: "person",
        designate: true,
        configKey: "active",
        configValue: true,
        defaultKey: "f",
      },
      {
        id: "stop-follow",
        label: "Stop following",
        designate: false,
        configKey: "active",
        configValue: false,
        defaultKey: "x",
      },
    ]);
  });

  it("parses a tabs:-declared node-detail tab into contributesTabs", () => {
    const parsed = parseManifestYaml(MANIFEST);
    expect(parsed.contributesTabs).toEqual([
      {
        slot: "node.detail.tab",
        panelId: "follow-me-tab",
        profile: ["drone"],
        title: "Follow-Me",
        order: 70,
      },
    ]);
  });
});

describe("toInstallSummary — skills carry full fields", () => {
  it("threads the full skill wiring (not just id/label) into the summary", () => {
    const summary = toInstallSummary(parseManifestYaml(MANIFEST), "hash", { signatureState: "unsigned" });
    expect(summary.contributesSkills).toEqual([
      {
        id: "follow-me",
        label: "Follow-Me",
        icon: "crosshair",
        category: "behavior",
        toggle: true,
        confirm: true,
        armRequirement: "armed",
        configKey: "active",
        stateTopic: "follow.state",
        defaultBinding: { key: "shift+f" },
      },
    ]);
  });

  it("threads the target actions into the summary", () => {
    const summary = toInstallSummary(parseManifestYaml(MANIFEST), "hash", { signatureState: "unsigned" });
    expect(summary.contributesTargetActions?.map((a) => a.id)).toEqual([
      "follow",
      "stop-follow",
    ]);
    expect(summary.contributesTargetActions?.[0]).toMatchObject({
      appliesToClass: "person",
      configKey: "active",
      configValue: true,
      defaultKey: "f",
    });
  });
});

const TOOLS_MANIFEST = `
id: com.example.pod
version: "0.1.0"
name: "Example Pod"
risk: high
agent:
  contributes:
    tools:
      - name: set_zoom
        description: "Set the optical zoom level."
        safety_class: safe_write
        inputSchema:
          type: object
          properties:
            level: { type: number }
gcs:
  contributes:
    tools:
      - name: status
        safety_class: read
`;

describe("parseManifestYaml — MCP tools", () => {
  it("merges agent + gcs contributes.tools and stamps the half", () => {
    const summary = toInstallSummary(parseManifestYaml(TOOLS_MANIFEST), "hash", { signatureState: "unsigned" });
    expect(summary.contributesTools?.map((tool) => tool.name)).toEqual([
      "set_zoom",
      "status",
    ]);
    const setZoom = summary.contributesTools?.find(
      (tool) => tool.name === "set_zoom",
    );
    expect(setZoom?.half).toBe("agent");
    expect(setZoom?.safetyClass).toBe("safe_write");
    expect(setZoom?.inputSchema).toBeTruthy();
    expect(
      summary.contributesTools?.find((tool) => tool.name === "status")?.half,
    ).toBe("gcs");
  });
});
