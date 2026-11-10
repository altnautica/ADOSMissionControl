"use client";

/**
 * @module use-hud-copy
 * @description The HUD target tag copy for the target resolver: the shared
 * cockpit spec text (`hud.target.*`, `follow.reacquired_toast`), with the
 * active locale's `hud.target.*` for the few words the spec does not name.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { specString } from "@/lib/cockpit/spec-strings";
import type { HudCopy } from "@/lib/hud/hud-copy";

export function useHudCopy(): HudCopy {
  const t = useTranslations("hud.target");
  return useMemo<HudCopy>(
    () => ({
      candidate: (label, pct) => specString("hud.target.candidate", { label, pct }),
      tracked: (label, id) => specString("hud.target.tracked", { label, id }),
      track: (pct) => specString("hud.target.track", { pct }),
      lock: (id, pct) => specString("hud.target.lock", { id, pct }),
      acquiring: (id) => specString("hud.target.acquiring", { id }),
      coast: (s) => specString("hud.target.coast", { s }),
      searching: () => t("searching"),
      searchingBearing: (deg) => specString("hud.target.searching_bearing", { deg }),
      lost: () => t("lost"),
      hold: (label) => specString("hud.target.hold", { label }),
      holdBare: () => t("holdBare"),
      followStale: () => specString("hud.target.follow_stale"),
      est: (m) => specString("hud.target.est", { m }),
      gt: (cls, id) => t("gt", { cls, id: String(id) }),
      uncertain: (v) => specString("hud.target.uncertain", { v }),
      reacquired: (id, sim, gap) => specString("follow.reacquired_toast", { id, sim, gap }),
    }),
    [t],
  );
}
