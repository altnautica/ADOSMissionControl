"use client";

/**
 * @module command/swarm-view/SwarmConditionsCell
 * @description The four beacon status bits, as four separate glyphs.
 *
 * Never blended into one colour. Armed, guided, emergency and GPS are
 * independent conditions — the Kubernetes node-condition precedent — and a
 * single "health" swatch mixing them destroys exactly the distinction an
 * operator acts on: "armed but GPS-denied" and "disarmed with a good fix" are
 * not two shades of the same thing.
 *
 * Each glyph keeps its slot whether or not its condition is set, so the four
 * columns line up down the whole table and the eye can scan one condition
 * vertically instead of re-reading every row. Colour is never the only channel:
 * every glyph carries its state in its accessible label.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Bot, Power, Satellite } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  UnknownValue,
  staleClass,
  type ReadingFreshness,
} from "@/components/command/nodes-view/cell-primitives";
import type { SwarmSlotRow } from "./swarm-rows";

/**
 * One condition, one glyph. The two tones say what each truth is worth: an
 * emergency is red when set and nearly invisible when clear, while GPS is green
 * when good and amber when not — a missing fix is a live problem, a missing
 * emergency is the normal case.
 */
function ConditionGlyph({
  icon,
  on,
  onTone,
  offTone,
  label,
}: {
  icon: ReactNode;
  on: boolean;
  onTone: string;
  offTone: string;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex", on ? onTone : offTone)}
    >
      {icon}
    </span>
  );
}

export function ConditionsCell({
  row,
  freshness,
}: {
  row: SwarmSlotRow;
  freshness: ReadingFreshness;
}) {
  const t = useTranslations("swarmView.condition");
  const beacon = row.beacon;

  if (!beacon) return <UnknownValue title={t("noBeacon")} />;

  return (
    <span className={cn("flex items-center gap-1.5", staleClass(freshness))}>
      <ConditionGlyph
        icon={<Power size={12} />}
        on={beacon.armed}
        onTone="text-status-success"
        offTone="text-text-tertiary"
        label={beacon.armed ? t("armed") : t("disarmed")}
      />
      <ConditionGlyph
        icon={<Bot size={12} />}
        on={beacon.guided}
        onTone="text-accent-primary"
        offTone="text-text-tertiary"
        label={beacon.guided ? t("guided") : t("notGuided")}
      />
      <ConditionGlyph
        icon={<Satellite size={12} />}
        on={beacon.gpsOk}
        onTone="text-status-success"
        offTone="text-status-warning"
        label={beacon.gpsOk ? t("gpsOk") : t("gpsDenied")}
      />
      <ConditionGlyph
        icon={<AlertTriangle size={12} />}
        on={beacon.emergency}
        onTone="text-status-error"
        offTone="text-text-tertiary/30"
        label={beacon.emergency ? t("emergency") : t("noEmergency")}
      />
    </span>
  );
}
