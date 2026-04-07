import type { FlightRecord, SuiteType } from "@/lib/types";

const SUITE_NAMES: SuiteType[] = ["sentry", "survey", "sar", "agriculture", "cargo", "inspection"];
const DRONE_NAMES = ["Alpha-1", "Bravo-2", "Echo-5", "Charlie", "Delta"];
const DRONE_IDS = ["alpha-1", "bravo-2", "echo-5", "charlie", "delta"];

/** Seeded PRNG (mulberry32) — same seed produces identical output on SSR and CSR. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate 30 days of mock flight history (87 flights). */
export function generateFlightHistory(): FlightRecord[] {
  const rand = mulberry32(42);
  const randInt = (min: number, max: number) =>
    Math.floor(rand() * (max - min + 1)) + min;
  const randId = () => rand().toString(36).substring(2, 10);

  const records: FlightRecord[] = [];
  // Anchor 1 day in the past so the newest demo flights look "today"
  // and the oldest are ~30 days old. Recomputed each call.
  const baseTime = Date.now() - 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < 87; i++) {
    const droneIdx = randInt(0, 3); // exclude Delta (maintenance)
    const date = baseTime - rand() * thirtyDaysMs;
    const duration = randInt(300, 2400); // 5-40 min
    const distance = randInt(500, 15000); // 0.5-15 km
    const isAborted = rand() < 0.05;
    const isEmergency = rand() < 0.02;

    records.push({
      id: randId(),
      droneId: DRONE_IDS[droneIdx],
      droneName: DRONE_NAMES[droneIdx],
      suiteType: SUITE_NAMES[randInt(0, SUITE_NAMES.length - 1)],
      date,
      startTime: date,
      endTime: date + duration * 1000,
      duration,
      distance,
      maxAlt: randInt(30, 120),
      maxSpeed: randInt(5, 18),
      batteryUsed: randInt(15, 65),
      waypointCount: randInt(4, 24),
      status: isEmergency ? "emergency" : isAborted ? "aborted" : "completed",
      updatedAt: date + duration * 1000,
    });
  }

  return records.sort((a, b) => b.date - a.date);
}

let _cachedHistory: FlightRecord[] | null = null;

/**
 * Returns the seeded demo flight history. Should ONLY be called from
 * demo-mode entry points. Use {@link seedDemoHistory} as the canonical name;
 * `getFlightHistory` is kept as a back-compat alias for existing callers.
 */
export function seedDemoHistory(): FlightRecord[] {
  if (!_cachedHistory) _cachedHistory = generateFlightHistory();
  return _cachedHistory;
}

/** @deprecated use {@link seedDemoHistory} */
export function getFlightHistory(): FlightRecord[] {
  return seedDemoHistory();
}
