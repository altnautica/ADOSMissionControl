"use client";

/**
 * @module nodes/NodeRail
 * @description The collapsed mini sidebar tile (~40px) for any node profile.
 * Channels that never collide: the type glyph on the shared node tile, its
 * liveness dot, and the operator's opt-in feature dots. A selected tile shows a
 * highlighted background (never a status colour). Companion to NodeRow.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { StatusDot } from "@/components/ui/status-dot";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { resolveFeatureDot } from "@/lib/nodes/node-feature-dots";
import { NodeTile } from "./NodeTile";

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
  // Personalization overlay (pure presentation) keyed by the stable deviceId.
  const personalization = useNodePersonalizationStore(
    (s) => s.byNode[node.deviceId],
  );
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
        // A right-click does not move focus; focus the tile first so the menu,
        // which records the focused element as its opener, returns here on close.
        (e.currentTarget as HTMLElement).focus();
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
      <NodeTile node={node} />

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
