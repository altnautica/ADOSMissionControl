/**
 * @module plugins/trust-signals
 * @description The ONE derivation of a plugin's trust signals from its
 * verification result. Every surface that shows trust badges — the install
 * pop-up header, the plugin cards, the MCP tab — resolves the same signal
 * set here so a plugin never reads as "verified" on one surface and
 * "unsigned" on another.
 *
 * A trust signal is the RESULT of verification, never a claim. The `signed`,
 * `verified-publisher` and `first-party` signals are emitted only when
 * `signatureState === "verified"`, i.e. the archive's detached Ed25519
 * signature verified against an enrolled public key in
 * `plugins/archive-signature`. A `signer_id` inside the archive is an
 * unauthenticated string and produces nothing on its own.
 *
 * First-party is the strongest claim: a verified signature under a signer id
 * on the hand-maintained first-party allowlist. Any other verified signer
 * means only that the archive is signed. An open (auditable) license adds the
 * open-source signal, and a declared closed vendor binary adds the
 * vendor-binary signal — neither depends on the signature.
 *
 * @license GPL-3.0-only
 */

import type { TrustSignal } from "@/components/plugins/TrustBadge";

import type { PluginSignatureState } from "./archive-signature";
import { isEnrolledFirstPartySigner } from "./signing-keys";

/**
 * Open-source SPDX license id fragments. A license string containing any of
 * these (case-insensitive) is treated as publicly auditable. Kept as
 * substrings so `GPL-3.0-or-later`, `GPL-3.0-only`, `Apache-2.0`, etc. all
 * resolve without an exhaustive SPDX table.
 */
const OPEN_LICENSE_HINTS: readonly string[] = [
  "gpl",
  "lgpl",
  "agpl",
  "mit",
  "apache",
  "bsd",
  "mpl",
  "cc0",
  "cc-by",
  "isc",
  "unlicense",
  "zlib",
];

/**
 * The facts the trust derivation reads. A structural subset of
 * `InstallManifestSummary` so any caller can pass the summary (or a lean
 * card row) without a cast.
 */
export interface TrustSignalInput {
  /**
   * Outcome of verifying the archive's detached signature. REQUIRED, and the
   * gate on every signature-derived signal: a caller that has not verified
   * must pass `"unverified"` and gets no signature badge, rather than being
   * able to omit the field and fall through to trusting `signerId`.
   */
  signatureState: PluginSignatureState;
  /**
   * The signer id the signature verified under. Read only when
   * `signatureState === "verified"`; ignored otherwise.
   */
  signerId?: string;
  /** SPDX license string declared in the manifest. */
  license?: string;
  /** Declared closed-source vendor-binary attribution rows, if any. */
  vendorAttribution?: ReadonlyArray<{ name?: string }>;
}

/**
 * Resolve the full logical trust-signal set for a plugin. Callers that want
 * a de-duplicated display set (first-party subsumes verified-publisher) use
 * {@link displayTrustSignals}.
 */
export function deriveTrustSignals(input: TrustSignalInput): TrustSignal[] {
  const signals: TrustSignal[] = [];
  if (input.signatureState === "verified") {
    signals.push("signed");
    if (isEnrolledFirstPartySigner(input.signerId)) {
      signals.push("verified-publisher");
      signals.push("first-party");
    }
  }
  if (isOpenLicense(input.license)) signals.push("open-source");
  if (input.vendorAttribution && input.vendorAttribution.length > 0) {
    signals.push("vendor-binary");
  }
  return signals;
}

/**
 * The trust-signal set to render as badges. Identical to
 * {@link deriveTrustSignals} except `verified-publisher` is dropped when
 * `first-party` is present — first-party is the stronger claim, so showing
 * both is redundant noise on a header row.
 */
export function displayTrustSignals(input: TrustSignalInput): TrustSignal[] {
  const all = deriveTrustSignals(input);
  if (all.includes("first-party")) {
    return all.filter((s) => s !== "verified-publisher");
  }
  return all;
}

/**
 * True for a license string that names an open, publicly auditable SPDX id.
 * Substring matching keeps `GPL-3.0-or-later`, `Apache-2.0` and friends
 * resolving without an exhaustive SPDX table.
 */
function isOpenLicense(license?: string): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  return OPEN_LICENSE_HINTS.some((hint) => l.includes(hint));
}
