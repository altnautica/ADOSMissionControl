/**
 * @module cockpit/follow-rail-layout
 * @description How the follow rail fits its strip. The rail shares one row
 * with the range readout, which keeps at least {@link RANGE_MIN_PX} so it can
 * always be opened. When the row is too narrow, the rail gives way in order:
 * first the quick settings (STRICT | SMART, FOLLOW | HOLD, predictive search)
 * fold behind a More button that opens them as a sheet, then every button
 * drops its word and shows its icon only (the word stays its accessible
 * name). The follow button, the camera swap and REC are never folded, the
 * same priority the agent cockpit's rail keeps. DOM-free, sized from the CSS
 * minimums in `globals.css` (`.frail`, `.reacq`, `.fs-follow`), so the rule
 * is unit-tested.
 *
 * @license GPL-3.0-only
 */

/** The rail's buttons that are never folded, in order. */
export type FollowRailButton = "follow" | "camSwap" | "rec";

/** The quick settings, which fold first. */
export type FollowRailSetting = "reacquire_mode" | "uncertain_mode" | "predictive_search";

/** The range readout's least width beside the rail: the range figure, with
 *  the phase word once there is room (`.fs-follow-range` container rules). */
export const RANGE_MIN_PX = 112;
/** Rail button edge (`--rail-btn`); also an icon-only button's width. */
export const RAIL_BTN_PX = 48;
/** Gap between rail items (`.frail`). */
export const RAIL_GAP_PX = 6;
/** The dock's gap between the rail and the readout, plus its side padding. */
const DOCK_CHROME_PX = 8 + 2 * 4;
/** A worded button's padding, border, icon and icon gap (`.frail-btn`). */
const WORD_BTN_CHROME_PX = 2 * 10 + 2 + 16 + 6;
/** An upper-case label character at the label size, with its tracking. */
const WORD_CHAR_PX = 8.5;
/** A two-option segment: two 48 px options, their gap, padding and border (`.reacq`). */
const SEGMENT_PX = 2 * RAIL_BTN_PX + 2 + 2 * 3 + 2;
/** The predictive switch's padding and border around its mono label. */
const SWITCH_CHROME_PX = 2 * 6 + 2 * 3 + 2;
/** A mono label character at 9.5 px, with its tracking. */
const SWITCH_CHAR_PX = 7;

export interface FollowRailInput {
  /** The strip's width, or null where the rail has the row to itself. */
  stripW: number | null;
  /** The never-folded buttons with their words. */
  buttons: readonly { id: FollowRailButton; word: string }[];
  /** The quick settings shown, in order. */
  settings: readonly FollowRailSetting[];
  /** The predictive switch's label. */
  predictiveWord: string;
  /** The More button's word. */
  moreWord: string;
}

export interface FollowRailLayout {
  /** The quick settings sit behind More, in a sheet. */
  foldSettings: boolean;
  /** Buttons show their icon only. */
  iconOnly: boolean;
}

function buttonPx(word: string, iconOnly: boolean): number {
  if (iconOnly) return RAIL_BTN_PX;
  return Math.max(RAIL_BTN_PX, WORD_BTN_CHROME_PX + [...word].length * WORD_CHAR_PX);
}

/** The rail's width for a layout. */
export function followRailWidth(i: FollowRailInput, layout: FollowRailLayout): number {
  const widths = i.buttons.map((b) => buttonPx(b.word, layout.iconOnly));
  if (layout.foldSettings) {
    if (i.settings.length > 0) widths.push(buttonPx(i.moreWord, layout.iconOnly));
  } else {
    for (const s of i.settings) {
      widths.push(s === "predictive_search" ? SWITCH_CHROME_PX + [...i.predictiveWord].length * SWITCH_CHAR_PX : SEGMENT_PX);
    }
  }
  if (widths.length === 0) return 0;
  return widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * RAIL_GAP_PX;
}

/** The roomiest layout that leaves the readout its least width. */
export function followRailLayout(i: FollowRailInput): FollowRailLayout {
  const full = { foldSettings: false, iconOnly: false };
  if (i.stripW === null) return full;
  const room = i.stripW - DOCK_CHROME_PX - RANGE_MIN_PX;
  const steps: FollowRailLayout[] = [full, { foldSettings: true, iconOnly: false }, { foldSettings: true, iconOnly: true }];
  return steps.find((l) => followRailWidth(i, l) <= room) ?? steps[steps.length - 1];
}
