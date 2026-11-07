/**
 * @module fc-setup/strings
 * @description Setup wizard text and pictures from the cockpit spec:
 * `setup-strings.json` (`{v, locale, strings:{"<dotted.key>": "English {arg}"}}`)
 * and `setup-images/<key>.svg`, where a step's `image` is the file stem. Every
 * surface resolves the engine's text keys through the same file, so the wizard
 * reads the same on all of them. A test checks that {@link SETUP_IMAGES}
 * lists every picture the spec ships.
 * @license GPL-3.0-only
 */

import setupStrings from "@/lib/cockpit/spec/setup-strings.json";
import accelBack from "@/lib/cockpit/spec/setup-images/accel_back.svg";
import accelLeft from "@/lib/cockpit/spec/setup-images/accel_left.svg";
import accelLevel from "@/lib/cockpit/spec/setup-images/accel_level.svg";
import accelNoseDown from "@/lib/cockpit/spec/setup-images/accel_nose_down.svg";
import accelNoseUp from "@/lib/cockpit/spec/setup-images/accel_nose_up.svg";
import accelRight from "@/lib/cockpit/spec/setup-images/accel_right.svg";
import airspeedCover from "@/lib/cockpit/spec/setup-images/airspeed_cover.svg";
import compassRotate from "@/lib/cockpit/spec/setup-images/compass_rotate.svg";
import levelPlane from "@/lib/cockpit/spec/setup-images/level_plane.svg";
import motorOrderHexaPlus from "@/lib/cockpit/spec/setup-images/motor_order_hexa_plus.svg";
import motorOrderHexaX from "@/lib/cockpit/spec/setup-images/motor_order_hexa_x.svg";
import motorOrderOctaX from "@/lib/cockpit/spec/setup-images/motor_order_octa_x.svg";
import motorOrderQuadH from "@/lib/cockpit/spec/setup-images/motor_order_quad_h.svg";
import motorOrderQuadPlus from "@/lib/cockpit/spec/setup-images/motor_order_quad_plus.svg";
import motorOrderQuadX from "@/lib/cockpit/spec/setup-images/motor_order_quad_x.svg";
import surfacesElevon from "@/lib/cockpit/spec/setup-images/surfaces_elevon.svg";
import surfacesNormal from "@/lib/cockpit/spec/setup-images/surfaces_normal.svg";
import surfacesVtail from "@/lib/cockpit/spec/setup-images/surfaces_vtail.svg";
import vtolTransition from "@/lib/cockpit/spec/setup-images/vtol_transition.svg";

import type { SetupValue } from "./types";

const STRINGS: Readonly<Record<string, string>> = setupStrings.strings;

/** A bundled image import: a URL string (Vite) or `{src}` (Next). */
type ImageImport = string | { src: string };

/** Every spec setup picture, by file stem. */
export const SETUP_IMAGES: Readonly<Record<string, ImageImport>> = {
  accel_back: accelBack,
  accel_left: accelLeft,
  accel_level: accelLevel,
  accel_nose_down: accelNoseDown,
  accel_nose_up: accelNoseUp,
  accel_right: accelRight,
  airspeed_cover: airspeedCover,
  compass_rotate: compassRotate,
  level_plane: levelPlane,
  motor_order_hexa_plus: motorOrderHexaPlus,
  motor_order_hexa_x: motorOrderHexaX,
  motor_order_octa_x: motorOrderOctaX,
  motor_order_quad_h: motorOrderQuadH,
  motor_order_quad_plus: motorOrderQuadPlus,
  motor_order_quad_x: motorOrderQuadX,
  surfaces_elevon: surfacesElevon,
  surfaces_normal: surfacesNormal,
  surfaces_vtail: surfacesVtail,
  vtol_transition: vtolTransition,
};

/** Fill `{arg}` placeholders from `args`; an unknown placeholder stays as written. */
export function interpolate(template: string, args: Record<string, SetupValue>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const v = args[name];
    return v === undefined || v === null ? whole : formatValue(v);
  });
}

/** The English text for `key` with `args` filled in. Per the spec's lookup
 *  rule, a missing `setup.<step>.body.<variant|phase>` falls back to
 *  `setup.<step>.body`; any other key the spec does not carry renders as the
 *  key itself, so a gap is visible rather than blank. */
export function setupText(
  key: string,
  args: Record<string, SetupValue> = {},
  table: Readonly<Record<string, string>> = STRINGS,
): string {
  const bodyVariant = /^(setup\.[^.]+\.body)\.[^.]+$/.exec(key);
  const template = table[key] ?? (bodyVariant ? table[bodyVariant[1]] : undefined);
  return template === undefined ? key : interpolate(template, args);
}

/** An enum option's text: its own `label_key`, else the engine's convention
 *  `<input label_key>.<value>` when the spec carries it, else the value. */
export function optionText(inputLabelKey: string, value: SetupValue, labelKey: string | null): string {
  if (labelKey) return setupText(labelKey);
  const named = `${inputLabelKey}.${String(value)}`;
  return named in STRINGS ? setupText(named) : formatValue(value);
}

/** A live-value or result key as a label: the spec's `setup.<group>.<key>`
 *  when it names one, else the key itself resolved as a text key. */
export function setupLabel(group: "live" | "result", key: string, args: Record<string, SetupValue> = {}): string {
  const named = `setup.${group}.${key}`;
  return setupText(named in STRINGS ? named : key, args);
}

/** The bundled URL of `setup-images/<key>.svg`, or null when the spec has none. */
export function setupImageUrl(key: string | null): string | null {
  if (!key) return null;
  const img = SETUP_IMAGES[key];
  if (!img) return null;
  return typeof img === "string" ? img : img.src;
}

/** A value as the wizard shows it: numbers to at most three decimals,
 *  booleans as ✓/✗, nested objects flattened to `k v` pairs. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
  if (typeof v === "boolean") return v ? "✓" : "✗";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (typeof v === "object") {
    return Object.entries(v)
      .map(([k, val]) => `${k} ${formatValue(val)}`)
      .join(" · ");
  }
  return String(v);
}
