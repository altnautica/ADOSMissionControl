"use client";

/**
 * @module nodes/NodeTile
 * @description The one node identity tile: a 28 px outlined square holding the
 * type glyph (or the operator's initials) with a small liveness dot at its
 * bottom-right corner. Type and health never share a channel: the glyph says
 * what the node is, the dot says whether it is alive. Rendered by the sidebar
 * row, the collapsed rail and the board identity cell, so the three cannot
 * drift apart.
 * @license GPL-3.0-only
 */

import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { agentEffProfile, swatchVar } from "@/lib/nodes/node-profile";
import type { StatusLevel } from "@/lib/status-level";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { NodeGlyph } from "./node-glyph";
import { nodeStatusLevel } from "./NodeRow";

/**
 * The liveness dot colour per health level. Healthy reads green here because
 * the dot is small and the tile itself stays neutral; offline drops to the
 * tertiary text tone.
 */
export const STATUS_DOT: Record<StatusLevel, string> = {
  good: "bg-status-success",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-error",
  idle: "bg-accent-primary",
  offline: "bg-text-tertiary",
};

export function NodeTile({
  node,
  title,
  className,
}: {
  node: FleetNodeEntry;
  /** Tooltip for the tile (the node type). */
  title?: string;
  className?: string;
}) {
  const effProfile = agentEffProfile(node.profile);
  const status = nodeStatusLevel(node);
  // Pure presentation keyed by the stable deviceId; narrowed to this node's
  // slice so another node's edit does not re-render this tile.
  const personalization = useNodePersonalizationStore((s) => s.byNode[node.deviceId]);
  const swatchColor = personalization?.color
    ? `var(${swatchVar(personalization.color)})`
    : undefined;

  return (
    <div
      className={cn(
        "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border border-border-default",
        className,
      )}
      title={title}
      data-testid="node-tile"
    >
      {personalization?.icon ? (
        <span
          className="text-[10px] font-semibold leading-none text-text-secondary"
          style={swatchColor ? { color: swatchColor } : undefined}
        >
          {personalization.icon}
        </span>
      ) : (
        <span
          className="flex text-text-secondary"
          style={swatchColor ? { color: swatchColor } : undefined}
        >
          <NodeGlyph profile={effProfile} frameType={node.frameType} size={14} />
        </span>
      )}
      <span
        aria-hidden="true"
        data-status={status}
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-bg-secondary",
          STATUS_DOT[status],
        )}
      />
    </div>
  );
}
