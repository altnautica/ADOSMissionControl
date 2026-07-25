import { useEffect, useMemo, useState } from "react";
import { useTelemetryStore } from "@/stores/telemetry-store";

type FreshnessLevel = "fresh" | "stale" | "lost" | "none";

type TelemetryChannel =
  | "attitude"
  | "position"
  | "battery"
  | "gps"
  | "vfr"
  | "rc"
  | "sysStatus"
  | "radio"
  | "ekf"
  | "vibration"
  | "servoOutput"
  | "wind"
  | "terrain"
  | "navController";

interface TelemetryFreshnessResult {
  /** Get freshness for a specific channel */
  getFreshness: (channel: TelemetryChannel) => FreshnessLevel;
  /** Map of all channel freshness levels */
  channels: Map<TelemetryChannel, FreshnessLevel>;
  /** Overall system freshness (worst of key channels) */
  overall: FreshnessLevel;
}

const ALL_CHANNELS: TelemetryChannel[] = [
  "attitude",
  "position",
  "battery",
  "gps",
  "vfr",
  "rc",
  "sysStatus",
  "radio",
  "ekf",
  "vibration",
  "servoOutput",
  "wind",
  "terrain",
  "navController",
];

/** Key channels used for overall freshness assessment */
const KEY_CHANNELS: TelemetryChannel[] = [
  "attitude",
  "position",
  "battery",
  "gps",
];

const FRESH_MS = 2000;
const STALE_MS = 5000;

/** Max age for a telemetry sample to count as "live" for a readout gate. */
export const TELEMETRY_FRESH_MS = FRESH_MS;

/**
 * Whether a telemetry sample timestamp is fresh enough to render as live.
 * Pure (no hook) so a canvas HUD draw loop can gate each readout without a
 * React subscription — a blank "—" beats a frozen last value (Rule 44).
 */
export function isTimestampFresh(
  timestamp: number | undefined | null,
  maxAgeMs: number = FRESH_MS,
): boolean {
  return (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    Date.now() - timestamp < maxAgeMs
  );
}

function classifyFreshness(timestamp: number | undefined): FreshnessLevel {
  if (timestamp === undefined) return "none";
  const age = Date.now() - timestamp;
  if (age < FRESH_MS) return "fresh";
  if (age < STALE_MS) return "stale";
  return "lost";
}

/** Order: fresh < stale < lost < none (none is worst) */
const FRESHNESS_ORDER: Record<FreshnessLevel, number> = {
  fresh: 0,
  stale: 1,
  lost: 2,
  none: 3,
};

function worstFreshness(levels: FreshnessLevel[]): FreshnessLevel {
  if (levels.length === 0) return "none";
  let worst: FreshnessLevel = "fresh";
  for (const level of levels) {
    if (FRESHNESS_ORDER[level] > FRESHNESS_ORDER[worst]) {
      worst = level;
    }
  }
  return worst;
}

type ChannelLevels = Record<TelemetryChannel, FreshnessLevel>;

/**
 * Classify every channel from the live store. Reads through `getState()` on
 * purpose: the caller drives its own recompute schedule rather than taking a
 * React subscription on a store whose identity churns with every sample.
 */
function readLevels(): ChannelLevels {
  const state = useTelemetryStore.getState();
  const levels = {} as ChannelLevels;
  for (const ch of ALL_CHANNELS) {
    levels[ch] = classifyFreshness(state[ch].latest()?.timestamp);
  }
  return levels;
}

function sameLevels(a: ChannelLevels, b: ChannelLevels): boolean {
  for (const ch of ALL_CHANNELS) {
    if (a[ch] !== b[ch]) return false;
  }
  return true;
}

export function useTelemetryFreshness(): TelemetryFreshnessResult {
  const [levels, setLevels] = useState<ChannelLevels>(readLevels);

  useEffect(() => {
    // Freshness moves for two independent reasons: a sample arrives (a store
    // change) or time passes with no sample (the interval). Both recompute
    // from live state, so a link that dies mid-flight still decays to
    // stale/lost even though a dead link produces no store changes at all.
    //
    // Each recompute keeps the previous object when no channel actually
    // changed level, which makes React bail out of the render. The telemetry
    // store bumps its version on every sample, so subscribing to it directly
    // would re-render this hook's consumers at the sample rate to publish a
    // value that only moves across the 2s/5s thresholds.
    const sync = () =>
      setLevels((prev) => {
        const next = readLevels();
        return sameLevels(prev, next) ? prev : next;
      });

    const unsubscribe = useTelemetryStore.subscribe(sync);
    const id = setInterval(sync, 1000);
    // Catch a sample that landed between the initial render and this effect.
    sync();

    return () => {
      clearInterval(id);
      unsubscribe();
    };
  }, []);

  return useMemo(() => {
    const channels = new Map<TelemetryChannel, FreshnessLevel>(
      ALL_CHANNELS.map((ch) => [ch, levels[ch]] as const),
    );

    const getFreshness = (channel: TelemetryChannel): FreshnessLevel =>
      channels.get(channel) ?? "none";

    const overall = worstFreshness(KEY_CHANNELS.map((ch) => levels[ch]));

    return { getFreshness, channels, overall };
  }, [levels]);
}
