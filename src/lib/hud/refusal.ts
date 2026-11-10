// Readable text for the refusal codes the drone answers a pilot action, a
// motion lease or a setup step with, from the spec's `refusal.*` keys. Codes
// the client makes up itself (`no response`, `no pilot link`, `closed`) carry
// spaces on the wire and map to underscores. `not_ready:<id>` names the
// readiness item that refused. An unknown code is shown, never dropped; a code
// naming one of the templates (`unknown`, a bare `not_ready`) is unknown too,
// so it never reads as a prefix with nothing after it.

import { hasSpecText, specTakesArgs, specText } from "./spec-text";

/** The text for a refusal code. `readinessLabel` names a readiness item for
 *  `not_ready:<id>`; without it the spec's `readiness.item.<id>` is used, else
 *  the id itself. */
export function refusalText(code: string | undefined | null, readinessLabel?: (id: string) => string): string {
  if (!code) return specText("refusal.none");
  if (code.startsWith("not_ready:")) {
    const id = code.slice("not_ready:".length);
    const item = readinessLabel?.(id) ?? (hasSpecText(`readiness.item.${id}`) ? specText(`readiness.item.${id}`) : id);
    return specText("refusal.not_ready", { item });
  }
  const key = `refusal.${code.replace(/ /g, "_")}`;
  return hasSpecText(key) && !specTakesArgs(key) ? specText(key) : specText("refusal.unknown", { code });
}
