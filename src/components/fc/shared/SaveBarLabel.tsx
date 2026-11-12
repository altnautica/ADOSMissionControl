"use client";

/**
 * Localized text for the save / flash / revert bar every parameter panel
 * renders, so the shared wording lives once under `panelCommit.bar.*`.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

export type SaveBarLabelKey =
  | "saveToFc"
  | "saveToRam"
  | "writeToFlash"
  | "revert"
  | "connectToSave"
  | "unsavedChanges";

export function SaveBarLabel({ k }: { k: SaveBarLabelKey }) {
  const t = useTranslations("panelCommit.bar");
  return <>{t(k)}</>;
}
