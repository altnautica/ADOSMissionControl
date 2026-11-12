/**
 * Bring a tab into view by scrolling only its own strip sideways.
 *
 * `scrollIntoView` scrolls every scrollable ancestor, the document included:
 * on a phone-width viewport it pushed the whole page sideways to reach a tab
 * past the edge.
 *
 * @license GPL-3.0-only
 */
export function revealInStrip(strip: HTMLElement | null, tab: HTMLElement | null): void {
  if (!strip || !tab) return;
  const s = strip.getBoundingClientRect();
  const r = tab.getBoundingClientRect();
  if (r.left < s.left) strip.scrollLeft -= s.left - r.left;
  else if (r.right > s.right) strip.scrollLeft += r.right - s.right;
}
