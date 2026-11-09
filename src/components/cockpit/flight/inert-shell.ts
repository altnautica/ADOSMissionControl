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
 * Shell nodes mounted later under one of those ancestors (a failsafe banner
 * that appears mid-flight) are made inert as they arrive, by a
 * MutationObserver kept while the flight screen is up. Only elements this
 * call made inert are restored.
 *
 * @license GPL-3.0-only
 */

export function inertShellAround(frame: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  const doc = frame.ownerDocument;
  const view = doc.defaultView;
  const onPath = new Set<Node>();
  const parents: HTMLElement[] = [];
  const inertOne = (sib: Node): void => {
    if (onPath.has(sib) || !(sib instanceof HTMLElement) || sib.hasAttribute("inert")) return;
    if (sib.tagName === "SCRIPT" || sib.tagName === "STYLE") return;
    if (view?.getComputedStyle(sib).position === "fixed") return;
    sib.setAttribute("inert", "");
    changed.push(sib);
  };
  for (let node: HTMLElement | null = frame; node && node !== doc.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    onPath.add(node);
    parents.push(parent);
  }
  for (const parent of parents) for (const sib of Array.from(parent.children)) inertOne(sib);
  const MO = view?.MutationObserver;
  const observer = MO
    ? new MO((records) => {
        for (const r of records) for (const added of Array.from(r.addedNodes)) inertOne(added);
      })
    : null;
  for (const parent of parents) observer?.observe(parent, { childList: true });
  return () => {
    observer?.disconnect();
    for (const el of changed) el.removeAttribute("inert");
  };
}
