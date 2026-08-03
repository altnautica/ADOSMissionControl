"use client";

/**
 * @module command/nodes-view/NodeIdentityCell
 * @description The identity cell of a board row: the profile tile (glyph or
 * operator initials, ringed by health), the node name as the row's open
 * control, and the profile-correct subtitle.
 *
 * The sidebar row is not reusable here — it is an option in a listbox with a
 * two-line body and a right-anchored hover card, which fights a table row. Its
 * pure helpers are, so profile, health, and subtitle stay derived in exactly one
 * place across both surfaces. The name is a real button so every row is
 * keyboard-reachable without making the whole row a click target, which on a
 * board full of live controls would put an accidental navigation one stray
 * click away from every dropdown.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { CornerDownRight, Wifi } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { NODE_ACCENT_VAR, swatchVar, tintStyle } from "@/lib/nodes/node-profile";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { NodeGlyph } from "@/components/command/nodes/node-glyph";
import { NodeBadgeSet } from "@/components/command/nodes/NodeBadgeSet";
import {
  STATUS_BORDER,
  effProfileForNode,
  nodeStatusLevel,
  nodeSubtitle,
  nodeSubtitleLabels,
  profileTypeKey,
} from "@/components/command/nodes/NodeRow";

export function NodeIdentityCell({
  node,
  depth = 0,
  onOpen,
}: {
  node: FleetNodeEntry;
  /** Reach-hierarchy nesting depth: a nested relay drone indents under its
   * ground node with a connector so the grouping reads at a glance. */
  depth?: number;
  onOpen: (node: FleetNodeEntry) => void;
}) {
  const t = useTranslations("nodeConsole");
  const effProfile = effProfileForNode(node);
  const status = nodeStatusLevel(node);
  const typeLabel = t(`type.${profileTypeKey(effProfile)}`);

  // One node's personalization edit must not re-render every other row, so the
  // selector narrows to this node's slice.
  const personalization = useNodePersonalizationStore(
    (s) => s.byNode[node.deviceId],
  );
  const displayName = personalization?.label?.trim() || node.name;
  const tileCssVar = personalization?.color
    ? swatchVar(personalization.color)
    : NODE_ACCENT_VAR[effProfile];
  const { backgroundColor } = tintStyle(tileCssVar, { bg: 14 });

  return (
    <div className="flex min-w-0 items-center gap-2">
      {depth > 0 && (
        // Indent + connector so a relayed drone reads as nested under its ground
        // node. Presentational only — the grouping itself lives in the row order.
        <span
          className="flex shrink-0 items-center text-text-tertiary"
          style={{ paddingLeft: `${(depth - 1) * 16}px` }}
          aria-hidden="true"
        >
          <CornerDownRight size={13} />
        </span>
      )}
      <div className="relative shrink-0">
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded border-2",
            STATUS_BORDER[status],
          )}
          style={{ backgroundColor }}
          title={typeLabel}
        >
          {personalization?.icon ? (
            <span
              className="text-[10px] font-semibold leading-none"
              style={{ color: `var(${tileCssVar})` }}
            >
              {personalization.icon}
            </span>
          ) : (
            <NodeGlyph
              profile={effProfile}
              frameType={node.frameType}
              size={14}
            />
          )}
        </div>
        {node.isLocal && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-bg-secondary text-accent-primary"
            title="LAN"
          >
            <Wifi size={7} />
          </span>
        )}
      </div>

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpen(node)}
          className="block max-w-full truncate rounded text-left text-xs font-medium text-text-primary hover:text-accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          {displayName}
        </button>
        <div className="mt-0.5 flex items-center gap-1">
          <span className="truncate text-[10px] text-text-tertiary">
            {nodeSubtitle(node, effProfile, typeLabel, nodeSubtitleLabels(t))}
          </span>
          <NodeBadgeSet node={node} effProfile={effProfile} max={1} />
        </div>
      </div>
    </div>
  );
}
