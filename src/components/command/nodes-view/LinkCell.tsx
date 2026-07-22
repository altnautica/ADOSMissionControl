"use client";

/**
 * @module command/nodes-view/LinkCell
 * @description The radio link column.
 *
 * The verdict shown is the agent's own link diagnosis — the reading that says
 * WHY a link is or is not carrying payload — not a verdict this board invents
 * from a signal number. When the agent reports no verdict the cell falls back
 * to the coarse link state, and when it reports neither the cell says so; a
 * link that cannot be diagnosed must never render as healthy.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Radio as RadioIcon } from "lucide-react";

import type { RadioState } from "@/lib/api/ground-station/types";
import {
  linkDiagBadgeClass,
  linkDiagLabel,
  linkStateBadgeClass,
  linkStateLabel,
} from "@/components/hardware/radio/labels";
import { cn } from "@/lib/utils";
import {
  Chip,
  UnknownValue,
  staleClass,
  type ReadingFreshness,
} from "./cell-primitives";

export function LinkCell({
  radio,
  freshness,
}: {
  radio: RadioState | null;
  freshness: ReadingFreshness;
}) {
  const tNodes = useTranslations("nodesView");
  const tRadio = useTranslations("hardware.radio");

  if (freshness === "none") {
    return <UnknownValue title={tNodes("noLiveReading")} />;
  }
  if (!radio) {
    return <UnknownValue title={tNodes("link.noRadio")} />;
  }

  const diag = radio.linkDiag;

  return (
    <span className={cn("inline-flex items-center gap-1.5", staleClass(freshness))}>
      {diag != null ? (
        <Chip className={linkDiagBadgeClass(diag)} title={tRadio("linkDiag.label")}>
          <RadioIcon size={10} />
          {linkDiagLabel(tRadio, diag)}
        </Chip>
      ) : (
        // No diagnosis, so the coarse state is all there is. It still carries
        // its own colour: a transmitting-but-unproven link rendered neutral
        // would sit on the board looking as unremarkable as an idle one.
        <Chip
          className={linkStateBadgeClass(radio.state)}
          title={tNodes("link.noVerdict")}
        >
          <RadioIcon size={10} />
          {linkStateLabel(tRadio, radio.state)}
        </Chip>
      )}
      {radio.rssiDbm != null && (
        <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
          {radio.rssiDbm} dBm
        </span>
      )}
    </span>
  );
}
