/**
 * @module features/registry
 * @description The first-party FEATURE registry. A first-party feature is a
 * native, powerful, NON-mandatory capability the operator opts into per node
 * (unlike a sandboxed extension, and unlike flight-critical infrastructure that
 * is always on). The World Model (Atlas) is the first. Each feature declares the
 * node profiles it is togglable on, the node-detail surfaces it reveals when
 * enabled, and the toggle Row its hosts mount (the fleet board's Features
 * cell; the World Model row also anchors the node Settings world-model page).
 *
 * The compute / workstation profile treats these features as DEFAULT built-ins
 * (Atlas is its purpose), so it is not listed here — only profiles where the
 * feature is an opt-in appear in `profiles`.
 *
 * @license GPL-3.0-only
 */

import type { FC } from "react";
import { Boxes, type LucideIcon } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { WorldModelFeatureRow } from "./WorldModelFeatureRow";

export interface FeatureRowProps {
  /** The selected node id (`node:<deviceId>`). */
  droneId: string;
}

export interface FirstPartyFeature {
  /** Stable id, matches the surface `when` check (`ctx.isFeatureEnabled(id)`). */
  id: string;
  /** Short label. i18n TODO — hardcoded English per the Status-tab convention. */
  label: string;
  /** One-line description. i18n TODO. */
  description: string;
  icon: LucideIcon;
  /** Profiles where this feature is an operator-togglable opt-in. */
  profiles: NodeProfile[];
  /** Node-detail surface ids this feature reveals when enabled (reference). */
  surfaceIds: string[];
  /** The toggle row the feature's host surfaces mount. */
  Row: FC<FeatureRowProps>;
}

export const FIRST_PARTY_FEATURES: FirstPartyFeature[] = [
  {
    id: "world-model",
    label: "World Model",
    description:
      "Capture pose-tagged keyframes as this drone flies; a paired compute node reconstructs a 3D world model.",
    icon: Boxes,
    profiles: ["drone"],
    surfaceIds: ["world-model", "live-world"],
    Row: WorldModelFeatureRow,
  },
];

/** First-party features that are an operator opt-in on `profile`. */
export function featuresForProfile(profile: NodeProfile): FirstPartyFeature[] {
  return FIRST_PARTY_FEATURES.filter((f) => f.profiles.includes(profile));
}
