/**
 * @license GPL-3.0-only
 *
 * Tests for the shared install-record projection. Covers:
 *   - gcsContributes pass-through for non-tab slots (no profile narrowing)
 *   - node.detail.tab slot picks up its `profile` from the matching tab
 *     contribution (by panelId)
 *   - gcsParameters returns the parameter set, undefined when none declared
 */

import { describe, it, expect } from "vitest";

import {
  buildGcsContributes,
  buildGcsParameters,
  buildGcsFlightSkills,
  buildGcsTargetActions,
} from "../build-install-contributions";
import type { InstallManifestSummary } from "../../install-dialog/types";

type SlotsAndTabs = Pick<
  InstallManifestSummary,
  "contributesSlots" | "contributesTabs"
>;

describe("buildGcsContributes", () => {
  it("passes non-tab slots through untouched (no profile)", () => {
    const manifest: SlotsAndTabs = {
      contributesSlots: [
        { slot: "video.overlay", panelId: "ov", order: 10 },
        { slot: "notification.channel", panelId: "note" },
      ],
    };
    expect(buildGcsContributes(manifest)).toEqual([
      { slot: "video.overlay", panelId: "ov", order: 10 },
      { slot: "notification.channel", panelId: "note" },
    ]);
  });

  it("attaches the per-tab profile to a node.detail.tab slot by panelId", () => {
    const manifest: SlotsAndTabs = {
      contributesSlots: [
        {
          slot: "node.detail.tab",
          panelId: "gs-tab",
          title: "GS Tab",
          order: 40,
        },
      ],
      contributesTabs: [
        { panelId: "gs-tab", profile: ["ground-station"], title: "GS Tab" },
      ],
    };
    expect(buildGcsContributes(manifest)).toEqual([
      {
        slot: "node.detail.tab",
        panelId: "gs-tab",
        title: "GS Tab",
        order: 40,
        profile: ["ground-station"],
      },
    ]);
  });

  it("leaves a node.detail.tab unnarrowed when no tab declares a profile", () => {
    const manifest: SlotsAndTabs = {
      contributesSlots: [{ slot: "node.detail.tab", panelId: "t" }],
      contributesTabs: [{ panelId: "t" }],
    };
    const [row] = buildGcsContributes(manifest);
    expect(row).toEqual({ slot: "node.detail.tab", panelId: "t" });
    expect(row.profile).toBeUndefined();
  });

  it("mounts a node.detail.tab declared only under contributes.tabs", () => {
    // A plugin (Follow-Me) declares its tab under `tabs:` with no
    // matching `panels` slot. It must still be emitted as a mountable
    // node.detail.tab slot, carrying its title/icon/order/profile.
    const manifest: SlotsAndTabs = {
      contributesTabs: [
        {
          panelId: "follow-me-tab",
          profile: ["drone"],
          title: "Follow-Me",
          icon: "crosshair",
          order: 70,
        },
      ],
    };
    expect(buildGcsContributes(manifest)).toEqual([
      {
        slot: "node.detail.tab",
        panelId: "follow-me-tab",
        title: "Follow-Me",
        icon: "crosshair",
        order: 70,
        profile: ["drone"],
      },
    ]);
  });

  it("does not double-mount a tab already declared as a panels slot", () => {
    const manifest: SlotsAndTabs = {
      contributesSlots: [
        { slot: "node.detail.tab", panelId: "t", title: "T", order: 5 },
      ],
      contributesTabs: [{ panelId: "t", profile: ["drone"], title: "T" }],
    };
    const rows = buildGcsContributes(manifest);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      slot: "node.detail.tab",
      panelId: "t",
      title: "T",
      order: 5,
      profile: ["drone"],
    });
  });

  it("returns an empty array when no slots are declared", () => {
    expect(buildGcsContributes({})).toEqual([]);
  });
});

describe("buildGcsFlightSkills", () => {
  it("projects the full skill fields for the install record", () => {
    const skills = [
      {
        id: "follow-me",
        label: "Follow-Me",
        icon: "crosshair",
        category: "behavior" as const,
        toggle: true,
        confirm: true,
        armRequirement: "armed" as const,
        configKey: "active",
        stateTopic: "follow.state",
        defaultBinding: { key: "shift+f" },
      },
    ];
    expect(buildGcsFlightSkills({ contributesSkills: skills })).toEqual([
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

  it("returns undefined when the plugin declares no skills", () => {
    expect(buildGcsFlightSkills({})).toBeUndefined();
    expect(buildGcsFlightSkills({ contributesSkills: [] })).toBeUndefined();
  });
});

describe("buildGcsTargetActions", () => {
  it("projects the target actions for the install record", () => {
    const actions = [
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
    ];
    expect(
      buildGcsTargetActions({ contributesTargetActions: actions }),
    ).toEqual(actions);
  });

  it("returns undefined when the plugin declares no target actions", () => {
    expect(buildGcsTargetActions({})).toBeUndefined();
    expect(
      buildGcsTargetActions({ contributesTargetActions: [] }),
    ).toBeUndefined();
  });
});

describe("buildGcsParameters", () => {
  it("returns a copy of the declared parameter set", () => {
    const params = [
      {
        key: "speed",
        schema: { type: "number" as const, minimum: 0, maximum: 10 },
        binding: "plugin.config" as const,
        ui: { label: "Speed" },
      },
    ];
    const out = buildGcsParameters({ contributesParameters: params });
    expect(out).toEqual(params);
    // a copy, not the same reference (so the record is not aliased)
    expect(out![0]).not.toBe(params[0]);
  });

  it("returns undefined when none are declared", () => {
    expect(buildGcsParameters({})).toBeUndefined();
    expect(
      buildGcsParameters({ contributesParameters: [] }),
    ).toBeUndefined();
  });
});
