/**
 * @module nl-intent-parser
 * @description Deterministic (no-LLM) natural-language mission-intent parser.
 * Extracts a coarse mission intent (pattern, altitude, overlap, speed, place,
 * radius) from a free-text command using keyword and number regexes only.
 * No network, no AI. Callers map the returned intent onto the pattern store /
 * mission planner. Only fields actually present in the text are returned; the
 * whole call returns `null` when nothing is recognized.
 * @license GPL-3.0-only
 */

/** Coarse flight-pattern the operator asked for. */
export type MissionPattern = "survey" | "orbit" | "corridor" | "perimeter";

/** A parsed mission intent. Every field is optional; absent means not stated. */
export interface MissionIntent {
  pattern?: MissionPattern;
  /** Altitude AGL in metres. */
  altitudeM?: number;
  /** Image/scan overlap as a percentage (0-100). */
  overlapPct?: number;
  /** Cruise speed in metres per second. */
  speedMps?: number;
  /** Free-text place / target name ("around <place>" / "of <place>"). */
  place?: string;
  /** Orbit / perimeter radius in metres. */
  radiusM?: number;
}

// Keyword → pattern. The earliest-occurring keyword in the text wins so the
// mapping is deterministic when several are present.
const PATTERN_KEYWORDS: { re: RegExp; pattern: MissionPattern }[] = [
  { re: /\bsurvey(?:s|ing|ed)?\b/i, pattern: "survey" },
  { re: /\bmap(?:ping|s|ped)?\b/i, pattern: "survey" },
  { re: /\borbit(?:s|ing|ed)?\b/i, pattern: "orbit" },
  { re: /\binspect(?:s|ing|ion|ions|ed)?\b/i, pattern: "orbit" },
  { re: /\bcorridor(?:s)?\b/i, pattern: "corridor" },
  { re: /\bperimeter(?:s)?\b/i, pattern: "perimeter" },
];

// "radius 100m" / "radius of 80 metres" / "radius 50".
const RADIUS_RE = /\bradius\s*(?:of\s+)?(\d+(?:\.\d+)?)\s*(?:m\b|meters?\b|metres?\b)?/i;

// "at 50m" / "altitude 50" / "height of 120 metres" — an explicit anchor is
// required so a bare number (e.g. a radius) is never mistaken for altitude.
const ALT_ANCHORED_RE =
  /\b(?:at|altitude|alt|height|elevation|agl)\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*(?:m\b|meters?\b|metres?\b)?/i;

// "50 metres" / "120 meters" — bare number with a fully spelled-out unit.
const ALT_UNIT_RE = /\b(\d+(?:\.\d+)?)\s*(?:meters?|metres?)\b/i;

// "70% overlap" / "70 % overlap" / bare "75%".
const OVERLAP_PCT_RE = /(\d+(?:\.\d+)?)\s*%/;
// "overlap 70" / "overlap of 70".
const OVERLAP_WORD_RE = /\boverlap\s+(?:of\s+)?(\d+(?:\.\d+)?)/i;

// "5 m/s" / "5m/s".
const SPEED_MPS_UNIT_RE = /(\d+(?:\.\d+)?)\s*m\s*\/\s*s\b/i;
// "5 mps".
const SPEED_MPS_ABBR_RE = /(\d+(?:\.\d+)?)\s*mps\b/i;
// "speed 5" / "speed of 5".
const SPEED_WORD_RE = /\bspeed\s+(?:of\s+)?(\d+(?:\.\d+)?)/i;

// "around <place>" / "of <place>" / "near <place>" / "over <place>", captured
// up to the next known keyword, a number, punctuation, or end of string. The
// place must start with a non-digit so "altitude of 50m" is never a place.
const PLACE_RE =
  /\b(?:around|over|near|of)\s+([^\d\s].*?)(?=(?:\s+(?:at|with|radius|altitude|alt|height|elevation|agl|speed|overlap|and|then|for)\b)|\s*[,;.]|\s+\d|$)/i;

function toNum(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** First successful match across an ordered list of regexes, else null. */
function firstMatch(text: string, regexes: RegExp[]): RegExpExecArray | null {
  for (const re of regexes) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}

function detectPattern(text: string): MissionPattern | undefined {
  let bestIndex = Infinity;
  let bestPattern: MissionPattern | undefined;
  for (const { re, pattern } of PATTERN_KEYWORDS) {
    const m = re.exec(text);
    if (m && m.index < bestIndex) {
      bestIndex = m.index;
      bestPattern = pattern;
    }
  }
  return bestPattern;
}

/** Replace a matched span with equal-length spaces so a later pass skips it. */
function maskSpan(text: string, match: RegExpExecArray | null): string {
  if (!match) return text;
  const start = match.index;
  const end = start + match[0].length;
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

function detectPlace(text: string): string | undefined {
  const m = PLACE_RE.exec(text);
  if (!m) return undefined;
  const place = m[1].trim().replace(/\s+/g, " ");
  return place.length > 0 ? place : undefined;
}

/**
 * Parse a free-text mission command into a coarse {@link MissionIntent}.
 * Returns `null` when no field is recognized. Purely deterministic — the same
 * input always yields the same output, with no network or model calls.
 */
export function parseMissionIntent(text: string): MissionIntent | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  const intent: MissionIntent = {};

  const pattern = detectPattern(text);
  if (pattern) intent.pattern = pattern;

  // Radius, speed and overlap carry their own numbers. Read them from the raw
  // text, then mask their spans out before the altitude pass so a value like
  // "5 m/s" (speed) or "radius 80m" is never mis-read as an altitude.
  const radiusMatch = RADIUS_RE.exec(text);
  const speedMatch = firstMatch(text, [SPEED_MPS_UNIT_RE, SPEED_MPS_ABBR_RE, SPEED_WORD_RE]);
  const overlapMatch = firstMatch(text, [OVERLAP_PCT_RE, OVERLAP_WORD_RE]);

  const radiusM = toNum(radiusMatch?.[1]);
  if (radiusM !== undefined) intent.radiusM = radiusM;

  const speedMps = toNum(speedMatch?.[1]);
  if (speedMps !== undefined) intent.speedMps = speedMps;

  const overlapPct = toNum(overlapMatch?.[1]);
  if (overlapPct !== undefined) intent.overlapPct = overlapPct;

  let masked = text;
  masked = maskSpan(masked, radiusMatch);
  masked = maskSpan(masked, speedMatch);
  masked = maskSpan(masked, overlapMatch);
  const altMatch = firstMatch(masked, [ALT_ANCHORED_RE, ALT_UNIT_RE]);
  const altitudeM = toNum(altMatch?.[1]);
  if (altitudeM !== undefined) intent.altitudeM = altitudeM;

  // The place pass reads the same masked text, so "radius of 80m" can never
  // be taken as "of <place>".
  const place = detectPlace(masked);
  if (place !== undefined) intent.place = place;

  return Object.keys(intent).length > 0 ? intent : null;
}
