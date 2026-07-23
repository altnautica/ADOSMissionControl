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
import { type EffProfile, NODE_ACCENT_VAR } from "@/lib/nodes/node-profile";
import { nodeGlyph } from "@/components/command/nodes/node-glyph";
import type { StatusLevel } from "@/components/ui/status-dot";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useComputeStore } from "@/stores/compute-store";

export type { EffProfile };

/** A `drone`-profile node with no paired agent IS a bare flight controller. */
export function effectiveNodeProfile(ctx: SurfaceContext): EffProfile {
  const p = ctx.drone.profile ?? "drone";
  if (p === "ground-station") return "ground-station";
  if (p === "workstation") return "workstation";
  return ctx.agentDeviceId === null ? "flight-controller" : "drone";
}

export interface NodeBrandDescriptor {
  effProfile: EffProfile;
  Icon: LucideIcon;
  /** CSS var name for the profile identity accent. */
  accentVar: string;
  title: string;
  typeBadge: string;
  /** Secondary badge — GPU backend (workstation) or role, when present. */
  subBadge?: string;
  statusLine: string;
  statusLevel: StatusLevel;
}

function profileKey(p: EffProfile): string {
  return p === "flight-controller"
    ? "flightController"
    : p === "ground-station"
      ? "groundStation"
      : p; // "drone" | "workstation"
}

export function useNodeBrand(args: {
  profile: EffProfile;
  title: string;
  /** When set, the display name of the ground node this drone is reached
   * through over WFB. Surfaces a "linked via WFB through <node>" sub-badge. */
  reachedViaName?: string | null;
}): NodeBrandDescriptor {
  const { profile, title, reachedViaName } = args;
  const t = useTranslations("nodeConsole");
  const connected = useAgentConnectionStore((s) => s.connected);
  const stale = useAgentSystemStore((s) => s.stale);
  const cluster = useComputeStore((s) => s.cluster);
  const gpu = useComputeStore((s) => s.gpu);

  let statusLine: string;
  let statusLevel: StatusLevel;
  let subBadge: string | undefined;

  if (profile === "workstation") {
    const role = cluster.role;
    const roleLabel =
      role === "master"
        ? t("hero.roleMaster")
        : role === "slave"
          ? t("hero.roleSlave")
          : t("hero.roleStandalone");
    const idle = cluster.aggregateWorkersIdle ?? cluster.workersIdle;
    const queued = cluster.queueDepth;
    if (role !== null && idle != null && queued != null) {
      statusLine = t("hero.workstationSummary", { role: roleLabel, idle, queued });
      statusLevel = "good";
    } else {
      statusLine = t("hero.awaiting");
      statusLevel = "idle";
    }
    if (gpu?.metal) subBadge = gpu.metal;
  } else {
    // drone / flight-controller / ground-station: a connectivity line for now;
    // P4 enriches the drone/FC line (arm/mode/GPS/heartbeat) and P6 the GS line
    // (RX/uplink/mesh).
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
    // A WFB-linked drone reached transitively through a ground node names its
    // reach hop as the sub-badge.
    if (reachedViaName) {
      subBadge = t("provenance.linkedViaWfbShort", { node: reachedViaName });
    }
  }

  return {
    effProfile: profile,
    Icon: nodeGlyph(profile),
    accentVar: NODE_ACCENT_VAR[profile],
    title,
    typeBadge: t(`type.${profileKey(profile)}`),
    subBadge,
    statusLine,
    statusLevel,
  };
}
