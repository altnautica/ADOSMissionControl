/**
 * Locale-aware number, distance, and coordinate formatting for the GCS UI.
 *
 * Wraps `Intl.NumberFormat` so EU users see comma decimals and dotted thousands
 * automatically. Use these helpers everywhere a `.toFixed(N)` would have shipped
 * in flight history, telemetry overlays, exports, and live HUDs.
 *
 * Server-side rendering safe: formatter cache is per-process, no DOM access.
 *
 * @license GPL-3.0-only
 */

import { defaultLocale, type Locale } from "@/i18n";

type FractionRange = { min: number; max: number };

function fractionRange(decimals: number | FractionRange): FractionRange {
  if (typeof decimals === "number") return { min: decimals, max: decimals };
  return decimals;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(
  locale: string,
  opts: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Format a finite number with a fixed or ranged decimal precision.
 * Returns the placeholder when the value is null, undefined, NaN, or infinite.
 */
export function formatDecimal(
  value: number | null | undefined,
  decimals: number | FractionRange = 1,
  locale: Locale | string = defaultLocale,
  placeholder = "—",
): string {
  if (value === null || value === undefined) return placeholder;
  if (!Number.isFinite(value)) return placeholder;
  const { min, max } = fractionRange(decimals);
  return getFormatter(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(value);
}

/**
 * Format a percentage from a 0..1 ratio. Pass `decimals: 0` for "85%".
 */
export function formatPercent(
  ratio: number | null | undefined,
  decimals = 0,
  locale: Locale | string = defaultLocale,
  placeholder = "—",
): string {
  if (ratio === null || ratio === undefined) return placeholder;
  if (!Number.isFinite(ratio)) return placeholder;
  return getFormatter(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(ratio);
}

/**
 * Format a distance in meters. Auto-switches to kilometres above 1000m.
 * Returned string includes the unit suffix.
 */
export function formatDistance(
  meters: number | null | undefined,
  locale: Locale | string = defaultLocale,
  placeholder = "—",
): string {
  if (meters === null || meters === undefined) return placeholder;
  if (!Number.isFinite(meters)) return placeholder;
  if (Math.abs(meters) >= 1000) {
    return `${formatDecimal(meters / 1000, { min: 1, max: 2 }, locale, placeholder)} km`;
  }
  return `${formatDecimal(meters, 0, locale, placeholder)} m`;
}

/**
 * Format kilometres directly (caller already has km-scale value).
 */
export function formatKilometres(
  km: number | null | undefined,
  decimals = 1,
  locale: Locale | string = defaultLocale,
  placeholder = "—",
): string {
  return `${formatDecimal(km, decimals, locale, placeholder)} km`;
}

/**
 * Format a duration in seconds as `mm:ss` or `h:mm:ss` for longer values.
 */
export function formatDurationSeconds(
  seconds: number | null | undefined,
  placeholder = "—",
): string {
  if (seconds === null || seconds === undefined) return placeholder;
  if (!Number.isFinite(seconds) || seconds < 0) return placeholder;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/**
 * Format flight hours (decimal hours) like `1.5 hrs`.
 */
export function formatHours(
  hours: number | null | undefined,
  decimals = 1,
  locale: Locale | string = defaultLocale,
  placeholder = "—",
): string {
  return formatDecimal(hours, decimals, locale, placeholder);
}

/**
 * Format a lat/lon coordinate pair to a fixed precision. Default 5 decimals
 * gives ~1.1m resolution, matching the existing `.toFixed(5)` sites. The pair
 * is joined with "; " because comma-decimal locales (fr, de, es, pt, id)
 * render each number with a comma, which made "48,85837, 2,29448" ambiguous.
 */
export function formatCoord(
  lat: number | null | undefined,
  lon: number | null | undefined,
  decimals = 5,
  locale: Locale | string = defaultLocale,
  placeholder = "—",
): string {
  const a = formatDecimal(lat, decimals, locale, placeholder);
  const b = formatDecimal(lon, decimals, locale, placeholder);
  return `${a}; ${b}`;
}
