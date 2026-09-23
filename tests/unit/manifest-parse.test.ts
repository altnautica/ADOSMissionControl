/**
 * @module ManifestParseTest
 * @description Vitest suite covering the client-side manifest preview
 * parser. Focuses on the rich install-dialog content fields (the
 * legacy short-summary fields are covered transitively by the install
 * dialog's own tests).
 *
 * @license GPL-3.0-only
 */

import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import { toInstallSummary } from "@/components/plugins/transports/manifest-summary";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VISION_NAV_MANIFEST = path.join(
  REPO_ROOT,
  "ADOSExtensions",
  "extensions",
  "vision-nav",
  "manifest.yaml",
);

const BASE = `id: com.altnautica.vision-nav
name: ADOS Vision Navigation
version: 0.2.3
description: Short summary
risk: high
`;

const RICH = `${BASE}description_long: |
  Long description line one.
  Long description line two.

  Long description line four after a blank line.
features:
  - Feature one
  - "Feature two with quotes"
hardware_requirements:
  cameras: USB UVC global-shutter
  fc_firmware: ArduPilot 4.5+
  boards: ["cm4", "cm5", "rk3582"]
  optional:
    - "Rangefinder (TF-Luna)"
resource_impact:
  cpu_percent_peak: 80
  ram_mb: 512
  pids: 24
  startup_time_seconds: 5
required_fc_parameters:
  ardupilot:
    - param: EKF_SOURCE_SET
      note: "Select vision pose source"
  px4:
    - param: EKF2_AID_MASK
      note: "Set VISION_POS and VISION_HEADING bits"
  inav:
    - param: opflow_hardware
      value: MAVLINK
    - param: nav_use_optflow_for_poshold
      value: "ON"
telemetry_fields:
  - navigation.feature_count
  - navigation.drift_m
documentation_url: "https://docs.altnautica.com/drone-agent/vision-nav-overview"
`;

describe("parseManifestYaml — rich fields", () => {
  it("parses every rich field round-trip", () => {
    const parsed = parseManifestYaml(RICH);

    expect(parsed.pluginId).toBe("com.altnautica.vision-nav");
    expect(parsed.version).toBe("0.2.3");

    expect(parsed.descriptionLong).toBeDefined();
    expect(parsed.descriptionLong).toContain("Long description line one.");
    expect(parsed.descriptionLong).toContain("Long description line four");

    expect(parsed.features).toEqual([
      "Feature one",
      "Feature two with quotes",
    ]);

    expect(parsed.hardwareRequirements).toBeDefined();
    expect(parsed.hardwareRequirements?.cameras).toBe("USB UVC global-shutter");
    expect(parsed.hardwareRequirements?.fcFirmware).toBe("ArduPilot 4.5+");
    expect(parsed.hardwareRequirements?.boards).toEqual([
      "cm4",
      "cm5",
      "rk3582",
    ]);
    expect(parsed.hardwareRequirements?.optional).toEqual([
      "Rangefinder (TF-Luna)",
    ]);

    expect(parsed.resourceImpact).toBeDefined();
    expect(parsed.resourceImpact?.cpuPercentPeak).toBe(80);
    expect(parsed.resourceImpact?.ramMb).toBe(512);
    expect(parsed.resourceImpact?.pids).toBe(24);
    expect(parsed.resourceImpact?.startupTimeSeconds).toBe(5);

    expect(parsed.requiredFcParameters).toBeDefined();
    expect(parsed.requiredFcParameters?.ardupilot).toEqual([
      { param: "EKF_SOURCE_SET", note: "Select vision pose source" },
    ]);
    expect(parsed.requiredFcParameters?.px4).toEqual([
      {
        param: "EKF2_AID_MASK",
        note: "Set VISION_POS and VISION_HEADING bits",
      },
    ]);
    expect(parsed.requiredFcParameters?.inav).toEqual([
      { param: "opflow_hardware", value: "MAVLINK" },
      { param: "nav_use_optflow_for_poshold", value: "ON" },
    ]);

    expect(parsed.telemetryFields).toEqual([
      "navigation.feature_count",
      "navigation.drift_m",
    ]);

    expect(parsed.documentationUrl).toBe(
      "https://docs.altnautica.com/drone-agent/vision-nav-overview",
    );

    // Screenshots field absent in this manifest — must stay undefined
    // so the modal can decide not to render an empty gallery.
    expect(parsed.screenshots).toBeUndefined();
  });

  it("parses screenshots when present", () => {
    const yaml = `${BASE}screenshots:
  - url: "https://example.com/a.png"
    caption: "A caption"
  - url: "https://example.com/b.png"
`;
    const parsed = parseManifestYaml(yaml);
    expect(parsed.screenshots).toBeDefined();
    expect(parsed.screenshots).toHaveLength(2);
    expect(parsed.screenshots?.[0]).toEqual({
      url: "https://example.com/a.png",
      caption: "A caption",
    });
    expect(parsed.screenshots?.[1]).toEqual({
      url: "https://example.com/b.png",
    });
  });

  it("leaves rich fields undefined for legacy manifests", () => {
    // Legacy manifest that predates the rich-content fields.
    const legacy = `id: com.example.legacy
name: Legacy Plugin
version: 1.0.0
description: A legacy plugin
permissions:
  - hardware.spi
`;
    const parsed = parseManifestYaml(legacy);
    expect(parsed.pluginId).toBe("com.example.legacy");
    expect(parsed.descriptionLong).toBeUndefined();
    expect(parsed.features).toBeUndefined();
    expect(parsed.hardwareRequirements).toBeUndefined();
    expect(parsed.resourceImpact).toBeUndefined();
    expect(parsed.requiredFcParameters).toBeUndefined();
    expect(parsed.telemetryFields).toBeUndefined();
    expect(parsed.documentationUrl).toBeUndefined();
    expect(parsed.screenshots).toBeUndefined();
    // Old permission list must still parse correctly.
    expect(parsed.permissions.map((p) => p.id)).toContain("hardware.spi");
    // Legacy entries do not carry a half tag.
    expect(parsed.permissions[0]?.half).toBeUndefined();
  });
});

// Slice of the real v0.2.3 manifest at
// `ADOSExtensions/extensions/vision-nav/manifest.yaml`. Exercises the
// nested `agent.permissions` + `gcs.permissions` shape the parser must
// walk so the install modal renders a non-zero permissions count.
const NESTED = `id: com.altnautica.vision-nav
name: ADOS Vision Navigation
version: 0.2.3
risk: high
description: Short summary
agent:
  entrypoint: "altnautica_vision_nav.plugin:VisionNavPlugin"
  isolation: subprocess
  per_drone_config: true
  contains_vendor_binary: true
  permissions:
    - id: hardware.usb.uvc
    - id: hardware.camera.csi
    - id: hardware.uart
    - id: hardware.i2c
    - id: sensor.camera.register
    - id: sensor.depth.register
    - id: telemetry.extend
    - id: event.publish
    - id: event.subscribe
    - id: mavlink.read
    - id: mavlink.write
    - id: mavlink.component.peripheral
    - id: mavlink.component.vio
    - id: estimator.pose.inject
    - id: process.spawn
  resources:
    max_ram_mb: 512
    max_cpu_percent: 80
gcs:
  entrypoint: "gcs/plugin.bundle.js"
  isolation: iframe
  permissions:
    - id: ui.slot.node-detail-tab
    - id: ui.slot.video-overlay
    - id: ui.slot.notification-channel
    - id: telemetry.subscribe
    - id: command.send
`;

describe("parseManifestYaml — nested agent + gcs permissions", () => {
  it("walks agent.permissions and gcs.permissions and emits 20 entries", () => {
    const parsed = parseManifestYaml(NESTED);
    expect(parsed.permissions).toHaveLength(20);

    const agentCount = parsed.permissions.filter(
      (p) => p.half === "agent",
    ).length;
    const gcsCount = parsed.permissions.filter((p) => p.half === "gcs").length;
    expect(agentCount).toBe(15);
    expect(gcsCount).toBe(5);

    const ids = parsed.permissions.map((p) => p.id);
    expect(ids).toContain("hardware.usb.uvc");
    expect(ids).toContain("mavlink.component.vio");
    expect(ids).toContain("estimator.pose.inject");
    expect(ids).toContain("ui.slot.node-detail-tab");
    expect(ids).toContain("command.send");
  });

  it("propagates the half tag onto the install summary", () => {
    const parsed = parseManifestYaml(NESTED);
    const summary = toInstallSummary(parsed, "abc123", { signatureState: "unsigned" });
    const agentSide = summary.permissions.filter((p) => p.half === "agent");
    const gcsSide = summary.permissions.filter((p) => p.half === "gcs");
    expect(agentSide).toHaveLength(15);
    expect(gcsSide).toHaveLength(5);
    // Agent-side hardware perms must surface a hardware category even
    // when the GCS catalog has no entry (inferAgentPermissionMeta).
    const usb = summary.permissions.find((p) => p.id === "hardware.usb.uvc");
    expect(usb?.category).toBe("hardware");
    // GCS-side ui.slot.* perms resolve through the local catalog.
    const slot = summary.permissions.find(
      (p) => p.id === "ui.slot.node-detail-tab",
    );
    expect(slot?.category).toBe("ui_slot");
  });

  it("accepts vendor_attribution + a verified signer from the registry row", () => {
    const parsed = parseManifestYaml(NESTED);
    const summary = toInstallSummary(parsed, "abc123", {
      signatureState: "verified",
      signerId: "altnautica-2026-A",
      vendorAttribution: [
        {
          name: "OpenVINS",
          license: "GPL-3.0-only",
          source_url: "https://github.com/rpng/open_vins",
        },
        {
          name: "VINS-Fusion",
          license: "GPL-3.0-only",
        },
      ],
      archiveSha256: "deadbeef".repeat(8),
    });
    expect(summary.signerId).toBe("altnautica-2026-A");
    expect(summary.trustSignals).toContain("signed");
    // First-party subsumes verified-publisher in the shared display set; the
    // declared closed vendor binaries add the vendor-binary signal.
    expect(summary.trustSignals).toContain("first-party");
    expect(summary.trustSignals).toContain("vendor-binary");
    expect(summary.vendorAttribution).toHaveLength(2);
    expect(summary.vendorAttribution?.[0]?.name).toBe("OpenVINS");
    expect(summary.archiveSha256).toBe("deadbeef".repeat(8));
  });
});

describe("parseManifestYaml — over-collection guards", () => {
  // A regression fixture that mimics the structure where the parser
  // previously slurped values out of `subprocess_spawn`,
  // `target_profiles`, and `vendor_attribution[].license` into the
  // agent.permissions list. Only 3 real permissions should land.
  const TRAP = `id: com.example.trap
name: Trap Plugin
version: 0.1.0
description: trap
risk: low
agent:
  entrypoint: "x.y:Z"
  permissions:
    - id: hardware.usb.uvc
    - id: mavlink.read
    - id: estimator.pose.inject
  subprocess_spawn:
    - ados_openvins_shim
    - ados_vins_fusion_shim
  target_profiles:
    - drone
  vendor_attribution:
    - name: "OpenVINS"
      license: "GPL-3.0-only"
    - name: "VINS-Fusion"
      license: "GPL-3.0-only"
  mavlink_components:
    - component_id: 197
      component_kind: vio
gcs:
  permissions:
    - id: ui.slot.video-overlay
    - id: telemetry.subscribe
`;

  it("stops collecting permissions at the next agent: sibling key", () => {
    const parsed = parseManifestYaml(TRAP);
    expect(parsed.permissions).toHaveLength(5);
    const ids = parsed.permissions.map((p) => p.id);
    expect(ids).toEqual([
      "hardware.usb.uvc",
      "mavlink.read",
      "estimator.pose.inject",
      "ui.slot.video-overlay",
      "telemetry.subscribe",
    ]);
    // Guard against the historical leakage modes.
    expect(ids).not.toContain("ados_openvins_shim");
    expect(ids).not.toContain("ados_vins_fusion_shim");
    expect(ids).not.toContain("drone");
    expect(ids.some((id) => /license/.test(id))).toBe(false);
  });

  // Real vision-nav fixture. No exact permission count is asserted here: the
  // exact-list contract is pinned above against the inline TRAP fixture, which
  // cannot drift, while this manifest lives in another repository and changes
  // whenever that extension's permissions legitimately change. Pinning its
  // count made a correct manifest edit fail this suite and taught nothing about
  // the parser. What this case is for is the shapes a hand-written real file
  // produces: spurious ids leaking in from sibling keys, and duplicates.
  const hasFixture = fs.existsSync(VISION_NAV_MANIFEST);
  const maybeIt = hasFixture ? it : it.skip;

  maybeIt("collects no spurious entries from the real vision-nav manifest", () => {
    const yaml = fs.readFileSync(VISION_NAV_MANIFEST, "utf-8");
    const parsed = parseManifestYaml(yaml);
    const ids = parsed.permissions.map((p) => p.id);
    // Spurious ids that used to leak through must be absent.
    expect(ids.some((id) => /^ados_.*_shim$/.test(id))).toBe(false);
    expect(ids).not.toContain("drone");
    expect(ids.some((id) => /license/.test(id))).toBe(false);
    // A permission collected twice would grant once and display twice.
    expect(new Set(ids).size).toBe(ids.length);
    // Every id must look like a dotted capability id. Hyphens are
    // valid (e.g. `ui.slot.node-detail-tab`).
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][\w.-]*[a-z0-9]$/);
    }
  });
});

describe("parseManifestYaml — block-literal rendering", () => {
  const THREE_PARAGRAPHS = `id: com.example.docs
name: Docs Plugin
version: 1.0.0
risk: low
description: short
description_long: |
  Paragraph one starts here and runs for one full sentence describing the first concept.

  Paragraph two follows a blank line and explains a second concept in a fresh sentence.

  Paragraph three closes out the description with one more sentence to verify the join.
features:
  - one
`;

  it("preserves blank-line paragraph breaks and emits no backslash artefact", () => {
    const parsed = parseManifestYaml(THREE_PARAGRAPHS);
    expect(parsed.descriptionLong).toBeDefined();
    const body = parsed.descriptionLong!;
    expect(body).toContain("Paragraph one starts here");
    expect(body).toContain("Paragraph two follows a blank line");
    expect(body).toContain("Paragraph three closes out the description");
    // Paragraph break must round-trip as `\n\n`, not a single newline.
    const paragraphs = body.split(/\n\n+/);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    // No raw backslash characters should appear in the output unless
    // they were literally in the source — and the fixture has none.
    expect(body.includes("\\")).toBe(false);
    // The block ends cleanly before `features:` so the trailing dash
    // list does not get folded into the description.
    expect(body).not.toContain("- one");
    // Features list must still parse correctly after the block ends.
    expect(parsed.features).toEqual(["one"]);
  });
});

describe("parseManifestYaml — PyYAML-emitted Convex fixture", () => {
  // The signed-archive sign-release pipeline round-trips through PyYAML,
  // which reformats the source `description_long: |` block-literal into
  // a double-quoted multi-line scalar with `\` line-continuations and
  // shifts permission item indents from 4 spaces to 2. The new parser
  // (built on the `yaml` npm package) is what serves the live modal, so
  // this regression pins behavior against the actual Convex bytes that
  // crashed the previous regex parser.
  const CONVEX_FIXTURE = path.join(
    REPO_ROOT,
    "ADOSMissionControl",
    "tests",
    "fixtures",
    "vision-nav-v0.2.5-convex.yaml",
  );
  const yaml = fs.readFileSync(CONVEX_FIXTURE, "utf8");
  const parsed = parseManifestYaml(yaml);

  it("collects exactly 20 permissions from the PyYAML-emitted shape", () => {
    expect(parsed.permissions.length).toBe(20);
    const halves = parsed.permissions.map((p) => p.half);
    expect(halves.filter((h) => h === "agent").length).toBe(15);
    expect(halves.filter((h) => h === "gcs").length).toBe(5);
    // No spurious entries like subprocess_spawn / target_profiles /
    // vendor_attribution.license / mavlink_components.component_id.
    const ids = parsed.permissions.map((p) => p.id);
    expect(ids).not.toContain("ados_openvins_shim");
    expect(ids).not.toContain("ados_vins_fusion_shim");
    expect(ids).not.toContain("drone");
    expect(ids.some((id) => id.startsWith("license"))).toBe(false);
  });

  it("renders the full description_long with no backslash artefact", () => {
    expect(parsed.descriptionLong).toBeDefined();
    const body = parsed.descriptionLong!;
    expect(body.length).toBeGreaterThan(3000);
    expect(body.includes("\\")).toBe(false);
    // First sentence of each of the ten paragraphs should be present
    // verbatim after the parser unfolds the PyYAML double-quoted
    // multi-line.
    expect(body).toContain("What problem it solves");
    expect(body).toContain("The pipeline");
    expect(body).toContain("Optical flow modes");
    expect(body).toContain("VIO modes");
    expect(body).toContain("Hybrid mode and the cross-check");
    expect(body).toContain("The fallback ladder");
    expect(body).toContain("Firmware support and what gets emitted");
    expect(body).toContain("Hardware");
    expect(body).toContain("Calibration");
    expect(body).toContain("In-flight telemetry to watch");
  });

  it("parses the resource impact numerics", () => {
    expect(parsed.resourceImpact?.cpuPercentPeak).toBe(80);
    expect(parsed.resourceImpact?.ramMb).toBe(512);
    expect(parsed.resourceImpact?.pids).toBe(24);
    expect(parsed.resourceImpact?.startupTimeSeconds).toBe(5);
  });

  it("emits both halves on the manifest", () => {
    expect(parsed.halves).toContain("agent");
    expect(parsed.halves).toContain("gcs");
  });
});

describe("toInstallSummary — rich fields", () => {
  it("passes every rich field through to the install summary", () => {
    const parsed = parseManifestYaml(RICH);
    const summary = toInstallSummary(parsed, "deadbeef", { signatureState: "unsigned" });

    expect(summary.descriptionLong).toContain("Long description line one.");
    expect(summary.features).toEqual([
      "Feature one",
      "Feature two with quotes",
    ]);

    expect(summary.hardwareRequirements?.cameras).toBe(
      "USB UVC global-shutter",
    );
    expect(summary.hardwareRequirements?.fcFirmware).toBe("ArduPilot 4.5+");
    expect(summary.hardwareRequirements?.boards).toEqual([
      "cm4",
      "cm5",
      "rk3582",
    ]);
    expect(summary.hardwareRequirements?.optional).toEqual([
      "Rangefinder (TF-Luna)",
    ]);

    expect(summary.resourceImpact?.ramMb).toBe(512);
    expect(summary.resourceImpact?.cpuPercentPeak).toBe(80);

    expect(summary.requiredFcParameters?.ardupilot).toHaveLength(1);
    expect(summary.requiredFcParameters?.ardupilot?.[0]?.param).toBe(
      "EKF_SOURCE_SET",
    );
    expect(summary.requiredFcParameters?.inav?.[0]?.value).toBe("MAVLINK");

    expect(summary.telemetryFields).toEqual([
      "navigation.feature_count",
      "navigation.drift_m",
    ]);

    expect(summary.documentationUrl).toBe(
      "https://docs.altnautica.com/drone-agent/vision-nav-overview",
    );
    expect(summary.screenshots).toBeUndefined();
    expect(summary.manifestHash).toBe("deadbeef");
  });

  it("leaves rich fields undefined when the manifest omits them", () => {
    const legacy = `id: com.example.legacy
name: Legacy Plugin
version: 1.0.0
description: A legacy plugin
`;
    const parsed = parseManifestYaml(legacy);
    const summary = toInstallSummary(parsed, "cafebabe", { signatureState: "unsigned" });
    expect(summary.descriptionLong).toBeUndefined();
    expect(summary.features).toBeUndefined();
    expect(summary.hardwareRequirements).toBeUndefined();
    expect(summary.resourceImpact).toBeUndefined();
    expect(summary.requiredFcParameters).toBeUndefined();
    expect(summary.telemetryFields).toBeUndefined();
    expect(summary.documentationUrl).toBeUndefined();
    expect(summary.screenshots).toBeUndefined();
    expect(summary.manifestHash).toBe("cafebabe");
  });
});

describe("parseManifestYaml — gcs.contributes slot contributions", () => {
  const SLOTS = `id: com.example.slots
name: Slots Plugin
version: 1.0.0
risk: low
description: short
gcs:
  entrypoint: "gcs/plugin.bundle.js"
  isolation: iframe
  contributes:
    panels:
      - id: follow-tab
        slot: node.detail.tab
        title: "Follow"
        icon: "crosshair"
        order: 70
      - id: cfg-tab
        slot: fc.tab
      - id: bogus-panel
        slot: not.a.real.slot
    overlays:
      - id: follow-overlay
    notifications:
      - id: low-batt
        title: "Low battery"
        severity: warning
`;

  it("parses panels/overlays/notifications into contributesSlots and drops unknown slots", () => {
    const parsed = parseManifestYaml(SLOTS);
    const slots = parsed.contributesSlots ?? [];
    // 2 valid panels + 1 overlay + 1 notification = 4; the bogus-slot
    // panel is dropped so a bogus slot never reaches the install row.
    expect(slots).toHaveLength(4);

    const byId = Object.fromEntries(slots.map((s) => [s.panelId, s]));
    // A panel may target the per-node tab slot directly.
    expect(byId["follow-tab"].slot).toBe("node.detail.tab");
    expect(byId["follow-tab"].title).toBe("Follow");
    expect(byId["follow-tab"].icon).toBe("crosshair");
    expect(byId["follow-tab"].order).toBe(70);
    expect(byId["cfg-tab"].slot).toBe("fc.tab");
    // overlays default to the video.overlay slot when no explicit slot.
    expect(byId["follow-overlay"].slot).toBe("video.overlay");
    // notifications default to the notification.channel slot.
    expect(byId["low-batt"].slot).toBe("notification.channel");
    // the unknown-slot entry never lands.
    expect(byId["bogus-panel"]).toBeUndefined();
  });

  it("surfaces contributesSlots on the install summary and undefined for legacy manifests", () => {
    const parsed = parseManifestYaml(SLOTS);
    const summary = toInstallSummary(parsed, "hash", { signatureState: "unsigned" });
    expect(summary.contributesSlots).toEqual(parsed.contributesSlots);

    const legacy = parseManifestYaml(
      "id: com.example.legacy\nname: Legacy\nversion: 1.0.0\n",
    );
    expect(legacy.contributesSlots).toBeUndefined();
    expect(toInstallSummary(legacy, "h", { signatureState: "unsigned" }).contributesSlots).toBeUndefined();
  });

  const FOLLOW_ME_MANIFEST = path.join(
    REPO_ROOT,
    "ADOSExtensions",
    "extensions",
    "follow-me",
    "manifest.yaml",
  );
  const hasFollowMe = fs.existsSync(FOLLOW_ME_MANIFEST);
  (hasFollowMe ? it : it.skip)(
    "parses the real follow-me manifest's node.detail.tab, without a video overlay",
    () => {
      const yaml = fs.readFileSync(FOLLOW_ME_MANIFEST, "utf-8");
      const parsed = parseManifestYaml(yaml);
      const slots = parsed.contributesSlots ?? [];
      const bySlot = new Map(slots.map((s) => [s.slot, s]));
      // Follow-Me no longer ships its own video overlay: the cockpit host owns
      // the detection overlay + selection, and Follow-Me contributes a target
      // action instead. So there is no video.overlay slot.
      expect(bySlot.has("video.overlay")).toBe(false);
      // The settings + live read-back tab is a node.detail.tab contribution.
      const tab = (parsed.contributesTabs ?? []).find(
        (t) => t.slot === "node.detail.tab",
      );
      expect(tab?.panelId).toBe("follow-me-tab");
      expect(tab?.order).toBe(70);
    },
  );
});
