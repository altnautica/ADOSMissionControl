/**
 * @module hardware/radio/adapter-health
 * @description Resolves the two health readings a WFB radio adapter reports
 * about itself: its USB link, and whether it can inject.
 *
 * Both readings share a hazard. A radio adapter that enumerated on a slow
 * full-speed USB link still accepts frames from the driver, so its transmit
 * counter advances while almost nothing leaves the antenna; an adapter that
 * never entered monitor mode cannot transmit at all. Either way the link looks
 * busy from every counter above it, so the adapter's own report is the only
 * thing that separates a working radio from one that merely looks working.
 *
 * That makes absence the case worth naming. A node that reports no USB reading
 * has not said its adapter is fine — it has said nothing, and the two must not
 * collapse. Likewise a chipset name proves a device was identified, never that
 * it can inject: reading "injection ok" from a chipset string alone would state
 * a claim nothing measured. So each resolver has three answers, not two, and
 * every surface renders the third rather than rounding it toward health.
 *
 * @license GPL-3.0-only
 */

import type { useTranslations } from "next-intl";
import type { RadioDiagTone } from "./labels";

/**
 * USB link health of the selected radio adapter.
 *
 * - `degraded` — the adapter enumerated below high speed. It can advance its
 *   transmit counter while emitting no usable RF.
 * - `ok` — the adapter reported a healthy enumeration.
 * - `unknown` — no reading. NOT a proven `ok`.
 */
export type AdapterUsbState = "degraded" | "ok" | "unknown";

export interface AdapterUsbReading {
  state: AdapterUsbState;
  /** Enumerated USB speed in Mbps, null when the node did not report one. */
  speedMbps: number | null;
  tone: RadioDiagTone;
}

export interface AdapterUsbInputs {
  /**
   * The node's own verdict on its adapter's USB link. Null or undefined means
   * no verdict — an older agent, or a node with no adapter view to report
   * from. It is NOT a proven false.
   */
  degraded: boolean | null | undefined;
  /** Enumerated link speed in Mbps, when reported. */
  speedMbps: number | null | undefined;
}

/**
 * Resolve the USB reading. The speed is carried through for display but never
 * decides the state: inferring health from a fast enumeration would present a
 * guess as the adapter's own measurement, and the node already publishes the
 * verdict when it has one.
 */
export function resolveAdapterUsb(inputs: AdapterUsbInputs): AdapterUsbReading {
  const speedMbps =
    typeof inputs.speedMbps === "number" && Number.isFinite(inputs.speedMbps)
      ? inputs.speedMbps
      : null;
  if (typeof inputs.degraded !== "boolean") {
    return { state: "unknown", speedMbps, tone: "muted" };
  }
  return inputs.degraded
    ? { state: "degraded", speedMbps, tone: "error" }
    : { state: "ok", speedMbps, tone: "success" };
}

/**
 * Whether the selected radio adapter can inject.
 *
 * - `failed` — the node found no injection-capable adapter and refuses to
 *   transmit, which is the concrete cause behind an operator's "no video".
 * - `ok` — the node confirmed the adapter entered monitor mode.
 * - `unknown` — no reading. A chipset name alone lands here.
 */
export type AdapterInjectionState = "ok" | "failed" | "unknown";

export interface AdapterInjectionReading {
  state: AdapterInjectionState;
  /** Identified chipset, null when the node could not name one. */
  chipset: string | null;
  tone: RadioDiagTone;
}

export interface AdapterInjectionInputs {
  /**
   * The node's own verdict on injection capability. Null or undefined means no
   * verdict; it is NOT a proven true. Nodes have previously reported a
   * hardcoded true here, so an absent reading is the honest state to show.
   */
  injectionOk: boolean | null | undefined;
  /** Chipset the node identified, when it could. */
  chipset: string | null | undefined;
}

export function resolveAdapterInjection(
  inputs: AdapterInjectionInputs,
): AdapterInjectionReading {
  const chipset =
    typeof inputs.chipset === "string" && inputs.chipset.length > 0
      ? inputs.chipset
      : null;
  if (typeof inputs.injectionOk !== "boolean") {
    return { state: "unknown", chipset, tone: "muted" };
  }
  return inputs.injectionOk
    ? { state: "ok", chipset, tone: "success" }
    : { state: "failed", chipset, tone: "error" };
}

/**
 * Compact phrase for a USB reading, for a labelled slot that is always on
 * screen (an indicator tile, a definition-list row). The degraded case names
 * the speed when one was reported, because the number is what sends an
 * operator to a different port.
 */
export function adapterUsbLabel(
  t: ReturnType<typeof useTranslations>,
  reading: AdapterUsbReading,
): string {
  const { state, speedMbps } = reading;
  if (state === "unknown") return t("adapterUsb.unknown");
  if (state === "degraded") {
    return speedMbps != null
      ? t("adapterUsb.degradedSpeed", { speed: speedMbps })
      : t("adapterUsb.degraded");
  }
  return speedMbps != null
    ? t("adapterUsb.okSpeed", { speed: speedMbps })
    : t("adapterUsb.ok");
}

/**
 * Compact phrase for an injection reading. The chipset rides along when the
 * node named one, so a single slot answers both "which adapter" and "can it
 * transmit" without implying the first answers the second.
 */
export function adapterInjectionLabel(
  t: ReturnType<typeof useTranslations>,
  reading: AdapterInjectionReading,
): string {
  const { state, chipset } = reading;
  if (state === "failed") {
    return chipset
      ? t("adapterInjection.failedChipset", { chipset })
      : t("adapterInjection.failed");
  }
  if (state === "ok") {
    return chipset
      ? t("adapterInjection.okChipset", { chipset })
      : t("adapterInjection.ok");
  }
  return chipset
    ? t("adapterInjection.unknownChipset", { chipset })
    : t("adapterInjection.unknown");
}
