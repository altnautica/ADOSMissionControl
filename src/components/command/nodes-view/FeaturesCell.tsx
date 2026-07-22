"use client";

/**
 * @module command/nodes-view/FeaturesCell
 * @description Which first-party features a node runs, and the toggles that
 * turn them on and off.
 *
 * The set of features a node can run comes from the feature registry keyed by
 * its profile, so a profile with no opt-in features says so rather than showing
 * an empty control. Each feature ships its own toggle Row, already written to
 * take a node id and already honest about a node it cannot reach, so the cell
 * mounts those rather than re-implementing the write — the board and the node's
 * own settings tab drive the same control.
 *
 * The toggles live behind a popover rather than inline: they are per-feature
 * switches with their own live status text, which is more than a dense row can
 * carry without pushing every other column off screen.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { featuresForProfile } from "@/components/features/registry";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useAnchoredPosition } from "@/components/ui/use-anchored-position";
import { Chip, NEUTRAL_CHIP, UnknownValue } from "./cell-primitives";

const ON_CHIP =
  "border-accent-primary/40 bg-accent-primary/10 text-accent-primary";

/** Matches the popover's `w-64`, so the viewport clamp knows its footprint. */
const POPOVER_WIDTH = 256;

export function FeaturesCell({ node }: { node: FleetNodeEntry }) {
  const t = useTranslations("nodesView");
  const features = featuresForProfile(node.profile);
  // Narrowed to this node's slice so one node's toggle does not re-render the
  // whole board.
  const enabled = useNodeFeaturesStore((s) => s.enabled[node.deviceId]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Portaled with a fixed viewport slot so the board's scrollable table wrapper
  // cannot clip the toggles — the same machinery the Select popup uses.
  const { style, compute } = useAnchoredPosition(ref, open, {
    estimatedWidth: POPOVER_WIDTH,
    maxHeight: 360,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || popRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (features.length === 0) {
    return <UnknownValue title={t("features.none")} />;
  }

  const on = new Set(enabled ?? []);
  // The feature rows key on the canonical node id, not the bare device id.
  const nodeId = nodeIdForDevice(node.deviceId);

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={t("features.change", { name: node.name })}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          compute();
          setOpen(true);
        }}
        className="flex items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-border-default hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
      >
        {features.map((feature) => (
          <Chip
            key={feature.id}
            className={on.has(feature.id) ? ON_CHIP : NEUTRAL_CHIP}
            title={feature.description}
          >
            <feature.icon size={10} />
            {feature.label}
          </Chip>
        ))}
        <ChevronDown size={11} className="text-text-tertiary" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            style={style}
            className="w-64 overflow-y-auto rounded border border-border-default bg-bg-secondary p-3 shadow-lg"
          >
            <p className="mb-2 text-[10px] uppercase tracking-wide text-text-tertiary">
              {t("features.heading")}
            </p>
            <div className="space-y-3">
              {features.map((feature) => (
                <div key={feature.id}>
                  <p className="text-xs font-medium text-text-primary">
                    {feature.label}
                  </p>
                  <p className="mb-1.5 text-[10px] leading-snug text-text-tertiary">
                    {feature.description}
                  </p>
                  <feature.Row droneId={nodeId} />
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
