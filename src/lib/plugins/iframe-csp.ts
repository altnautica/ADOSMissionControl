/**
 * @module plugins/iframe-csp
 * @description The ONE Content-Security-Policy every plugin iframe document
 * carries, and the helper that guarantees it is present.
 *
 * ## Why the page CSP is not enough
 *
 * A plugin runs in `<iframe sandbox="allow-scripts">` whose `src` is a `blob:`
 * URL minted by the host document, so it has a null origin — but a `blob:`
 * document INHERITS the creator document's policy, and the app's policy has to
 * carry bare `http:`/`ws:`/`https:`/`wss:` in `connect-src` to reach LAN agents
 * at arbitrary RFC1918 addresses and `*.local` names (CSP3 has no CIDR source
 * expressions). Inheriting that gave a sandboxed plugin full outbound `fetch`
 * and WebSocket reach: everything the operator granted it — telemetry, mission
 * waypoints, perception detections, `cloud.read` results — could leave for an
 * arbitrary host with no capability, no prompt and no trace.
 *
 * Policies compose by intersection, so a policy declared INSIDE the frame
 * document can only tighten. That is the mechanism used here.
 *
 * ## Why `connect-src 'none'`
 *
 * Every GCS-half plugin capability is a postMessage bridge method — the host
 * performs the I/O and enforces the capability, and `postMessage` is not
 * governed by `connect-src`. No capability in `gcs-capabilities.generated.ts`
 * grants the frame direct network egress, and `network.outbound` is an
 * AGENT-half capability describing a process on the node, not this iframe. So
 * the correct origin set for a plugin frame is empty, for every plugin,
 * including one that declares every capability in the catalog.
 *
 * `script-src` deliberately omits `'unsafe-eval'`: plugin bundles are
 * single-file ESM with no `eval` / `new Function` / dynamic `import()`, and the
 * app-level `'unsafe-eval'` has no business reaching plugin code.
 *
 * @license GPL-3.0-only
 */

/**
 * The policy applied to a plugin iframe document.
 *
 *   * `default-src 'none'`   — deny by default; each directive below opts in.
 *   * `script-src 'unsafe-inline'` — the shell inlines the bundle as one
 *     `<script type="module">`; there is no origin to allow since the document
 *     is null-origin.
 *   * `style-src 'unsafe-inline'`  — the shell's inline reset plus whatever the
 *     plugin injects; no stylesheet is ever fetched.
 *   * `img-src data: blob:`        — plugin-rendered images arrive as data or
 *     blob URLs through the bridge, never from a network origin.
 *   * `connect-src 'none'`         — see the module note. This is the directive
 *     the whole file exists for.
 *   * `form-action 'none'`, `base-uri 'none'` — a plugin cannot navigate data
 *     out through a form submit or retarget relative URLs.
 */
export const PLUGIN_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The exact meta element injected into a plugin frame document. */
export const PLUGIN_FRAME_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_FRAME_CSP}">`;

/**
 * Return `html` with the plugin frame policy present as the first element of
 * `<head>`, adding it when absent and leaving an already-policed document
 * unchanged.
 *
 * Needed as a separate step from the shell builder because one of the three
 * bundle paths does not build its shell here: the cloud path uploads the shell
 * to Convex storage at install time and later re-fetches that stored document,
 * which for an install recorded before this policy existed carries no meta tag.
 * Normalising at blob-mint time closes that gap without a storage migration.
 *
 * A document with no `<head>` gets the meta injected after `<html …>`, or at
 * the very front as a last resort — a policy that lands late still applies to
 * everything parsed after it, and the alternative is shipping no policy.
 */
export function ensurePluginFrameCsp(html: string): string {
  if (/http-equiv=["']?Content-Security-Policy/i.test(html)) return html;
  const headOpen = html.match(/<head[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + PLUGIN_FRAME_CSP_META + html.slice(at);
  }
  const htmlOpen = html.match(/<html[^>]*>/i);
  if (htmlOpen?.index !== undefined) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return (
      html.slice(0, at) +
      `<head>${PLUGIN_FRAME_CSP_META}</head>` +
      html.slice(at)
    );
  }
  return PLUGIN_FRAME_CSP_META + html;
}
