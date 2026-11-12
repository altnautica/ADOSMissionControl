"use client";

/**
 * The per-profile node brand descriptor — the single source of truth for how a
 * node is framed across the hero, sidebar, and fleet card. `effectiveNodeProfile`
 * is a view-model discriminator only (the registry still keys on the real
 * `drone.profile`); `useNodeBrand` composes the live identity + status line.
 *
 * @module node-brand
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import type { SurfaceContext } from "./surface-types";
import {
  type EffProfile,
  NODE_ACCENT_VAR,
  agentEffProfile,
} from "@/lib/nodes/node-profile";
import { nodeGlyph } from "@/components/command/nodes/node-glyph";
import type { StatusLevel } from "@/lib/status-level";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useDroneStore } from "@/stores/drone-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { isFresh } from "@/lib/telemetry/freshness";

export type { EffProfile };

/** A `drone`-profile node with no paired agent IS a bare flight controller. */
export function effectiveNodeProfile(ctx: SurfaceContext): EffProfile {
  const p = agentEffProfile(ctx.drone.profile);
  if (p !== "drone") return p;
  return ctx.agentIdentityKnown ? "drone" : "flight-controller";
}

/** The node's title: an operator-set name wins, but a metadata profile still
 *  carrying its default (the bare id) yields to the fleet row's name, so the
 *  page and the fleet list name the node the same way. */
export function nodeDisplayName(
  metadataName: string | undefined,
  fleetName: string | undefined,
  ids: readonly string[],
): string {
  if (metadataName && !ids.includes(metadataName)) return metadataName;
  return fleetName || metadataName || ids[0];
}

/** Whether this node's FC session is open AND its heartbeat is fresh on the
 *  shared clock. An open transport with a silent FC (a port with no MAVLink)
 *  is not live. Reads the selected vehicle's heartbeat: the node panel
 *  selects the node it shows. */
export function useFcHeartbeatFresh(fcConnected: boolean): boolean {
  const fcHeartbeatAt = useDroneStore((s) => s.lastHeartbeat);
  useClockTick();
  const now = useClockStore((s) => s.now);
  return fcConnected && isFresh(fcHeartbeatAt, now);
}

export interface NodeBrandDescriptor {
  effProfile: EffProfile;
  Icon: LucideIcon;
  /** CSS var name for the profile identity accent. */
  accentVar: string;
  title: string;
  typeBadge: string;
  /** Secondary badge — the WFB reach hop, when present. */
  subBadge?: string;
  /** What the status line describes: the flight controller or the agent. */
  statusSubject: string;
  statusLine: string;
  statusLevel: StatusLevel;
}

function profileKey(p: EffProfile): string {
  return p === "flight-controller"
    ? "flightController"
    : p === "ground-station"
      ? "groundStation"
      : p; // "drone" | "workstation" | "visor" | "unknown"
}

export function useNodeBrand(args: {
  profile: EffProfile;
  title: string;
  /** When set, the display name of the ground node this drone is reached
   * through over WFB. Surfaces a "linked via WFB through <node>" sub-badge. */
  reachedViaName?: string | null;
  /** Whether the GCS holds a managed FC session for this node
   * (`SurfaceContext.isConnected`). A bare flight controller has no agent,
   * so its status comes from this session, never the agent connection. */
  fcConnected?: boolean;
}): NodeBrandDescriptor {
  const { profile, title, reachedViaName, fcConnected = false } = args;
  const t = useTranslations("nodeConsole");
  const connected = useAgentConnectionStore((s) => s.connected);
  const stale = useAgentSystemStore((s) => s.stale);
  // The open node's FC heartbeat, aged on the shared clock so a silent link
  // reads as reconnecting.
  const fcFresh = useFcHeartbeatFresh(fcConnected);
  let statusLine: string;
  let statusLevel: StatusLevel;
  let subBadge: string | undefined;

  if (profile === "flight-controller") {
    if (fcFresh) {
      statusLine = t("hero.online");
      statusLevel = "good";
    } else if (fcConnected) {
      statusLine = t("hero.reconnecting");
      statusLevel = "serious";
    } else {
      statusLine = t("hero.offline");
      statusLevel = "offline";
    }
  } else {
    // Every agent-backed profile: the node's agent connection.
    if (connected) {
      statusLine = t("hero.online");
      statusLevel = "good";
    } else if (stale) {
      statusLine = t("hero.reconnecting");
      statusLevel = "serious";
    } else {
      statusLine = t("hero.offline");
      statusLevel = "offline";
    }
  }
  // A WFB-linked node reached transitively through a ground node names its
  // reach hop as the sub-badge.
  if (reachedViaName) {
    subBadge = t("provenance.linkedViaWfbShort", { node: reachedViaName });
  }

  return {
    effProfile: profile,
    Icon: nodeGlyph(profile),
    accentVar: NODE_ACCENT_VAR[profile],
    title,
    typeBadge: t(`type.${profileKey(profile)}`),
    subBadge,
    statusSubject: profile === "flight-controller" ? t("hero.subjectFc") : t("hero.subjectAgent"),
    statusLine,
    statusLevel,
  };
}
