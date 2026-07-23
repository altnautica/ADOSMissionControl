"use client";

/**
 * @module command/nodes-view/MeshReachPanel
 * @description The board's right-hand mesh column: the live reach graph, under a
 * header that collapses it.
 *
 * It resolves the visible rows into reach inputs once (the same reach + bearer
 * facts the table's Reach column reads) and feeds the graph, so the map mirrors
 * the table rather than deriving the fleet's wiring a second, divergent way. The
 * graph is supplementary — the table carries every fact it draws — so it can be
 * collapsed to hand the table more room without losing any information.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Network } from "lucide-react";

import type { NodeRowModel } from "@/lib/nodes/node-rows";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import { buildMeshGraph } from "@/lib/nodes/mesh-graph";
import { useMeshInputs } from "./use-mesh-inputs";
import { MeshReachMap } from "./MeshReachMap";
import { RelayStreamsList } from "./RelayStreamsList";

export function MeshReachPanel({
  rows,
  laneOptions,
}: {
  rows: readonly NodeRowModel[];
  laneOptions: NodeCommandSinkOptions;
}) {
  const t = useTranslations("nodesView.meshMap");
  const [open, setOpen] = useState(true);

  const inputs = useMeshInputs(rows, laneOptions);
  const graph = useMemo(() => buildMeshGraph(inputs), [inputs]);

  return (
    <aside className="shrink-0 rounded-lg border border-border-default bg-bg-secondary lg:w-[344px]">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <Network size={13} className="text-text-tertiary" />
          {t("title")}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {open ? t("collapse") : t("expand")}
        </button>
      </div>

      {open && (
        <div className="p-3">
          <MeshReachMap graph={graph} />
          <RelayStreamsList graph={graph} />
        </div>
      )}
    </aside>
  );
}
