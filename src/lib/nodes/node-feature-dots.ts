/**
 * @module nodes/node-feature-dots
 * @description The customizable per-feature dot model an operator opts a node
 * into: a small ordered set of pinned signal indicators (link / battery / GPU /
 * jobs / ...) shown on the sidebar row (<=4) and the mini rail (<=3).
 *
 * The model is honest by construction (Rule 44). `resolveFeatureDot` reads only
 * the verified fields the sidebar view-model actually carries; a signal with no
 * verified reading (sensor absent, capability off, live telemetry not wired into
 * the sidebar entry) resolves to `known: false` and renders a HOLLOW ring — it
 * never borrows a last value or defaults to a fresh green. Level -> colour comes
 * from the reserved status tokens; identity comes from the glyph + position +
 * tooltip, so the set is colour-blind-safe and a screen reader announces
 * "link: healthy". Human text lives in the locale files: a resolved dot carries
 * translation keys (`labelKey`, `stateKey`) under the `nodeConsole` namespace
 * and the rendering component resolves them, so this pure module never pulls in
 * a translator.
 *
 * @license GPL-3.0-only
 */

import type { StatusLevel } from "@/components/ui/status-dot";
import type { EffProfile, NodeSwatch } from "@/lib/nodes/node-profile";
import {
  STALE_THRESHOLD_MS,
  OFFLINE_THRESHOLD_MS,
} from "@/lib/agent/freshness";

/** Every signal a node dot can represent, grouped by the profile it serves. */
export type SignalKey =
  // drone / flight-controller
  | "link"
  | "battery"
  | "gps"
  | "arm"
  | "prearm"
  | "rc"
  // ground-station
  | "rx"
  | "uplink"
  | "mesh"
  | "mqtt"
  // workstation
  | "gpu"
  | "jobs"
  | "cluster"
  | "thermal"
  // shared
  | "cpu"
  | "temp"
  | "services"
  | "alerts";

/**
 * A stored, opt-in feature dot. `signal` is the reading to show; `color` is an
 * optional operator tint — identity still rides the glyph + tooltip, never the
 * colour alone, so a tinted dot stays legible and CVD-safe.
 */
export interface FeatureDot {
  signal: SignalKey;
  color?: NodeSwatch;
}

/** The resolved, render-ready dot. `known: false` -> a hollow ring (Rule 44). */
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
  battery: { glyph: "B" },
  gps: { glyph: "G" },
  arm: { glyph: "A" },
  prearm: { glyph: "P" },
  rc: { glyph: "R" },
  rx: { glyph: "Rx" },
  uplink: { glyph: "U" },
  mesh: { glyph: "M" },
  mqtt: { glyph: "Q" },
  gpu: { glyph: "GP" },
  jobs: { glyph: "J" },
  cluster: { glyph: "C" },
  thermal: { glyph: "Th" },
  cpu: { glyph: "Cp" },
  temp: { glyph: "T" },
  services: { glyph: "Sv" },
  alerts: { glyph: "!" },
};

/** The translation key for a signal's short name, under `nodeConsole`. */
export function signalLabelKey(signal: SignalKey): string {
  return `signals.${signal}`;
}

/** The verified fields the sidebar node view-model actually carries. */
export interface NodeSignalData {
  /** Epoch ms of the last verified heartbeat; drives the link liveness. */
  lastSeen?: number;
  /** Whether an FC link is verified up. */
  fcConnected?: boolean;
  /** Ground-station role when applicable. */
  role?: "direct" | "relay" | "receiver" | null;
}

type Liveness = "live" | "stale" | "offline";

function liveness(lastSeen?: number): Liveness {
  if (!lastSeen) return "offline";
  const elapsed = Date.now() - lastSeen;
  if (elapsed < STALE_THRESHOLD_MS) return "live";
  if (elapsed < OFFLINE_THRESHOLD_MS) return "stale";
  return "offline";
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
 * Only signals the sidebar view-model can VERIFY resolve to a real reading;
 * everything else is an honest hollow "no reading" ring (Rule 44). Live
 * per-node telemetry (battery / GPS / GPU / jobs) is intentionally not
 * fabricated here — it becomes a real reading once wired to the selected node's
 * stores in a later pass.
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

  if (signal === "link") {
    const live = liveness(node.lastSeen);
    const level: StatusLevel =
      live === "live" ? "good" : live === "stale" ? "serious" : "offline";
    return {
      ...base,
      level,
      known: true,
      stateKey: stateKeyFor(level),
    };
  }

  // No verified reading in the sidebar view-model -> hollow, never fake green.
  return {
    ...base,
    level: "offline",
    known: false,
    stateKey: "signalState.unknown",
  };
}

/**
 * Sensible starter dots per profile — OFF until the operator opts in (the
 * "Configure dots" editor pre-fills these). Rendering keys off the stored
 * `dots`, so a node with no overlay shows no dots.
 */
export const DEFAULT_DOTS: Record<EffProfile, SignalKey[]> = {
  drone: ["link", "battery", "gps"],
  "flight-controller": ["link", "battery", "gps"],
  "ground-station": ["link", "uplink"],
  workstation: ["gpu", "jobs"],
};

/**
 * The signals a profile MAY pin. Gating by profile makes an impossible dot
 * unrepresentable (a workstation cannot pin `battery`, a drone cannot pin
 * `gpu`), mirroring the `NodeBadgeSet` construction.
 */
export const SIGNAL_ALLOWLIST: Record<EffProfile, SignalKey[]> = {
  drone: ["link", "battery", "gps", "arm", "prearm", "rc", "alerts", "cpu", "temp", "services"],
  "flight-controller": ["link", "battery", "gps", "arm", "prearm", "rc"],
  "ground-station": ["link", "rx", "uplink", "mesh", "mqtt", "alerts", "cpu", "temp", "services"],
  workstation: ["gpu", "jobs", "cluster", "thermal", "alerts", "cpu", "temp", "services"],
};

/** The allowlist of pinnable signals for a profile. */
export function allowedSignals(profile: EffProfile): SignalKey[] {
  return SIGNAL_ALLOWLIST[profile];
}

/** The default starter dots for a profile as stored `FeatureDot`s. */
export function defaultDots(profile: EffProfile): FeatureDot[] {
  return DEFAULT_DOTS[profile].map((signal) => ({ signal }));
}
