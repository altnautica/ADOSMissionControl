"use client";

/**
 * @module command/nodes-view/FeaturesCell
 * @description Which first-party features a node has been opted into.
 *
 * The set of features a node can run comes from the feature registry keyed by
 * its profile, so a profile with no opt-in features says so rather than showing
 * an empty control. The on/off state is the operator's per-node intent; whether
 * the native service is actually up is the node's own readiness and is surfaced
 * by the feature's own control, never inferred here.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { featuresForProfile } from "@/components/features/registry";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { Chip, NEUTRAL_CHIP, UnknownValue } from "./cell-primitives";

const ON_CHIP =
  "border-accent-primary/40 bg-accent-primary/10 text-accent-primary";

export function FeaturesCell({ node }: { node: FleetNodeEntry }) {
  const t = useTranslations("nodesView");
  const features = featuresForProfile(node.profile);
  // Narrowed to this node's slice so one node's toggle does not re-render the
  // whole board.
  const enabled = useNodeFeaturesStore((s) => s.enabled[node.deviceId]);

  if (features.length === 0) {
    return <UnknownValue title={t("features.none")} />;
  }

  const on = new Set(enabled ?? []);

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
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
    </span>
  );
}
