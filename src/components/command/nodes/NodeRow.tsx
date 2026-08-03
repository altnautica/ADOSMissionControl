"use client";

/**
 * @module nodes/NodeRow
 * @description One profile-aware expanded sidebar row (~48-52px) rendering any
 * node — drone, flight-controller, ground-station, or workstation — from the
 * same merged node view-model. Type is the glyph (on a profile-tint tile);
 * health is an independent ring around that tile; the two are never conflated.
 * A workstation row cannot render a flight badge by construction. Rendered by
 * the dashboard fleet sidebar (DroneListPanel) for every node profile, and by
 * the collapsed rail (NodeRail).
 * @license GPL-3.0-only
 */

import { RefObject } from "react";
import { MoreHorizontal, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import {
  type EffProfile,
  NODE_ACCENT_VAR,
  swatchVar,
  tintStyle,
} from "@/lib/nodes/node-profile";
import { NodeGlyph } from "./node-glyph";
import { NodeAgentBadge } from "./NodeAgentBadge";
import { NodeStatusHoverCard } from "./NodeStatusHoverCard";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { Badge } from "@/components/ui/badge";
import { droneLiveness } from "../fleet/types";
import { NodeBadgeSet } from "./NodeBadgeSet";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { resolveFeatureDot } from "@/lib/nodes/node-feature-dots";
import { useNodeControlAuthorityNotice } from "@/hooks/use-node-control-authority";
import { useTranslations } from "next-intl";

/** Map a merged fleet entry to the presentation profile discriminator. A paired
 * node in the sidebar always carries an agent, so a `drone`-profile entry is a
 * `drone` here; the bare-`flight-controller` case is a node-detail concern. */
export function effProfileForNode(node: FleetNodeEntry): EffProfile {
  if (node.profile === "ground-station") return "ground-station";
  if (node.profile === "workstation") return "workstation";
  return "drone";
}

/** Health only, from the verified lastSeen freshness signal (Rule 44 — never a
 * fabricated reading). `stale` maps to the 4th `serious` step so a degraded but
 * not-dead node is distinguishable from both healthy and offline. */
export function nodeStatusLevel(node: FleetNodeEntry): StatusLevel {
  const live = droneLiveness(node);
  return live === "live" ? "good" : live === "stale" ? "serious" : "offline";
}

/** The nodeConsole `type.*` translation key for a profile. */
export function profileTypeKey(
  p: EffProfile,
): "drone" | "flightController" | "groundStation" | "workstation" {
  return p === "flight-controller"
    ? "flightController"
    : p === "ground-station"
      ? "groundStation"
      : p; // "drone" | "workstation"
}

/**
 * The type-tile border carries health (the "ring"); the glyph carries type.
 * Exported as the ONE ring vocabulary: every surface that rings a node tile
 * (sidebar row, collapsed rail, board identity cell) reads this map, so a
 * changed token cannot leave one surface ringing an old colour for the same
 * health state — `Record<StatusLevel, string>` only catches a missing member,
 * never a diverged value.
 */
export const STATUS_BORDER: Record<StatusLevel, string> = {
  // Healthy/live reads NEUTRAL (colour is reserved for attention states) so a
  // fleet of live nodes isn't a wall of green rings; the tile-colour channel
  // (personalization wash + selected pill) is separate.
  good: "border-border-default",
  warning: "border-status-warning",
  serious: "border-status-serious",
  critical: "border-status-error",
  idle: "border-accent-primary",
  offline: "border-text-tertiary/40",
};

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
 * "Offline" line when the freshness signal says the node is unreachable (Rule 44
 * — no stale sub-metrics). `typeLabel` is the resolved `type.*` string.
 */
export function nodeSubtitle(
  node: FleetNodeEntry,
  effProfile: EffProfile,
  typeLabel: string,
  labels: NodeSubtitleLabels,
): string {
  if (droneLiveness(node) === "offline") return labels.offline;
  const parts: string[] = [];
  if (
    effProfile === "ground-station" &&
    node.role &&
    node.role !== "direct"
  ) {
    parts.push(node.role === "relay" ? labels.relay : labels.receiver);
  } else {
    parts.push(typeLabel);
  }
  if (node.board) parts.push(node.board);
  return parts.join(" · ");
}

interface NodeRowProps {
  node: FleetNodeEntry;
  selected: boolean;
  renaming: boolean;
  renameValue: string;
  renameInputRef: RefObject<HTMLInputElement | null>;
  onSelect: (node: FleetNodeEntry) => void;
  onContext: (nodeId: string, x: number, y: number) => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (nodeId: string) => void;
  onRenameCancel: () => void;
}

export function NodeRow({
  node,
  selected,
  renaming,
  renameValue,
  renameInputRef,
  onSelect,
  onContext,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: NodeRowProps) {
  const t = useTranslations("nodeConsole");
  const effProfile = effProfileForNode(node);
  const status = nodeStatusLevel(node);
  const typeLabel = t(`type.${profileTypeKey(effProfile)}`);

  // Personalization overlay (pure presentation) keyed by the stable deviceId.
  // Selecting only this node's slice keeps another node's edit from re-rendering
  // this row.
  const personalization = useNodePersonalizationStore(
    (s) => s.byNode[node.deviceId],
  );
  const displayName = personalization?.label?.trim() || node.name;
  // The tile wash + accent take the operator's swatch when set, else the profile
  // accent. Only the wash is used on the tile — the border stays the health
  // ring, so an error still reads red on any tile colour (Rule 44).
  const tileCssVar = personalization?.color
    ? swatchVar(personalization.color)
    : NODE_ACCENT_VAR[effProfile];
  const { backgroundColor } = tintStyle(tileCssVar, { bg: 14 });
  const accentColor = `var(${tileCssVar})`;
  const featureDots = personalization?.dots ?? [];

  // Command authority is its own badge, NEVER folded into `status` above: the
  // ring is health-only by contract and shared with two other surfaces, and a
  // live node this browser cannot publish FC frames to is healthy and
  // uncommandable at the same time. Grading the row on liveness alone is what
  // left that state invisible.
  const authority = useNodeControlAuthorityNotice(node._id);

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
        onContext(node._id, e.clientX, e.clientY);
      }}
      className={cn(
        "group relative flex min-h-[48px] cursor-pointer items-center gap-2 rounded pl-3 pr-1 py-1.5 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        selected
          ? "bg-accent-primary/20 ring-1 ring-inset ring-accent-primary/40"
          : "hover:bg-bg-tertiary",
      )}
    >
      {/* Selection is shown by the row's highlighted background alone (no left
          accent pill), so it never competes with the health ring. */}

      {/* Type tile (glyph or operator initials) + health ring (border). */}
      <div className="relative shrink-0">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded border-2",
            STATUS_BORDER[status],
            status === "serious" && "animate-pulse",
          )}
          style={{ backgroundColor }}
          title={t(`type.${profileTypeKey(effProfile)}`)}
        >
          {personalization?.icon ? (
            <span
              className="text-[11px] font-semibold leading-none"
              style={{ color: accentColor }}
            >
              {personalization.icon}
            </span>
          ) : (
            <NodeGlyph profile={effProfile} frameType={node.frameType} size={15} />
          )}
        </div>
        {node.isLocal && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-bg-secondary text-accent-primary"
            title={t("badge.lan")}
          >
            <Wifi size={8} />
          </span>
        )}
      </div>

      {/* Two-line body: the name owns its own full-width line (line 1) so the
          flavor / status badges below (line 2) can never truncate it. */}
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={() => onRenameSubmit(node._id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit(node._id);
              if (e.key === "Escape") onRenameCancel();
            }}
            className="w-full rounded border border-accent-primary bg-bg-primary px-1 py-0.5 text-xs text-text-primary outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            {/* Line 1: name + overflow action */}
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
                {displayName}
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  onContext(node._id, rect.right, rect.bottom);
                }}
                title={t("actions.menu")}
                aria-label={t("actions.nodeActions")}
                className="shrink-0 p-0.5 text-text-tertiary opacity-60 transition-all hover:text-text-primary group-hover:opacity-100"
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
            {/* Line 2: firmware·airframe / role / tier badges + opt-in signal
                dots, wrapping so they never steal width from the name. */}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {featureDots.length > 0 && (
                <div className="flex items-center gap-0.5" aria-label="Node signals" /* i18n */>
                  {featureDots.slice(0, 4).map((dot) => {
                    const resolved = resolveFeatureDot(dot.signal, node);
                    return (
                      <StatusDot
                        key={dot.signal}
                        status={resolved.level}
                        shape={resolved.known ? "dot" : "ring"}
                        size="xs"
                        label={resolved.tooltip}
                      />
                    );
                  })}
                </div>
              )}
              {personalization?.badge && (
                <Badge variant="neutral" className="rounded normal-case tracking-normal">
                  {personalization.badge}
                </Badge>
              )}
              {authority.show && (
                <Badge
                  variant={authority.level === "warning" ? "warning" : "neutral"}
                  className="gap-1 rounded normal-case tracking-normal"
                >
                  {/* The dot carries the full sentence as its aria-label and
                      title, so the reason survives the short badge text. */}
                  <StatusDot
                    status={authority.level}
                    size="xs"
                    label={authority.detail}
                  />
                  {authority.label}
                </Badge>
              )}
              <NodeBadgeSet node={node} effProfile={effProfile} max={3} />
              {effProfile === "drone" && node.board && <NodeAgentBadge />}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // The whole row is the hover trigger for the profile-aware status card. While
  // renaming, the inline input owns the row, so render it bare (no hover card).
  return renaming ? (
    row
  ) : (
    <Tooltip
      triggerClassName="relative block w-full"
      position="right"
      multiline
      content={<NodeStatusHoverCard node={node} />}
    >
      {row}
    </Tooltip>
  );
}
