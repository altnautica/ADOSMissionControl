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
import type { AgentRole } from "@/stores/agent-capabilities/types";
import type { FirmwareType } from "@/lib/protocol/types/enums";

export type NodeProfile = "drone" | "ground-station" | "workstation";

/** The ground-station relay-proxy reach for a WFB-linked drone. Carries
 * the ground node's host + API key and the linked drone's peer device id,
 * so the GCS can route `/api/...` calls through the ground station's
 * relay-proxy route. */
export interface RelayReach {
  /** The ground station's base URL (e.g. `http://192.168.1.50:8080`). */
  baseUrl: string;
  /** The ground station's API key (X-ADOS-Key). */
  apiKey: string;
  /** The linked drone's device id, forwarded as a path segment. */
  peerDeviceId: string;
}

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
  radioPresent: boolean;
  visionPresent: boolean;
  /** Whether the focused agent advertises a CRSF / ExpressLRS control lane
   * (`crsf !== null` on the capability store). Gates the RC / ELRS Link tab:
   * the transmitter is the ground node, and a drone can host an agent-relay
   * ELRS TX, so the tab appears on both profiles but only when a lane is
   * advertised. A node with no RC lane never shows it. */
  crsfPresent: boolean;
  role: AgentRole;
  /** Companion surfaces render as lock-badged teasers when the node has no
   * paired agent (a flight-controller-only drone). */
  showLockedTabs: boolean;
  /** Whether a first-party feature is enabled for THIS node (reactive, from
   * `node-features-store`). Gates opt-in feature surfaces — the drone World Model
   * + Live World tabs and the ground-station Atlas relay
   * (`isFeatureEnabled("world-model")`). A feature is off until the operator
   * turns it on in the Status-tab Features toggle. The workstation treats Atlas
   * as a default and does not gate on this. */
  isFeatureEnabled: (featureId: string) => boolean;
  /** Whether the focused drone is actively capturing an Atlas session
   * (reactive, from `atlas-readiness-store.isCapturing(deviceId)`). Gates the
   * Live World surface so it shows only while capturing — one drone tab when
   * idle, two while capturing. */
  atlasCapturing: boolean;
}

export interface SurfaceSpec {
  /** Tab id; also the aria + active-tab key. Unique within a profile.
   * Stable across label renames so persisted/deep-linked tabs keep resolving. */
  id: string;
  /** Full i18n path resolved by the panel via a namespace-less
   * useTranslations(), so a surface can reuse any existing key. */
  labelKey: string;
  /** Full i18n path for the section this surface belongs to. The panel groups
   * consecutive surfaces that share a `group` under one section header for the
   * two-tier tab layout. Absent = ungrouped (rendered with no section label).
   * Adjacent surfaces with the same group string must sit next to each other in
   * the profile's list — grouping does not reorder. */
  group?: string;
  /** Availability gate (capability / role / connection). Absent = always. */
  when?: (ctx: SurfaceContext) => boolean;
  /** When true the tab shows a lock badge and the panel renders the link-up
   * teaser instead of the body. Absent = never locked. */
  locked?: (ctx: SurfaceContext) => boolean;
  /** Body renderer. Returns an existing surface component. */
  render: (ctx: SurfaceContext) => ReactNode;
}
