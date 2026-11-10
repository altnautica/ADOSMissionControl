/**
 * SVG icon path snippets used inside the right-click flight map menu.
 * Each value is the inner markup of a 14x14 viewBox SVG.
 *
 * @license GPL-3.0-only
 */

export const ICONS: Record<string, string> = {
  flyHere: '<polygon points="7,1 13,13 7,9 1,13" fill="#3A82FF" fill-opacity="0.6" stroke="#3A82FF" stroke-width="1"/>',
  flyHereAlt: '<polygon points="7,3 11,11 7,8 3,11" fill="none" stroke="#3A82FF" stroke-width="1.2"/><line x1="12" y1="2" x2="12" y2="6" stroke="#3A82FF" stroke-width="1.2"/>',
  launch: '<path d="M7,1 L10,6 L10,10 L4,10 L4,6 Z" fill="none" stroke="#22c55e" stroke-width="1.2"/><path d="M5,12 L7,10 L9,12" fill="none" stroke="#22c55e" stroke-width="1"/>',
  orbit: '<circle cx="7" cy="7" r="5" fill="none" stroke="#3A82FF" stroke-width="1.2" stroke-dasharray="3 2"/><circle cx="7" cy="2" r="1.5" fill="#3A82FF"/>',
  loiter: '<circle cx="7" cy="7" r="5" fill="none" stroke="#f59e0b" stroke-width="1.2"/><circle cx="7" cy="7" r="1.5" fill="#f59e0b"/>',
  land: '<path d="M3,11 L11,11 M7,3 L7,9 M4,7 L7,10 L10,7" fill="none" stroke="#22c55e" stroke-width="1.2"/>',
  camera: '<rect x="2" y="4" width="10" height="7" rx="1" fill="none" stroke="#a78bfa" stroke-width="1.2"/><circle cx="7" cy="7.5" r="2" fill="none" stroke="#a78bfa" stroke-width="1"/>',
  roi: '<circle cx="7" cy="7" r="3" fill="none" stroke="#a78bfa" stroke-width="1.2"/><line x1="7" y1="1" x2="7" y2="4" stroke="#a78bfa" stroke-width="1"/><line x1="7" y1="10" x2="7" y2="13" stroke="#a78bfa" stroke-width="1"/><line x1="1" y1="7" x2="4" y2="7" stroke="#a78bfa" stroke-width="1"/><line x1="10" y1="7" x2="13" y2="7" stroke="#a78bfa" stroke-width="1"/>',
  clearRoi: '<circle cx="7" cy="7" r="3" fill="none" stroke="#666" stroke-width="1.2"/><line x1="3" y1="3" x2="11" y2="11" stroke="#ef4444" stroke-width="1.5"/>',
  home: '<path d="M2,7 L7,2 L12,7 L12,12 L2,12 Z" fill="none" stroke="#f59e0b" stroke-width="1.2"/><rect x="5" y="8" width="4" height="4" fill="none" stroke="#f59e0b" stroke-width="1"/>',
  ekf: '<circle cx="7" cy="7" r="5" fill="none" stroke="#f59e0b" stroke-width="1.2"/><line x1="7" y1="4" x2="7" y2="10" stroke="#f59e0b" stroke-width="1"/><line x1="4" y1="7" x2="10" y2="7" stroke="#f59e0b" stroke-width="1"/>',
  rally: '<polygon points="7,2 9,6 13,6 10,9 11,13 7,10.5 3,13 4,9 1,6 5,6" fill="none" stroke="#22c55e" stroke-width="1"/>',
  poi: '<circle cx="7" cy="5" r="3" fill="none" stroke="#a855f7" stroke-width="1.2"/><path d="M7,8 L7,13" stroke="#a855f7" stroke-width="1.2"/>',
  heading: '<path d="M7,2 L7,12 M4,5 L7,2 L10,5" fill="none" stroke="#3A82FF" stroke-width="1.2"/>',
  copy: '<rect x="4" y="4" width="7" height="8" rx="1" fill="none" stroke="#B4B4B4" stroke-width="1"/><rect x="3" y="2" width="7" height="8" rx="1" fill="none" stroke="#B4B4B4" stroke-width="1"/>',
  measure: '<line x1="2" y1="12" x2="12" y2="2" stroke="#B4B4B4" stroke-width="1.2"/><line x1="2" y1="12" x2="2" y2="9" stroke="#B4B4B4" stroke-width="1"/><line x1="2" y1="12" x2="5" y2="12" stroke="#B4B4B4" stroke-width="1"/>',
};

export const GUIDED_MODES = new Set(["GUIDED", "AUTO", "GUIDED_NOGPS", "LOITER"]);
