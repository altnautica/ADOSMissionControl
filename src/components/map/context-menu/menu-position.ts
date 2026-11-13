/**
 * @license GPL-3.0-only
 *
 * Where the map's point menu sits on the page. The menu is portalled to the
 * body and `fixed`, so it is kept inside the viewport, not the map: a small
 * map such as the flight minimap would otherwise push the lower items below
 * the fold. A menu taller than the viewport is capped and scrolls.
 */

/** Gap kept between the menu and the viewport edge. */
const EDGE = 8;

export function menuViewportStyle(
  pointer: { x: number; y: number },
  container: { left: number; top: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; minWidth: number; maxHeight: number } {
  const maxHeight = Math.max(0, viewport.height - 2 * EDGE);
  const height = Math.min(menu.height, maxHeight);
  const left = Math.max(EDGE, Math.min(container.left + pointer.x, viewport.width - menu.width - EDGE));
  const top = Math.max(EDGE, Math.min(container.top + pointer.y, viewport.height - height - EDGE));
  return { left, top, minWidth: menu.width, maxHeight };
}
