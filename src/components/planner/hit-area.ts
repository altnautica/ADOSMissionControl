/**
 * @module planner/hit-area
 * @description Pointer hit areas larger than a small control's drawn size,
 * as a transparent `::after` box, so an icon button stays compact on screen
 * and is still easy to hit with a finger or a stylus.
 * @license GPL-3.0-only
 */

/** A 48 × 48 px hit area centred on the control. */
export const HIT_AREA_48 =
  "relative after:absolute after:left-1/2 after:top-1/2 after:h-12 after:w-12 after:-translate-x-1/2 after:-translate-y-1/2";
