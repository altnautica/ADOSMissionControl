/**
 * @module mock-plugins
 * @description Demo-mode plugin install fixtures. Surfaces a small
 * representative set so the per-drone Plugins tab, the dynamic
 * plugin-contributed drone-detail tabs, and the fleet-card pills
 * render without a Convex backend or a paired drone.
 *
 * The fixtures intentionally include one enabled hybrid plugin per
 * demo drone plus one always-disabled critical plugin (the latter
 * exercises the "no plugin tab when disabled" code path in
 * `DroneDetailPanel`). Plugin tabs sort by manifest `order` then by
 * `pluginId` -- the same contract the production hook honours.
 *
 * Exempt from 300 LOC soft rule: pure data file.
 *
 * @license GPL-3.0-only
 */

import type {
  DronePluginContribution,
  InstallDetailRow,
} from "@/hooks/use-drone-plugin-contributions";
import {
  DEMO_INLINE_FIXTURE_PANEL_ID,
  DEMO_INLINE_FIXTURE_PLUGIN_ID,
} from "./inline-fixture-plugin";
import type { DroneSkillContribution } from "@/lib/skills/plugin-skills";
import type { DroneTargetActionContribution } from "@/lib/skills/target-actions";
import type {
  PluginInstallSummary,
  PluginSlotName,
  PairedNodeProfile,
} from "@/lib/plugins/types";
import { slotToCapability } from "@/lib/plugins/types";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";

/**
 * Demo install row. Keeps the same shape as Convex
 * `cmd_pluginInstalls` + the denormalised manifest fields so the
 * per-drone view can render version + status pills without a
 * separate manifest fetch.
 */
export interface DemoPluginInstall {
  installId: string;
  agentId: string;
  pluginId: string;
  name: string;
  version: string;
  status: "installed" | "enabled" | "running" | "disabled" | "crashed";
  signed: boolean;
  firstParty: boolean;
  /** When true, contributes a `node.detail.tab` panel. */
  hasDroneDetailTab: boolean;
  droneDetailTabTitle?: string;
  droneDetailTabIcon?: string;
  droneDetailTabOrder?: number;
  droneDetailTabPanelId?: string;
  /** Node profiles the tab is offered on. Absent = any profile. */
  droneDetailTabProfile?: PairedNodeProfile[];
  /** Declarative parameters the plugin contributes to its tab's native panel. */
  parameters?: PluginParameter[];
}

/** A small parameter set so the native panel renders above the demo iframe
 * (a range, an enum, a number, and a boolean — one of each common widget). */
const FOLLOW_DEMO_PARAMETERS: PluginParameter[] = [
  {
    key: "follow_distance_m",
    schema: { type: "number", minimum: 2, maximum: 30, step: 0.5, default: 8 },
    binding: "plugin.config",
    ui: {
      widget: "range",
      label: "Follow distance (m)",
      group: "Follow",
      help: "Standoff distance the drone holds behind the target.",
      order: 10,
    },
  },
  {
    key: "follow_mode",
    schema: { type: "string", enum: ["chase", "orbit", "lead"], default: "chase" },
    binding: "plugin.config",
    ui: { widget: "enum", label: "Mode", group: "Follow", order: 20 },
  },
  {
    key: "max_speed_ms",
    schema: { type: "number", minimum: 1, maximum: 20, default: 6 },
    binding: "plugin.config",
    ui: { label: "Max speed (m/s)", group: "Limits", order: 30 },
  },
  {
    key: "lost_target_rth",
    schema: { type: "boolean", default: true },
    binding: "plugin.config",
    ui: {
      label: "Return home on lost target",
      group: "Limits",
      order: 40,
    },
  },
];

const DEMO_PLUGIN_INSTALLS: DemoPluginInstall[] = [
  // ── Drone 1: enabled vision-nav plugin + enabled telemetry logger ──
  {
    installId: "demo-install-001",
    agentId: "alpha-1",
    pluginId: "com.altnautica.vision-nav",
    name: "ADOS Vision Nav (OpenVINS)",
    version: "0.1.0",
    status: "running",
    signed: true,
    firstParty: true,
    hasDroneDetailTab: true,
    droneDetailTabTitle: "Vision Nav",
    droneDetailTabIcon: "compass",
    droneDetailTabOrder: 60,
    droneDetailTabPanelId: "vision-nav-tab",
    parameters: FOLLOW_DEMO_PARAMETERS,
  },
  {
    installId: "demo-install-002",
    agentId: "alpha-1",
    pluginId: "com.altnautica.telemetry-logger",
    name: "Telemetry Logger",
    version: "0.3.2",
    status: "running",
    signed: true,
    firstParty: true,
    hasDroneDetailTab: false,
  },
  // ── Drone 2: thermal cam enabled, geofence disabled ──
  {
    installId: "demo-install-003",
    agentId: "charlie-3",
    pluginId: "com.flir.thermal",
    name: "FLIR Lepton Thermal Camera",
    version: "1.0.0",
    status: "running",
    signed: true,
    firstParty: false,
    hasDroneDetailTab: true,
    droneDetailTabTitle: "Thermal Camera",
    droneDetailTabIcon: "thermometer",
    droneDetailTabOrder: 70,
    droneDetailTabPanelId: "thermal-tab",
  },
  {
    installId: "demo-install-004",
    agentId: "charlie-3",
    pluginId: "com.altnautica.geofence-watchdog",
    name: "Geofence Watchdog",
    version: "0.3.0",
    status: "disabled",
    signed: true,
    firstParty: true,
    hasDroneDetailTab: false,
  },
  // ── Drone 3: gimbal v2 enabled ──
  {
    installId: "demo-install-005",
    agentId: "delta-4",
    pluginId: "com.altnautica.gimbal-v2",
    name: "MAVLink Gimbal v2 Controller",
    version: "0.5.1",
    status: "running",
    signed: true,
    firstParty: true,
    hasDroneDetailTab: true,
    droneDetailTabTitle: "Gimbal",
    droneDetailTabIcon: "video",
    droneDetailTabOrder: 50,
    droneDetailTabPanelId: "gimbal-tab",
  },
];

/**
 * Mock install rows for a single demo drone, mapped to the shape the
 * per-drone list view expects. Empty array when no fixtures match.
 */
export function getDemoDronePluginInstalls(
  agentId: string,
): DemoPluginInstall[] {
  return DEMO_PLUGIN_INSTALLS.filter((p) => p.agentId === agentId);
}

/**
 * Mock plugin install summaries for use by the list view. Mirrors the
 * `PluginInstallSummary` shape so the list card can render without
 * knowing it is in demo mode.
 */
export function getDemoDronePluginSummaries(
  agentId: string,
): PluginInstallSummary[] {
  return getDemoDronePluginInstalls(agentId).map((p) => ({
    pluginId: p.pluginId,
    version: p.version,
    name: p.name,
    source: "local_file" as const,
    signerId: p.firstParty ? "altnautica-2026-A" : undefined,
    status: p.status,
    halves: ["agent", "gcs"],
  }));
}

/**
 * Mock `node.detail.tab` contributions for a single demo drone. Only
 * enabled installs surface a tab; disabled installs render in the
 * Plugins list with an Enable affordance instead. Sort happens at the
 * hook layer; this helper returns rows in fixture order.
 */
export function getDemoDronePluginContributions(
  agentId: string,
): DronePluginContribution[] {
  return getDemoDronePluginInstalls(agentId)
    .filter((p) => p.hasDroneDetailTab)
    .filter((p) => p.status === "running" || p.status === "enabled")
    .map<DronePluginContribution>((p) => ({
      installId: p.installId,
      pluginId: p.pluginId,
      panelId: p.droneDetailTabPanelId ?? "default",
      title: p.droneDetailTabTitle ?? p.name,
      icon: p.droneDetailTabIcon,
      order: p.droneDetailTabOrder ?? 60,
      version: p.version,
      enabled: true,
      profile: p.droneDetailTabProfile,
      parameters: p.parameters ?? [],
    }));
}

/**
 * Mock `flight.skill` contributions for a single demo drone. Demo drone 1's
 * Follow-Me reference plugin contributes one toggle behavior skill so the
 * cockpit Skill Bar shows a plugin-contributed slot without a real agent.
 */
const DEMO_SKILL_CONTRIBUTIONS: Record<string, DroneSkillContribution[]> = {
  "alpha-1": [
    {
      installId: "demo-install-001",
      pluginId: "com.altnautica.vision-nav",
      localId: "follow-me",
      label: "Follow Me",
      icon: "Crosshair",
      category: "behavior",
      toggle: true,
      confirm: false,
      armRequirement: "armed",
      configKey: "follow_me_active",
      stateTopic: "follow_me.state",
      defaultBinding: { key: "shift+f", gamepadButton: null },
    },
  ],
};

export function getDemoDroneSkillContributions(
  agentId: string,
): DroneSkillContribution[] {
  return (DEMO_SKILL_CONTRIBUTIONS[agentId] ?? []).map((c) => ({ ...c }));
}

/** A demo plugin target-action so the cockpit target popup shows a cross-plugin
 * action ("Follow this target") alongside the built-in Designate under
 * `npm run demo`, with no agent. Offered on every demo drone. */
const DEMO_TARGET_ACTIONS: DroneTargetActionContribution[] = [
  {
    installId: "demo-follow-me",
    pluginId: "com.altnautica.follow-me",
    localId: "follow",
    label: "Follow this target",
    icon: "Crosshair",
    order: 20,
    appliesToClass: "person",
    designate: true,
    configKey: "active",
    configValue: true,
    defaultKey: "f",
  },
];

export function getDemoDroneTargetActions(
  agentId: string,
): DroneTargetActionContribution[] {
  return agentId ? DEMO_TARGET_ACTIONS.map((c) => ({ ...c })) : [];
}

// ──────────────────────────────────────────────────────────────────────────
// Fleet-scoped (no-drone) demo contributions
//
// The six fleet UI slots (settings.section / fc.tab / hardware.tab /
// mission.template / map.overlay / notification.channel) mount once app-wide,
// not on a selected drone. They are fed by `useFleetPluginContributions`,
// which surfaces these fixtures in demo mode (the live producer returns [] in
// demo). One demo plugin contributes each slot so `npm run demo` lights up
// every fleet host.
// ──────────────────────────────────────────────────────────────────────────

/** One fleet slot contribution fixture. Maps 1-to-1 to the
 * `PluginSlotContribution & { slot }` shape the fleet host consumes. */
export interface DemoFleetSlotContribution {
  installId: string;
  pluginId: string;
  panelId: string;
  slot: PluginSlotName;
  title: string;
  /** Sort hint within a slot. Defaults to 60 in the producer when absent. */
  order: number;
  /** Capability ids the operator granted at install. The fleet host
   * capability-gates each contribution on the slot's `ui.slot.<id>` cap, so
   * each fixture must include the matching slot cap to mount. */
  grantedCapabilities: string[];
  /** Null-origin data: URL carrying a tiny self-describing HTML document so
   * the sandboxed iframe renders visibly with no backend. */
  bundleUrl: string;
}

/** Build a sandbox-safe HTML bundle for a demo fleet iframe. The document is
 * intentionally tiny: a dark-themed label so the operator sees the slot is
 * live. Emitted as a `blob:` URL because the app CSP is `frame-src 'self'
 * blob:` — a `data:` URL (used previously) is NOT in that allowlist and the
 * iframe would be blocked (leaving visible demo slots blank + a console
 * violation). Falls back to `data:` only where the Blob URL API is absent
 * (SSR); the iframes render client-side anyway. Production contributions load a
 * real signed bundle instead. */
function demoBundle(label: string, accent = "#38bdf8"): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
body{display:flex;align-items:center;justify-content:center;background:#0b0f14;color:#e5e7eb}
.card{border:1px solid ${accent}40;background:${accent}14;color:${accent};padding:8px 12px;font-size:12px;letter-spacing:.04em}
</style></head><body><div class="card">${label}</div></body></html>`;
  if (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof Blob !== "undefined"
  ) {
    try {
      return URL.createObjectURL(new Blob([html], { type: "text/html" }));
    } catch {
      /* fall through to the data: fallback */
    }
  }
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const DEMO_FLEET_CONTRIBUTIONS: DemoFleetSlotContribution[] = [
  {
    installId: "demo-fleet-settings",
    pluginId: "com.altnautica.fleet-settings-demo",
    panelId: "demo-settings-section",
    slot: "settings.section",
    title: "Demo Settings Section",
    order: 50,
    grantedCapabilities: [slotToCapability("settings.section")],
    bundleUrl: demoBundle("Demo plugin · Settings section"),
  },
  {
    installId: "demo-fleet-fc-tab",
    pluginId: "com.altnautica.fleet-fc-demo",
    panelId: "demo-fc-tab",
    slot: "fc.tab",
    title: "Demo FC Tab",
    order: 55,
    grantedCapabilities: [slotToCapability("fc.tab")],
    bundleUrl: demoBundle("Demo plugin · FC Configure tab", "#a78bfa"),
  },
  {
    installId: "demo-fleet-hardware-tab",
    pluginId: "com.altnautica.fleet-hardware-demo",
    panelId: "demo-hardware-tab",
    slot: "hardware.tab",
    title: "Demo Hardware Panel",
    order: 60,
    grantedCapabilities: [slotToCapability("hardware.tab")],
    bundleUrl: demoBundle("Demo plugin · Hardware panel", "#34d399"),
  },
  {
    installId: "demo-fleet-mission-template",
    pluginId: "com.altnautica.fleet-mission-demo",
    panelId: "demo-mission-template",
    slot: "mission.template",
    title: "Demo Mission Template",
    order: 60,
    grantedCapabilities: [slotToCapability("mission.template")],
    bundleUrl: demoBundle("Demo plugin · Mission template", "#fbbf24"),
  },
  {
    installId: "demo-fleet-map-overlay",
    pluginId: "com.altnautica.fleet-map-demo",
    panelId: "demo-map-overlay",
    slot: "map.overlay",
    title: "Demo Map Overlay",
    order: 60,
    grantedCapabilities: [slotToCapability("map.overlay")],
    bundleUrl: demoBundle("Demo · Map overlay", "#f472b6"),
  },
  {
    installId: "demo-fleet-notification-channel",
    pluginId: "com.altnautica.fleet-notify-demo",
    panelId: "demo-notification-channel",
    slot: "notification.channel",
    title: "Demo Notification Channel",
    order: 60,
    grantedCapabilities: [
      slotToCapability("notification.channel"),
      "event.publish",
    ],
    bundleUrl: demoBundle("Demo · Notification channel"),
  },
];

/**
 * Fleet-scoped demo contributions, one per fleet slot. Returned by
 * `useFleetPluginContributions` in demo mode so every fleet host renders a
 * contribution under `npm run demo`. Each fixture carries the matching
 * `ui.slot.<id>` capability so the slot's capability gate admits it.
 */
export function getDemoFleetPluginContributions(): DemoFleetSlotContribution[] {
  return DEMO_FLEET_CONTRIBUTIONS.map((c) => ({
    ...c,
    grantedCapabilities: [...c.grantedCapabilities],
  }));
}

/**
 * Demo install rows carrying node pages: the inline fixture module's one
 * Agent-sidebar page in the Software section, offered on every demo drone.
 * Read by `useNodePluginPages` in demo mode; the demo contribution producer
 * mounts the fixture module behind it.
 */
export function getDemoNodePageInstallRows(): InstallDetailRow[] {
  return [
    {
      installId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
      pluginId: DEMO_INLINE_FIXTURE_PLUGIN_ID,
      version: "1.0.0",
      name: "Inline Fixture",
      gcsContributes: [
        {
          slot: "node.agent.page",
          panelId: DEMO_INLINE_FIXTURE_PANEL_ID,
          title: "Inline Fixture",
          section: "software",
          profile: ["drone"],
        },
      ],
    },
  ];
}
