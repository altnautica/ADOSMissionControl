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
 * The shell owns five things and nothing else:
 *   1. the beacon rows, read once from `swarm-beacon-store`;
 *   2. the slot -> node join, so no band re-derives it and no two bands can
 *      disagree about which aircraft sits in which slot;
 *   3. the slot selection every fleet-wide action reads;
 *   4. the severity chip currently narrowing the board;
 *   5. the one hero request state the table and the video rail share.
 *
 * When the ground station feeding the board stops answering, a banner says so
 * once for the whole fleet, and silent slots read `unknown` rather than
 * `noBeacon` — a GCS-side link fault must not look like every aircraft lost.
 *
 * Every band derives everything else itself from those inputs. Prop contract
 * is identical to `CommandFleetOverview` and `NodesView`, so the switcher in
 * `app/page.tsx` treats all four views the same way.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useNodeCommandLane } from "@/components/command/nodes-view/use-node-command-lane";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";
import {
  useSwarmBeaconStore,
  selectSwarmRows,
  selectSwarmFleetSlots,
} from "@/stores/swarm-beacon-store";
import {
  SwarmSeverityStrip,
  SwarmActionBar,
  SwarmBoardTable,
  SwarmFleetMap,
  SwarmVideoRail,
  swarmSourceSilent,
  useFleetHero,
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

  const rows = useSwarmBeaconStore(selectSwarmRows);
  const fleetSlots = useSwarmBeaconStore(selectSwarmFleetSlots);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [activeFilter, setActiveFilter] = useState<SwarmSeverityId | null>(null);
  const hero = useFleetHero();
  const lastAnswerMs = useSwarmBeaconStore((s) => s.lastUpdatedMs);
  useClockTick();
  const now = useClockStore((s) => s.now);
  const sourceSilent = swarmSourceSilent(lastAnswerMs, now);

  // Slot -> node. The registry is the slot table (who the fleet has ISSUED a
  // slot to); beacons fill in who is currently HEARD. A slot present in one
  // and not the other is exactly the exception this board exists to show —
  // a registered-and-silent slot renders with `node` (once paired) and
  // `beacon: null`; a beaconing-but-unregistered slot renders with `node`
  // (once paired) and no registry entry. Resolve the registry first so a
  // silent registered slot still gets a node; a beacon slot the registry
  // does not already name fills in whatever the registry left unset.
  const nodesBySlot = useMemo(() => {
    const byDeviceId = new Map(fleetNodes.map((node) => [node.deviceId, node]));
    const out = new Map<number, FleetNodeEntry>();
    for (const slot of fleetSlots) {
      const node = slot.deviceId ? byDeviceId.get(slot.deviceId) : undefined;
      if (node) out.set(slot.slot, node);
    }
    for (const row of rows) {
      if (out.has(row.slot)) continue;
      const node = row.deviceId ? byDeviceId.get(row.deviceId) : undefined;
      if (node) out.set(row.slot, node);
    }
    return out;
  }, [fleetNodes, fleetSlots, rows]);

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

  // A fleet with registered slots and zero beacons is a total-loss
  // condition, not an empty fleet — it must render a board of `noBeacon`
  // rows, the single most important thing this board can say, rather than
  // the "pair a drone" card.
  if (rows.length === 0 && fleetSlots.length === 0) {
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
        {sourceSilent && lastAnswerMs !== null && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-warning" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-text-primary">
                {t("gsSilent.title")}
              </span>
              <span className="text-[11px] text-text-secondary">
                {t("gsSilent.body", {
                  seconds: Math.round((now - lastAnswerMs) / 1000),
                })}
              </span>
            </div>
          </div>
        )}

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
              hero={hero}
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
          hero={hero}
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
