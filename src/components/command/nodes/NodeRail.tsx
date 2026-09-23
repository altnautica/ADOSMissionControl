"use client";

/**
 * @module nodes/NodeRail
 * @description The collapsed mini sidebar tile (~40px) for any node profile.
 * Channels that never collide: the type glyph (on a profile wash), a health
 * status ring, and the operator's opt-in feature dots. A selected tile shows a
 * highlighted background (never a status colour). Companion to NodeRow.
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

interface NodeRailProps {
  node: FleetNodeEntry;
  selected: boolean;
  /** The full status line for the tooltip. */
  title?: string;
  onSelect: (node: FleetNodeEntry) => void;
  onContext?: (nodeId: string, x: number, y: number) => void;
}

export function NodeRail({
  node,
  selected,
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
          its signal + level in the tooltip, hollow when unverified (no fabricated reading). */}
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
    </button>
  );
}
