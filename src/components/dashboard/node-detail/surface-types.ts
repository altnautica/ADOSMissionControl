/**
 * @module node-detail/surface-types
 * @description Contract for the profile-driven node-detail surface registry.
 * A "surface" is one tab in the unified node-detail panel; the registry maps
 * each agent profile to an ordered list of surfaces and the panel resolves +
 * renders them. Built-in surfaces and plugin-contributed tabs share this
 * descriptor shape, so adding a profile or a surface is a declarative change.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import type { FleetDrone } from "@/lib/types";
import type {
  AgentRole,
  CapabilityPresence,
} from "@/stores/agent-capabilities/types";
import type { FirmwareType } from "@/lib/protocol/types/enums";
import type { RelayReach } from "@/lib/nodes/relay-reach";

export type NodeProfile = "drone" | "ground-station" | "workstation" | "compute";

/** Everything a surface's `when` / `render` may need, derived once per
 * render from the selected node + the focused agent's capabilities. */
export interface SurfaceContext {
  droneId: string;
  drone: FleetDrone;
  displayName: string;
  isConnected: boolean;
  /** Firmware of this node's connected FC (from the managed protocol), or null
   * when no FC is linked. Lets a surface gate on firmware family — e.g. the
   * ArduPilot-only Scripts tab (`firmwareType?.startsWith("ardupilot")`). */
  firmwareType: FirmwareType | null;
  agentDeviceId: string | null;
  /** OR of `agentDeviceId !== null` (direct reach) and
   * `drone.agentIdentityKnown === true` (confirmed identity via relay).
   * "Has a real companion agent" — never a replacement for `agentDeviceId`,
   * which still answers "can the GCS reach it directly." */
  agentIdentityKnown: boolean;
  /** When the node is reached through a ground node's WFB relay but the
   * ground station runs the relay-proxy route, this carries the ground
   * node's host + API key + the linked drone's peer device id, so surfaces
   * can route `/api/...` calls through the relay-proxy. `null` for a
   * directly-paired node (use `agentDeviceId` instead) or when the relay-
   * proxy is unavailable. */
  relayReach: RelayReach | null;
  fcLinking: boolean;
  /**
   * Tri-state capability gates for THIS node, read from the per-device
   * capability slice. `"unknown"` means the GCS has never heard this node
   * describe itself — it is NOT `"absent"`, so a surface must neither
   * advertise the capability nor claim the hardware is missing. A gate
   * therefore tests `=== "present"`.
   */
  radioPresent: CapabilityPresence;
  visionPresent: CapabilityPresence;
  /** Whether the focused agent advertises a CRSF / ExpressLRS control lane
   * (`crsf !== null` on the capability store). Gates the RC / ELRS Link tab:
   * the transmitter is the ground node, and a drone can host an agent-relay
   * ELRS TX, so the tab appears on both profiles but only when a lane is
   * advertised. A node with no RC lane never shows it. */
  crsfPresent: CapabilityPresence;
  role: AgentRole;
  /** False until this node has reported its capabilities at least once. A
   * surface that must not disappear mid-use reads this to hold its previous
   * answer rather than collapsing on a gap in the reading. */
  capabilitiesKnown: boolean;
  /** Companion surfaces render as lock-badged teasers when the node has no
   * paired agent (a flight-controller-only drone). */
  showLockedTabs: boolean;
  /** Agent-sidebar pages installed plugins contribute to THIS node, already
   * narrowed to its profile. The Agent page places them into its sections. */
  pluginAgentPages: ReadonlyArray<AgentNavContribution>;
}

/**
 * The device id of the node a surface is rendered for: its direct agent
 * identity when the GCS has one, else — for a drone reached only over a ground
 * node's radio — that drone's own peer id on the relay. Null when the node has
 * no agent identity at all (a bare flight controller).
 *
 * Every surface that writes to a node's agent resolves its transport from
 * THIS, never from `agent-connection-store`: that store names the focused node
 * and lags the render, so an ambient resolution can send the write to the
 * previously connected node.
 */
export function surfaceNodeDeviceId(
  ctx: Pick<SurfaceContext, "agentDeviceId" | "relayReach">,
): string | null {
  return ctx.agentDeviceId ?? ctx.relayReach?.peerDeviceId ?? null;
}

export interface SurfaceSpec {
  /** Tab id; also the aria + active-tab key. Unique within a profile.
   * Stable across label renames so persisted/deep-linked tabs keep resolving. */
  id: string;
  /** Full i18n path resolved by the panel via a namespace-less
   * useTranslations(), so a surface can reuse any existing key. */
  labelKey: string;
  /** A literal label that wins over `labelKey`: a plugin surface carries the
   * title its manifest declares, which is not an i18n key. */
  label?: string;
  /** Full i18n path for the section this surface belongs to. The panel groups
   * consecutive surfaces that share a `group` under one section header for the
   * two-tier tab layout. Absent = ungrouped (rendered with no section label).
   * Adjacent surfaces with the same group string must sit next to each other in
   * the profile's list — grouping does not reorder. */
  group?: string;
  /** Availability gate (capability / role / connection). Absent = always. */
  when?: (ctx: SurfaceContext) => boolean;
  /** Body renderer. Returns an existing surface component. */
  render: (ctx: SurfaceContext) => ReactNode;
}

/** One Agent-sidebar page a plugin contributes to a node. */
export interface AgentNavContribution {
  /** Sidebar id, unique across built-ins and plugins (see `pluginPageId`). */
  id: string;
  pluginId: string;
  installId: string;
  /** The page id within the plugin (`agent_pages[].id`). */
  panelId: string;
  /** The manifest title, rendered verbatim. */
  label: string;
  icon: ReactNode;
  /** `NAV_SECTIONS` key; an unknown key lands in the Software section. */
  section: string;
  /** A built-in sub-page id, or another page of the same plugin, this page
   * sits directly below. Ignored when that page is not in the same section. */
  after?: string;
  order: number;
  /** Another page of the same plugin this page is the Setup segment of. */
  setupFor?: string;
  render: (ctx: SurfaceContext) => ReactNode;
}

/** One top-level node-detail surface a plugin contributes. */
export interface ProfileSurfaceContribution {
  spec: SurfaceSpec & { label: string };
  /** Node profiles the surface is offered on. */
  profile: ReadonlyArray<NodeProfile>;
  /** The tab-strip band (an i18n group key) the surface joins; absent = it
   * sits just before the Agent surface. */
  group?: string;
  order: number;
}

/** Stable sidebar / tab id for a plugin page: keyed by plugin id rather than
 * install id so the remembered page survives a reinstall. */
export function pluginPageId(pluginId: string, panelId: string): string {
  return `x:${pluginId}/${panelId}`;
}
