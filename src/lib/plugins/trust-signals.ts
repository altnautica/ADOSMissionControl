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

import type { PluginSignatureState } from "./archive-signature";
import { isEnrolledFirstPartySigner } from "./signing-keys";

/** One trust badge a plugin surface may show. */
export type TrustSignal =
  | "signed"
  | "verified-publisher"
  | "first-party"
  | "open-source"
  | "vendor-binary"
  | "unsigned";

/**
 * SPDX license ids that are open and publicly auditable, upper-cased. Whole
 * identifiers only: a licence string is matched token by token, never by
 * substring, so `UNLICENSED`, `LicenseRef-*` and prose such as "Limited Use"
 * never read as open.
 */
const OPEN_LICENSE_IDS: ReadonlySet<string> = new Set(
  [
    "0BSD", "AFL-3.0", "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later",
    "Apache-2.0", "Artistic-2.0", "BlueOak-1.0.0", "BSD-2-Clause",
    "BSD-3-Clause", "BSD-3-Clause-Clear", "BSL-1.0", "CC-BY-4.0",
    "CC-BY-SA-4.0", "CC0-1.0", "ECL-2.0", "EPL-2.0", "EUPL-1.2", "GPL-2.0",
    "GPL-2.0-only", "GPL-2.0-or-later", "GPL-3.0", "GPL-3.0-only",
    "GPL-3.0-or-later", "ISC", "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later",
    "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later", "MIT", "MIT-0",
    "MPL-2.0", "MS-PL", "NCSA", "OSL-3.0", "PostgreSQL", "Python-2.0",
    "Unlicense", "UPL-1.0", "Zlib",
  ].map((id) => id.toUpperCase()),
);

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
 * True when an SPDX license expression is open: every license a user must
 * accept is in {@link OPEN_LICENSE_IDS}. `A OR B` is open when either side is
 * (the user may pick it), `A AND B` only when both are; a `WITH` exception
 * does not change the verdict. Anything that does not parse as an SPDX
 * expression is not open.
 */
function isOpenLicense(license?: string): boolean {
  if (!license) return false;
  const tokens = license.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos]?.toUpperCase();
  // Each parse step returns the verdict, or null when the text is malformed.
  const primary = (): boolean | null => {
    const tok = tokens[pos++];
    if (tok === undefined) return null;
    if (tok === "(") {
      const inner = orExpr();
      if (tokens[pos++] !== ")") return null;
      return inner;
    }
    if (tok === ")" || ["AND", "OR", "WITH"].includes(tok.toUpperCase())) return null;
    const verdict = OPEN_LICENSE_IDS.has(tok.replace(/\+$/, "").toUpperCase());
    if (peek() === "WITH") {
      pos += 1;
      const exception = tokens[pos++];
      if (exception === undefined || exception === "(" || exception === ")") return null;
    }
    return verdict;
  };
  const andExpr = (): boolean | null => {
    let verdict = primary();
    while (verdict !== null && peek() === "AND") {
      pos += 1;
      const next = primary();
      verdict = next === null ? null : verdict && next;
    }
    return verdict;
  };
  const orExpr = (): boolean | null => {
    let verdict = andExpr();
    while (verdict !== null && peek() === "OR") {
      pos += 1;
      const next = andExpr();
      verdict = next === null ? null : verdict || next;
    }
    return verdict;
  };
  return orExpr() === true && pos === tokens.length;
}
