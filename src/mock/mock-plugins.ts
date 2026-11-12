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
import { DEMO_CAPTURE_INSTALL_ROW } from "./mock-visor-surfaces";
import type { DroneTargetActionContribution } from "@/lib/skills/target-actions";
import type {
  PluginInstallSummary,
  PluginSlotName,
  PairedNodeProfile,
} from "@/lib/plugins/types";
import { slotToCapability } from "@/lib/plugins/types";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import type { ParsedManifest } from "@/components/plugins/transports/manifest-types";
import {
  FOLLOW_ME,
  GIMBAL,
  SIYI_POD,
  THERMAL,
  VISION_NAV,
  demoReleaseManifest,
  type DemoExtensionRelease,
} from "./extension-manifests";

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
  /** Why the node stopped or refused the plugin (the agent's
   * `failure_reason`). Set on a failed install only. */
  failureReason?: string;
}

/** A first-party install of a published release: its id, name, version, tab
 * and parameters come from the release manifest, never a hand-copied list. */
function releaseInstall(
  release: DemoExtensionRelease,
  install: Pick<DemoPluginInstall, "installId" | "agentId" | "status" | "failureReason">,
): DemoPluginInstall {
  const manifest = demoReleaseManifest(release);
  const tab = manifest.contributesTabs?.[0];
  return {
    ...install,
    pluginId: manifest.pluginId,
    name: manifest.name,
    version: manifest.version,
    signed: true,
    firstParty: true,
    hasDroneDetailTab: tab !== undefined,
    droneDetailTabTitle: tab?.title,
    droneDetailTabIcon: tab?.icon,
    droneDetailTabOrder: tab?.order,
    droneDetailTabPanelId: tab?.panelId,
    droneDetailTabProfile: tab?.profile ? [...tab.profile] : undefined,
    parameters: manifest.contributesParameters ? [...manifest.contributesParameters] : undefined,
  };
}

const DEMO_PLUGIN_INSTALLS: DemoPluginInstall[] = [
  // ── Drone 1: vision-nav, follow-me and the optical pod running ──
  // Vision-nav declares no parameters; its tab body is the demo inline panel
  // (`mock-vision-nav`). The others render their declared parameters.
  releaseInstall(VISION_NAV, { installId: "demo-install-001", agentId: "alpha-1", status: "running" }),
  releaseInstall(FOLLOW_ME, { installId: "demo-install-006", agentId: "alpha-1", status: "running" }),
  releaseInstall(SIYI_POD, { installId: "demo-install-008", agentId: "alpha-1", status: "running" }),
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
  // ── Drone 2: thermal camera running, geofence disabled, optical pod failed ──
  releaseInstall(THERMAL, { installId: "demo-install-003", agentId: "charlie-3", status: "running" }),
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
  // A plugin the host stopped because its installed files no longer match
  // the digests recorded at install. The agent reports it `failed` with the
  // reason; the card renders the error state and the reason line.
  releaseInstall(SIYI_POD, {
    installId: "demo-install-007",
    agentId: "charlie-3",
    status: "crashed",
    failureReason: "tampered: agent/src/altnautica_siyi_pod/pod.py digest mismatch",
  }),
  // ── Drone 3: gimbal running ──
  releaseInstall(GIMBAL, { installId: "demo-install-005", agentId: "delta-4", status: "running" }),
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

/** The release each first-party demo install mirrors, by extension id. */
export const DEMO_RELEASES: ReadonlyMap<string, DemoExtensionRelease> = new Map(
  [VISION_NAV, FOLLOW_ME, SIYI_POD, THERMAL, GIMBAL].map((r) => [demoReleaseManifest(r).pluginId, r]),
);

/** Running installs on a drone paired with the manifest of their release. */
export function getDemoRunningReleaseInstalls(
  agentId: string,
): { install: DemoPluginInstall; manifest: ParsedManifest }[] {
  return getDemoDronePluginInstalls(agentId).flatMap((install) => {
    const release = DEMO_RELEASES.get(install.pluginId);
    return install.status === "running" && release
      ? [{ install, manifest: demoReleaseManifest(release) }]
      : [];
  });
}

/** The cockpit target-popup actions the drone's running installs declare
 * (follow-me's Follow / Stop following, the gimbal's Aim), served per drone
 * with no agent. */
export function getDemoDroneTargetActions(
  agentId: string,
): DroneTargetActionContribution[] {
  return getDemoRunningReleaseInstalls(agentId).flatMap(({ install, manifest }) =>
    (manifest.contributesTargetActions ?? []).map((a) => ({
      installId: install.installId,
      pluginId: install.pluginId,
      localId: a.id,
      label: a.label ?? a.id,
      icon: a.icon,
      order: a.order,
      appliesToClass: a.appliesToClass,
      designate: a.designate,
      configKey: a.configKey,
      configValue: a.configValue,
      defaultKey: a.defaultKey,
    })),
  );
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
 * real signed bundle instead. A `transparent` bundle (the map overlay) leaves
 * the page clear so the map shows through, as a real overlay plugin must; it
 * declares the same colour scheme as the plugin frame shell so the browser
 * does not paint the frame opaque. */
export function demoBundleHtml(label: string, accent = "#38bdf8", transparent = false): string {
  const background = transparent ? "transparent" : "#0A0A0A";
  // A map overlay keeps its card in the bottom-left corner, clear of the
  // planner's tool rail (top-left), hint (top-centre) and coordinate widget
  // (bottom-right), so it never covers the plan in the middle of the map.
  const placement = transparent
    ? "align-items:flex-end;justify-content:flex-start;padding:0 0 12px 12px;box-sizing:border-box"
    : "align-items:center;justify-content:center";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="dark light"><style>
html,body{margin:0;height:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
body{display:flex;${placement};background:${background};color:#EDEDED}
.card{border:1px solid ${accent}40;background:${accent}14;color:${accent};padding:8px 12px;font-size:12px;letter-spacing:.04em}
</style></head><body><div class="card">${label}</div></body></html>`;
}

function demoBundle(label: string, accent = "#38bdf8", transparent = false): string {
  const html = demoBundleHtml(label, accent, transparent);
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
    bundleUrl: demoBundle("Demo · Map overlay", "#f472b6", true),
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
 * Demo install rows carrying node pages: the world-engine extension's Agent
 * pages and node surfaces, as its manifest declares them. Read by
 * `useNodePluginPages` in demo mode; the demo contribution producer mounts the
 * bodies behind them.
 */
export function getDemoNodePageInstallRows(): InstallDetailRow[] {
  return [DEMO_CAPTURE_INSTALL_ROW];
}
