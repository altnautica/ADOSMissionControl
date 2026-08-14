"use client";

/**
 * @module nodes/NodeRail
 * @description The collapsed mini sidebar tile (~40px) for any node profile.
 * Three orthogonal channels that never collide: the type glyph (on a profile
 * wash), a health status ring, and an optional bottom-right count pill for
 * unacked attention (alerts / queued jobs / failed services). A selected tile
 * shows a left accent pill (never a status colour). Companion to NodeRow.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import {
  NODE_ACCENT_VAR,
  swatchVar,
  tintStyle,
} from "@/lib/nodes/node-profile";
import { NodeGlyph } from "./node-glyph";
import { StatusDot } from "@/components/ui/status-dot";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { resolveFeatureDot } from "@/lib/nodes/node-feature-dots";
import { STATUS_BORDER, effProfileForNode, nodeStatusLevel } from "./NodeRow";

/** The count-pill background token per severity. */
const PILL_BG: Record<"warning" | "serious" | "critical", string> = {
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-error",
};

interface NodeRailProps {
  node: FleetNodeEntry;
  selected: boolean;
  /** Verified unacked-attention count (Rule 44 — omit when unverifiable; the
   * ring alone carries an offline/stale node's state, never a stale `0`). */
  count?: number;
  /** Severity that drives the count-pill colour when `count > 0`. */
  countLevel?: "warning" | "serious" | "critical";
  /** The full status line for the tooltip. */
  title?: string;
  onSelect: (node: FleetNodeEntry) => void;
  onContext?: (nodeId: string, x: number, y: number) => void;
}

export function NodeRail({
  node,
  selected,
  count,
  countLevel = "warning",
  title,
  onSelect,
  onContext,
}: NodeRailProps) {
  const t = useTranslations("nodeConsole");
  const effProfile = effProfileForNode(node);
  const status = nodeStatusLevel(node);
  // Personalization overlay (pure presentation) keyed by the stable deviceId.
  const personalization = useNodePersonalizationStore(
    (s) => s.byNode[node.deviceId],
  );
  const tileCssVar = personalization?.color
    ? swatchVar(personalization.color)
    : NODE_ACCENT_VAR[effProfile];
  const { backgroundColor } = tintStyle(tileCssVar, { bg: 16 });
  const accentColor = `var(${tileCssVar})`;
  const effectiveTitle = personalization?.label?.trim() || title || node.name;
  const railDots = (personalization?.dots ?? []).slice(0, 3);
  // Suppress the pill when the node is offline/stale — its inputs are
  // unverifiable, so the ring alone carries that state (Rule 44).
  const showPill =
    status === "good" && typeof count === "number" && count > 0;
  const pillText = count != null && count > 9 ? "9+" : String(count ?? "");

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(node)}
      onContextMenu={(e) => {
        if (!onContext) return;
        e.preventDefault();
        onContext(node._id, e.clientX, e.clientY);
      }}
      title={effectiveTitle}
      aria-label={effectiveTitle}
      className={cn(
        "relative flex h-10 w-10 items-center justify-center rounded transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        selected
          ? "bg-accent-primary/20 ring-1 ring-inset ring-accent-primary/40"
          : "hover:bg-bg-tertiary",
      )}
    >
      {/* Selection is shown by the tile's highlighted background alone (no left
          accent pill). */}
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded border-2",
          STATUS_BORDER[status],
          status === "serious" && "animate-pulse",
        )}
        style={{ backgroundColor }}
      >
        {personalization?.icon ? (
          <span
            className="text-[10px] font-semibold leading-none"
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
          aria-hidden
          className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-accent-primary"
        />
      )}

      {/* Opt-in feature dots (<=3) along the free bottom-left edge; each carries
          its signal + level in the tooltip, hollow when unverified (Rule 44). */}
      {railDots.length > 0 && (
        <span className="absolute bottom-0.5 left-0.5 flex items-center gap-0.5">
          {railDots.map((dot) => {
            const resolved = resolveFeatureDot(dot.signal, node);
            return (
              <StatusDot
                key={dot.signal}
                status={resolved.level}
                shape={resolved.known ? "dot" : "ring"}
                size="xs"
                label={t("signalTooltip", {
                  signal: t(resolved.labelKey),
                  state: t(resolved.stateKey),
                })}
              />
            );
          })}
        </span>
      )}

      {showPill && (
        <span
          aria-label={t("actions.unacknowledged", { count: pillText })}
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-bg-secondary px-0.5 text-[8px] font-bold leading-none text-bg-primary",
            PILL_BG[countLevel],
          )}
        >
          {pillText}
        </span>
      )}
    </button>
  );
}
