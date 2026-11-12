"use client";

/**
 * @module nodes/NodeRow
 * @description One profile-aware expanded sidebar row (52 px) rendering any
 * node — drone, flight-controller, ground-station, workstation, or visor — from the
 * same merged node view-model. Type is the glyph on an outlined tile; health is
 * an independent dot at the tile's corner; the two are never conflated.
 * A workstation row cannot render a flight badge by construction. Rendered by
 * the dashboard fleet sidebar (DroneListPanel) for every node profile, and by
 * the collapsed rail (NodeRail).
 * @license GPL-3.0-only
 */

import { memo } from "react";
import { useClockTick } from "@/lib/agent/freshness";
import { MoreHorizontal, Plane } from "lucide-react";
import { openFlightScreen } from "@/components/cockpit/flight/open-flight-screen";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import {
  type EffProfile,
  agentEffProfile,
  groundRoleKey,
} from "@/lib/nodes/node-profile";
import { NodeTile } from "./NodeTile";
import { NodeMetaLine } from "./NodeMetaLine";
import { NodeStatusHoverCard } from "./NodeStatusHoverCard";
import { Tooltip } from "@/components/ui/tooltip";
import type { StatusLevel } from "@/lib/status-level";
import { droneLiveness } from "../fleet/types";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { useTranslations } from "next-intl";

/** Health only, from the verified lastSeen freshness signal (never a
 * fabricated reading). `stale` maps to the 4th `serious` step so a degraded but
 * not-dead node is distinguishable from both healthy and offline. */
export function nodeStatusLevel(node: FleetNodeEntry): StatusLevel {
  const live = droneLiveness(node);
  return live === "live" ? "good" : live === "stale" ? "serious" : "offline";
}

/** The nodeConsole `type.*` translation key for a profile. */
export function profileTypeKey(
  p: EffProfile,
): "drone" | "flightController" | "groundStation" | "workstation" | "visor" | "unknown" {
  return p === "flight-controller"
    ? "flightController"
    : p === "ground-station"
      ? "groundStation"
      : p; // "drone" | "workstation" | "visor" | "unknown"
}

/**
 * The resolved `nodeConsole.*` strings `nodeSubtitle` needs. Passed in rather
 * than read from a hook so the function stays pure and unit-testable.
 */
export interface NodeSubtitleLabels {
  /** `nodeConsole.liveness.offline` */
  offline: string;
  /** `nodeConsole.role.relay` */
  relay: string;
  /** `nodeConsole.role.receiver` */
  receiver: string;
}

/** Resolve the subtitle labels from a `nodeConsole` translator. Shared so the
 * sidebar row and the board identity cell cannot drift apart. */
export function nodeSubtitleLabels(
  t: (key: string) => string,
): NodeSubtitleLabels {
  return {
    offline: t("liveness.offline"),
    relay: t("role.relay"),
    receiver: t("role.receiver"),
  };
}

/**
 * Profile-correct subtitle: role/type first, then board, collapsing to a single
 * "Offline" line when the freshness signal says the node is unreachable (no
 * stale sub-metrics). `typeLabel` is the resolved `type.*` string.
 */
export function nodeSubtitle(
  node: FleetNodeEntry,
  effProfile: EffProfile,
  typeLabel: string,
  labels: NodeSubtitleLabels,
): string {
  if (droneLiveness(node) === "offline") return labels.offline;
  const parts: string[] = [];
  // A relay or receiver names its role; a direct or unreported role leads with
  // the node type instead.
  const role = groundRoleKey(node.role);
  if (effProfile === "ground-station" && (role === "relay" || role === "receiver")) {
    parts.push(labels[role]);
  } else {
    parts.push(typeLabel);
  }
  if (node.board) parts.push(node.board);
  return parts.join(" · ");
}

interface NodeRowProps {
  node: FleetNodeEntry;
  selected: boolean;
  onSelect: (node: FleetNodeEntry) => void;
  onContext: (nodeId: string, x: number, y: number) => void;
}

/**
 * Memoised on entry identity: the fleet projection keeps an unchanged node's
 * row object stable, so a heartbeat for one node re-renders only its row. The
 * row subscribes to the shared 1 Hz clock itself so freshness still advances.
 */
export const NodeRow = memo(function NodeRow({ node, selected, onSelect, onContext }: NodeRowProps) {
  useClockTick();
  const t = useTranslations("nodeConsole");
  const tFly = useTranslations("flightScreen");
  // A paired node in the sidebar always carries an agent, so a `drone`-profile
  // entry is a `drone` here; the bare flight controller is a node-detail concern.
  const effProfile = agentEffProfile(node.profile);
  const status = nodeStatusLevel(node);
  const typeLabel = t(`type.${profileTypeKey(effProfile)}`);

  // Personalization overlay (pure presentation) keyed by the stable deviceId.
  // Selecting only this node's slice keeps another node's edit from re-rendering
  // this row.
  const personalization = useNodePersonalizationStore(
    (s) => s.byNode[node.deviceId],
  );
  const displayName = personalization?.label?.trim() || node.name;

  const row = (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      aria-label={`${displayName} · ${typeLabel}`}
      onClick={() => onSelect(node)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(node);
        }
        // Shift+F10 opens the context menu from the keyboard (parity with
        // right-click and the overflow button).
        if (e.key === "F10" && e.shiftKey) {
          e.preventDefault();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onContext(node._id, rect.left + 8, rect.bottom);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // A right-click does not move focus; focus the row first so the menu,
        // which records the focused element as its opener, returns here on close.
        (e.currentTarget as HTMLElement).focus();
        onContext(node._id, e.clientX, e.clientY);
      }}
      className={cn(
        "group relative flex h-[52px] cursor-pointer items-center gap-2.5 rounded-[4px] px-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        selected
          ? "bg-white/[0.04] ring-1 ring-inset ring-accent-primary/50"
          : "hover:bg-white/[0.03]",
      )}
    >
      <NodeTile node={node} title={typeLabel} />

      {/* Two lines: the name owns line 1 with the actions; line 2 is the
          one-line meta summary, which never wraps or steals the name's width. */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
            {displayName}
          </p>
          {effProfile === "drone" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFlightScreen(node._id);
              }}
              onKeyDown={(e) => e.stopPropagation()}
              title={tFly("fly")}
              aria-label={`${tFly("fly")}: ${displayName}`}
              data-testid="fly-button-row"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
                selected
                  ? "border-transparent bg-accent-primary text-accent-foreground"
                  : "border-border-default text-text-secondary hover:border-accent-primary hover:text-accent-primary",
              )}
            >
              <Plane size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onContext(node._id, rect.right, rect.bottom);
            }}
            title={t("actions.menu")}
            aria-label={t("actions.nodeActions")}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-text-tertiary opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        <NodeMetaLine node={node} effProfile={effProfile} />
      </div>
    </div>
  );

  // The whole row is the hover trigger for the profile-aware status card.
  return (
    <Tooltip
      triggerClassName="relative block w-full"
      position="right"
      multiline
      content={<NodeStatusHoverCard node={node} />}
    >
      {row}
    </Tooltip>
  );
});
