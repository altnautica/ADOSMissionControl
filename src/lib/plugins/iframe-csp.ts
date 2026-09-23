/**
 * @module plugins/iframe-csp
 * @description The ONE Content-Security-Policy every plugin iframe document
 * carries, the script that removes the network paths CSP does not govern, and
 * the helper that guarantees both are present.
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
 * ## WebRTC
 *
 * `connect-src` does not govern `RTCPeerConnection`: ICE gathering against a
 * STUN/TURN server of the plugin's choosing (or a data channel) is network
 * egress CSP cannot stop in current Chromium, which does not implement the
 * `webrtc` directive. The policy still carries `webrtc 'block'` for engines
 * that do. {@link PLUGIN_FRAME_GUARD_SCRIPT} closes the gap in the frame
 * itself: it runs before the plugin bundle, deletes every `RTC*` interface
 * from the frame's global, and refuses nested browsing contexts, since a
 * same-origin child frame would hand the plugin a fresh global with the
 * interfaces restored.
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
 *   * `script-src 'unsafe-inline'` — the shell inlines the guard and the bundle;
 *     there is no origin to allow since the document is null-origin.
 *   * `style-src 'unsafe-inline'`  — the shell's inline reset plus whatever the
 *     plugin injects; no stylesheet is ever fetched.
 *   * `img-src data: blob:`        — plugin-rendered images arrive as data or
 *     blob URLs through the bridge, never from a network origin.
 *   * `connect-src 'none'`         — see the module note.
 *   * `webrtc 'block'`             — see the module note; enforced by the guard
 *     script where the engine ignores the directive.
 *   * `form-action 'none'`, `base-uri 'none'` — a plugin cannot navigate data
 *     out through a form submit or retarget relative URLs.
 */
export const PLUGIN_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "webrtc 'block'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** The exact meta element injected into a plugin frame document. */
export const PLUGIN_FRAME_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_FRAME_CSP}">`;

/**
 * Classic script run in the plugin frame before the bundle. It deletes every
 * `RTC*` / `webkitRTC*` interface from the frame's global, and after every DOM
 * API that can connect an element (and on a mutation-observer backstop) it
 * removes any nested frame; if a nested browsing context survives that, it
 * tears the document down and throws, so a plugin never reaches a child
 * global with WebRTC restored.
 */
export const PLUGIN_FRAME_GUARD_SCRIPT = `(() => {
"use strict";
const w = window;
for (const n of Object.getOwnPropertyNames(w)) {
  if (/^(webkit)?RTC/.test(n)) { try { delete w[n]; } catch (e) {} }
}
const FRAMES = "iframe,frame,object,embed,fencedframe,portal";
const roots = [document];
const observer = new MutationObserver(() => purge());
const purge = () => {
  if (!(w.length > 0)) return;
  for (const r of roots) for (const f of r.querySelectorAll(FRAMES)) f.remove();
  if (w.length > 0) {
    document.documentElement.remove();
    throw new Error("nested frames are not permitted in a plugin frame");
  }
};
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init) {
  const root = attach.call(this, init);
  roots.push(root);
  observer.observe(root, { childList: true, subtree: true });
  return root;
};
const wrap = (proto, name) => {
  const d = Object.getOwnPropertyDescriptor(proto, name);
  if (!d) return;
  if (typeof d.value === "function") {
    const f = d.value;
    d.value = function (...a) { const r = f.apply(this, a); purge(); return r; };
  } else if (d.set) {
    const s = d.set;
    d.set = function (v) { s.call(this, v); purge(); };
  } else return;
  Object.defineProperty(proto, name, d);
};
const SINKS = [
  [Node.prototype, ["appendChild", "insertBefore", "replaceChild"]],
  [Element.prototype, ["append", "prepend", "before", "after", "replaceWith", "replaceChildren", "moveBefore", "insertAdjacentElement", "insertAdjacentHTML", "setHTMLUnsafe", "innerHTML", "outerHTML"]],
  [CharacterData.prototype, ["before", "after", "replaceWith"]],
  [DocumentFragment.prototype, ["append", "prepend", "replaceChildren", "moveBefore"]],
  [ShadowRoot.prototype, ["innerHTML", "setHTMLUnsafe"]],
  [Document.prototype, ["append", "prepend", "replaceChildren", "moveBefore", "write", "writeln", "execCommand", "body"]],
  [Range.prototype, ["insertNode", "surroundContents"]],
];
for (const [proto, names] of SINKS) for (const n of names) wrap(proto, n);
observer.observe(document, { childList: true, subtree: true });
})();`;

/** Everything the frame's `<head>` must start with: the policy, then the guard. */
export const PLUGIN_FRAME_HEAD = `${PLUGIN_FRAME_CSP_META}<script>${PLUGIN_FRAME_GUARD_SCRIPT}</script>`;

/**
 * Return `html` with {@link PLUGIN_FRAME_HEAD} as the first content of
 * `<head>`.
 *
 * Needed as a separate step from the shell builder because one of the three
 * bundle paths does not build its shell here: the cloud path uploads the shell
 * to Convex storage at install time and later re-fetches that stored document,
 * which for an install recorded before the policy or guard existed carries
 * neither. Normalising at blob-mint time closes that gap without a storage
 * migration.
 *
 * The head is injected unconditionally, never skipped because the document
 * already mentions a policy: the plugin bundle inlined in the shell can
 * contain that text anywhere, and policies intersect, so a duplicate can only
 * tighten. A document with no `<head>` gets one after `<html …>`, or at the
 * very front as a last resort.
 */
export function ensurePluginFrameCsp(html: string): string {
  const headOpen = html.match(/<head(\s[^>]*)?>/i);
  if (headOpen?.index !== undefined) {
    const at = headOpen.index + headOpen[0].length;
    return html.slice(0, at) + PLUGIN_FRAME_HEAD + html.slice(at);
  }
  const htmlOpen = html.match(/<html(\s[^>]*)?>/i);
  if (htmlOpen?.index !== undefined) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return html.slice(0, at) + `<head>${PLUGIN_FRAME_HEAD}</head>` + html.slice(at);
  }
  return PLUGIN_FRAME_HEAD + html;
}
