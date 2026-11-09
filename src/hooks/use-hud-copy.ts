"use client";

/**
 * @module use-hud-copy
 * @description The HUD target tag copy bound to the active locale
 * (`hud.target.*`, `hud.toast.reacquired`), for the target resolver.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { HudCopy } from "@/lib/hud/hud-copy";

export function useHudCopy(): HudCopy {
  const t = useTranslations("hud");
  return useMemo<HudCopy>(
    () => ({
      candidate: (cls, pct) => t("target.candidate", { cls, pct: String(pct) }),
      tracked: (cls, id) => t("target.tracked", { cls, id: String(id) }),
      track: (pct) => t("target.track", { pct: String(pct) }),
      lock: (id, pct) => t("target.lock", { id: String(id), pct: String(pct) }),
      acquiring: (id) => t("target.acquiring", { id: String(id) }),
      coast: (s) => t("target.coast", { s }),
      searching: () => t("target.searching"),
      searchingBearing: (deg) => t("target.searchingBearing", { deg }),
      lost: () => t("target.lost"),
      hold: (reason) => t("target.hold", { reason }),
      holdBare: () => t("target.holdBare"),
      followStale: () => t("target.followStale"),
      est: (range) => t("target.est", { range }),
      gt: (cls, id) => t("target.gt", { cls, id: String(id) }),
      uncertain: (tag) => t("target.uncertain", { tag }),
      reacquired: (id, sim, gap) => t("toast.reacquired", { id: String(id), sim, gap }),
    }),
    [t],
  );
}
