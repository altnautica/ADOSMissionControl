import type { CSSProperties } from "react";

/**
 * The effective, view-model node profile used to shape every context-aware
 * surface (hero, overview, sidebar row, fleet card). It is derived from the
 * real `drone.profile` plus liveness — a flight-controller is a `drone` node
 * with no paired agent, surfaced here as its own kind rather than a degraded
 * drone. The tab registry still keys on the real `drone.profile`; this is a
 * presentation discriminator only.
 */
export type EffProfile =
  | "drone"
  | "flight-controller"
  | "ground-station"
  | "workstation";

/** A ground station's role as every node surface labels it. */
export type GroundRoleKey = "direct" | "relay" | "receiver" | "unknown";

/**
 * The role a ground station has actually reported. An unset or not-yet-
 * reported role, or a value this build does not know, reads as unknown —
 * never as "direct". Every surface that labels the role (sidebar badge, row
 * subtitle, hover card) resolves it here so they cannot disagree.
 */
export function groundRoleKey(role: string | null | undefined): GroundRoleKey {
  return role === "direct" || role === "relay" || role === "receiver"
    ? role
    : "unknown";
}

/** The CSS custom property holding each profile's identity accent hue. */
export const NODE_ACCENT_VAR: Record<EffProfile, string> = {
  drone: "--node-accent-drone",
  "flight-controller": "--node-accent-fc",
  "ground-station": "--node-accent-gs",
  workstation: "--node-accent-work",
};

/** The curated, theme-safe personalization swatches (their CSS var suffixes). */
export const NODE_SWATCHES = [
  "slate",
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "purple",
] as const;

export type NodeSwatch = (typeof NODE_SWATCHES)[number];

/** The CSS var for a personalization swatch. */
export function swatchVar(swatch: NodeSwatch): string {
  return `--node-swatch-${swatch}`;
}

/**
 * Build an inline tint from an identity hue CSS var, blended into the live
 * theme surface so it keeps contrast across every theme (no per-theme table).
 * `bg` tints the tile wash; `border` tints the accent rule. Values are
 * percentages of the hue mixed over the surface.
 */
export function tintStyle(
  cssVar: string,
  opts?: { bg?: number; border?: number; surface?: string },
): CSSProperties {
  const bg = opts?.bg ?? 12;
  const border = opts?.border ?? 40;
  const surface = opts?.surface ?? "var(--alt-bg-secondary)";
  return {
    backgroundColor: `color-mix(in oklab, var(${cssVar}) ${bg}%, ${surface})`,
    borderColor: `color-mix(in oklab, var(${cssVar}) ${border}%, transparent)`,
  };
}

/** The tint for a profile's identity accent. */
export function profileTint(
  profile: EffProfile,
  opts?: { bg?: number; border?: number; surface?: string },
): CSSProperties {
  return tintStyle(NODE_ACCENT_VAR[profile], opts);
}
