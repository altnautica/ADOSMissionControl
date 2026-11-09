/**
 * @module cockpit/flight/inert-shell
 * @description The flight screen covers the whole viewport while the app
 * shell (fleet list, header, the drone page's tabs, the right rail) stays
 * mounted underneath. This makes that hidden page `inert` (out of the tab
 * order, not operable, not read by screen readers) while the flight screen is
 * mounted, and restores it on exit.
 *
 * Every sibling of the frame and of each of its ancestors up to `<body>` is
 * made inert, except fixed-position overlays (the confirm sheets, toasts and
 * portalled menus layered above the flight screen), which must stay usable.
 * Only elements this call made inert are restored.
 *
 * @license GPL-3.0-only
 */

export function inertShellAround(frame: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  const view = frame.ownerDocument.defaultView;
  for (let node: HTMLElement | null = frame; node && node !== frame.ownerDocument.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || !(sib instanceof HTMLElement) || sib.hasAttribute("inert")) continue;
      if (sib.tagName === "SCRIPT" || sib.tagName === "STYLE") continue;
      if (view?.getComputedStyle(sib).position === "fixed") continue;
      sib.setAttribute("inert", "");
      changed.push(sib);
    }
  }
  return () => {
    for (const el of changed) el.removeAttribute("inert");
  };
}
