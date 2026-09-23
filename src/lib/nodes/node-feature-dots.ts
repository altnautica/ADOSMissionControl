/**
 * @module nodes/node-feature-dots
 * @description The customizable per-feature dot model an operator opts a node
 * into: a small ordered set of pinned signal indicators shown on the sidebar
 * row and the mini rail.
 *
 * Only signals the sidebar view-model can verify are offered: the node's own
 * link (heartbeat age) and, on flight nodes, the flight-controller link. A
 * signal with no verified reading resolves to `known: false` and renders a
 * HOLLOW ring; it never borrows a last value or defaults to a fresh green.
 * Level -> colour comes from the reserved status tokens; identity comes from
 * the glyph + position + tooltip, so the set is colour-blind-safe and a screen
 * reader announces "link: healthy". Human text lives in the locale files: a
 * resolved dot carries translation keys (`labelKey`, `stateKey`) under the
 * `nodeConsole` namespace and the rendering component resolves them, so this
 * pure module never pulls in a translator.
 *
 * @license GPL-3.0-only
 */

import type { StatusLevel } from "@/components/ui/status-dot";
import type { EffProfile, NodeSwatch } from "@/lib/nodes/node-profile";
import { livenessFromTimestamp } from "@/lib/nodes/presence";

/** Every signal a node dot can represent. */
export type SignalKey =
  /** The node's own heartbeat link. */
  | "link"
  /** The node's flight-controller link (flight nodes only). */
  | "fc";

export const SIGNAL_KEYS: readonly SignalKey[] = ["link", "fc"];

/** Narrow an untrusted (persisted) value to a known signal, or null. */
export function asSignalKey(value: unknown): SignalKey | null {
  return SIGNAL_KEYS.find((k) => k === value) ?? null;
}

/**
 * A stored, opt-in feature dot. `signal` is the reading to show; `color` is an
 * optional operator tint — identity still rides the glyph + tooltip, never the
 * colour alone, so a tinted dot stays legible and CVD-safe.
 */
export interface FeatureDot {
  signal: SignalKey;
  color?: NodeSwatch;
}

/** The resolved, render-ready dot. `known: false` -> a hollow ring (no fabricated reading). */
export interface ResolvedDot {
  signal: SignalKey;
  /** Colour band from the reserved status tokens (placeholder when unknown). */
  level: StatusLevel;
  /** Whether the reading is verified. False renders a hollow "no reading" ring. */
  known: boolean;
  /** Identity glyph (used in labels / tooltips, never colour alone). */
  glyph: string;
  /**
   * Translation key for the signal's short name, relative to the
   * `nodeConsole` namespace (e.g. `signals.link`). This module is not a
   * component, so it carries keys and the caller resolves them with
   * `useTranslations("nodeConsole")`.
   */
  labelKey: string;
  /**
   * Translation key for the reading's state word, relative to `nodeConsole`
   * (e.g. `signalState.good`). Compose the tooltip with
   * `t("signalTooltip", { signal: t(labelKey), state: t(stateKey) })`.
   */
  stateKey: string;
}

interface SignalMeta {
  glyph: string;
}

/**
 * Per-signal identity metadata. The human label is NOT stored here: it is
 * `nodeConsole.signals.<signal>` in the locale files, resolved by the rendering
 * component, so a pure module never imports a translator.
 */
export const SIGNAL_META: Record<SignalKey, SignalMeta> = {
  link: { glyph: "L" },
  fc: { glyph: "FC" },
};

/** The translation key for a signal's short name, under `nodeConsole`. */
export function signalLabelKey(signal: SignalKey): string {
  return `signals.${signal}`;
}

/** The verified fields the sidebar node view-model actually carries. */
export interface NodeSignalData {
  /** Epoch ms of the last verified heartbeat; drives the link liveness. */
  lastSeen?: number;
  /** Whether the agent reports its FC link up (MAVLink). */
  fcConnected?: boolean;
  /** Whether the agent reports the FC transport open (the MSP FC signal). */
  transportOpen?: boolean;
}

/**
 * The translation key for a status band's state word, under `nodeConsole`.
 * `unknown` is the honest "no reading" state, not a band.
 */
function stateKeyFor(level: StatusLevel): string {
  return `signalState.${level}`;
}

/**
 * Resolve one signal against a node's verified data into a render-ready dot.
 * The FC link is only as current as the node's own heartbeat: when that is not
 * live, the last FC verdict is not a reading and the dot is hollow.
 */
export function resolveFeatureDot(
  signal: SignalKey,
  node: NodeSignalData,
): ResolvedDot {
  const base = {
    signal,
    glyph: SIGNAL_META[signal].glyph,
    labelKey: signalLabelKey(signal),
  };
  const live = livenessFromTimestamp(node.lastSeen ?? null);

  if (signal === "link") {
    const level: StatusLevel =
      live === "live" ? "good" : live === "stale" ? "serious" : "offline";
    return { ...base, level, known: true, stateKey: stateKeyFor(level) };
  }

  const fcUp = node.fcConnected === true || node.transportOpen === true;
  const fcReported = fcUp || node.fcConnected === false;
  if (live !== "live" || !fcReported) {
    return { ...base, level: "offline", known: false, stateKey: "signalState.unknown" };
  }
  const level: StatusLevel = fcUp ? "good" : "offline";
  return { ...base, level, known: true, stateKey: stateKeyFor(level) };
}

/**
 * Sensible starter dots per profile — OFF until the operator opts in (the
 * "Configure dots" editor pre-fills these). Rendering keys off the stored
 * `dots`, so a node with no overlay shows no dots.
 */
export const DEFAULT_DOTS: Record<EffProfile, SignalKey[]> = {
  drone: ["link", "fc"],
  "flight-controller": ["link", "fc"],
  "ground-station": ["link"],
  workstation: ["link"],
};

/**
 * The signals a profile MAY pin. Gating by profile makes an impossible dot
 * unrepresentable (a workstation cannot pin the FC link), mirroring the
 * `NodeBadgeSet` construction.
 */
export const SIGNAL_ALLOWLIST: Record<EffProfile, SignalKey[]> = {
  drone: ["link", "fc"],
  "flight-controller": ["link", "fc"],
  "ground-station": ["link"],
  workstation: ["link"],
};

/** The allowlist of pinnable signals for a profile. */
export function allowedSignals(profile: EffProfile): SignalKey[] {
  return SIGNAL_ALLOWLIST[profile];
}

/** The default starter dots for a profile as stored `FeatureDot`s. */
export function defaultDots(profile: EffProfile): FeatureDot[] {
  return DEFAULT_DOTS[profile].map((signal) => ({ signal }));
}
