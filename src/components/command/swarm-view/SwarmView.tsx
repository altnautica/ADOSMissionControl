"use client";

/**
 * @module command/swarm-view/SwarmView
 * @description The fleet-wide Swarm board — the Dashboard's fourth view mode.
 *
 * The grid answers "how is this node doing?", the nodes board answers "how is
 * each node doing?". This board answers the only question that scales to
 * twenty-four aircraft: "which ones need me?" Bands stack summary → exception
 * → detail, and a quiet fleet renders no chips at all: twenty healthy slots
 * must visually disappear, because a dashboard full of green is as hard to
 * read as one full of red.
 *
 * The shell owns four things and nothing else:
 *   1. the beacon rows, read once from `swarm-beacon-store`;
 *   2. the slot -> node join, so no band re-derives it and no two bands can
 *      disagree about which aircraft sits in which slot;
 *   3. the slot selection every fleet-wide action reads;
 *   4. the severity chip currently narrowing the board.
 *
 * Every band derives everything else itself from those inputs. Prop contract
 * is identical to `CommandFleetOverview` and `NodesView`, so the switcher in
 * `app/page.tsx` treats all four views the same way.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useSkillToastBridge } from "@/hooks/use-skill-toast-bridge";
import { useNodeCommandLane } from "@/components/command/nodes-view/use-node-command-lane";
import {
  useSwarmBeaconStore,
  selectSwarmRows,
} from "@/stores/swarm-beacon-store";
import {
  SwarmSeverityStrip,
  SwarmActionBar,
  SwarmBoardTable,
  SwarmFleetMap,
  SwarmVideoRail,
  type SwarmSeverityId,
} from ".";

export interface SwarmViewProps {
  fleetNodes: FleetNodeEntry[];
  /** Opens a node's detail panel. Takes the agent device id, as the grid does. */
  onOpenAgent: (deviceId: string) => void;
  /** Opens the shared add-a-node dialog. */
  onOpenPairing: () => void;
}

export function SwarmView({
  fleetNodes,
  onOpenAgent,
  onOpenPairing,
}: SwarmViewProps) {
  const t = useTranslations("swarmView");
  const laneOptions = useNodeCommandLane();
  // A refused fleet command has to say why. The dispatcher answers with raw
  // keys, so without this bridge every refusal on this board would be silent.
  useSkillToastBridge();

  const rows = useSwarmBeaconStore(selectSwarmRows);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [activeFilter, setActiveFilter] = useState<SwarmSeverityId | null>(null);

  // Slot -> node, joined on the beacon's device id. A slot whose device id the
  // ground station could not resolve simply has no node — it still renders,
  // because an unidentified aircraft on the bus is exactly the thing an
  // operator must be able to see.
  //
  // KNOWN GAP, not a bug in the severity strip: this map is derived FROM the
  // beacons, so a slot the fleet registered but never heard from cannot appear
  // in it, and the strip's `noBeacon` chip therefore reads a permanent 0. The
  // GCS has no registered-slot source today — `FleetNodeEntry` and
  // `LinkedPeer` both carry a device id and no slot, and this shell's only
  // feed is `/api/swarm/neighbors`, which reports heard neighbours by
  // definition. `buildSwarmSlotRows` already unions registered slots over
  // heard ones, so the chip starts working the day a slot table exists (the
  // ground station's `FleetRegistry`, surfaced through the pair-status route,
  // is the intended source) with no change to the strip.
  const nodesBySlot = useMemo(() => {
    const byDeviceId = new Map(fleetNodes.map((node) => [node.deviceId, node]));
    const out = new Map<number, FleetNodeEntry>();
    for (const row of rows) {
      const node = row.deviceId ? byDeviceId.get(row.deviceId) : undefined;
      if (node) out.set(row.slot, node);
    }
    return out;
  }, [fleetNodes, rows]);

  function toggleSlot(slot: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

  // Header-checkbox and marquee semantics differ: the header adds or removes
  // exactly the slots it was handed, leaving a selection made elsewhere alone;
  // a marquee drag REPLACES the selection, which is what a drag means.
  function toggleAll(slots: readonly number[], selectAll: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const slot of slots) {
        if (selectAll) next.add(slot);
        else next.delete(slot);
      }
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-3 md:p-4">
        <SwarmHeader title={t("title")} subtitle={t("subtitle")} />
        <div className="rounded-md border border-dashed border-border-default p-6 text-center">
          <p className="text-sm text-text-primary">{t("empty.title")}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-text-tertiary">
            {t("empty.body")}
          </p>
          <button
            type="button"
            onClick={onOpenPairing}
            className="mt-3 rounded border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            {t("empty.action")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <SwarmHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex flex-col gap-3">
        <SwarmSeverityStrip
          rows={rows}
          nodesBySlot={nodesBySlot}
          active={activeFilter}
          onToggle={(id) =>
            setActiveFilter((prev) => (prev === id ? null : id))
          }
        />

        <SwarmActionBar
          rows={rows}
          nodesBySlot={nodesBySlot}
          selectedSlots={selected}
          laneOptions={laneOptions}
          onClear={() => setSelected(new Set())}
        />

        <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <SwarmBoardTable
              rows={rows}
              nodesBySlot={nodesBySlot}
              selected={selected}
              onToggleSlot={toggleSlot}
              onToggleAll={toggleAll}
              onOpenAgent={onOpenAgent}
              laneOptions={laneOptions}
              activeFilter={activeFilter}
            />
          </div>

          <SwarmFleetMap
            rows={rows}
            nodesBySlot={nodesBySlot}
            selected={selected}
            onSelectSlots={(slots) => setSelected(new Set(slots))}
          />
        </div>

        <SwarmVideoRail
          rows={rows}
          nodesBySlot={nodesBySlot}
          onOpenAgent={onOpenAgent}
        />
      </div>
    </div>
  );
}

function SwarmHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
      <p className="text-xs text-text-tertiary">{subtitle}</p>
    </div>
  );
}
