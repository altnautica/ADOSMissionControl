"use client";

/**
 * @module command/nodes-view/RelayStreamsList
 * @description The map's text equivalent: each relay funnel named end to end,
 * hop by hop, below the graph.
 *
 * The graph shows the fleet's wiring as vertices and edges; this reads the same
 * edges back into sentences — "Drone-D over WFB to GS-A, then to GCS" — so an
 * operator (and, through a per-stream accessible description, a screen reader)
 * can read what the map draws without parsing an SVG. It is built from the very
 * graph the map draws, so the two can never disagree about a node's path.
 *
 * Honesty is drawn, not just stored (Rule 44 / Rule 37): a stream is labelled
 * "Live" and its dot animates a pulse only when every hop is verified — a
 * received-side frame heard on each leg — and never under a reduced-motion
 * preference. A stream with an unverified, stale, or down hop reads as exactly
 * that, its state the weakest leg, never a confident "Live".
 *
 * @license GPL-3.0-only
 */

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Waypoints } from "lucide-react";

import { MESH_GCS_ID, type MeshGraph } from "@/lib/nodes/mesh-graph";
import type { BearerVerification } from "@/lib/nodes/node-bearer";
import {
  buildRelayStreams,
  type RelayHop,
  type RelayStream,
} from "@/lib/nodes/relay-streams";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

/** The dot / badge colour for a stream's overall state. Live is the only green;
 * a weaker state keeps an honest, dimmer colour. */
const STATE_TONE: Record<"live" | BearerVerification, string> = {
  live: "text-status-success",
  verified: "text-status-success",
  stale: "text-status-warning",
  unverified: "text-text-tertiary",
  down: "text-text-tertiary",
};

/** How much a relay hop's bearer label survives its verification, so an
 * unverified or dead leg reads dimmer than a proven one. */
const HOP_TONE: Record<BearerVerification, string> = {
  verified: "text-text-secondary",
  unverified: "text-text-tertiary opacity-70",
  stale: "text-status-warning",
  down: "text-text-tertiary opacity-50",
};

export function RelayStreamsList({ graph }: { graph: MeshGraph }) {
  const t = useTranslations("nodesView.meshMap.relayStreams");
  const tMap = useTranslations("nodesView.meshMap");
  const tBearer = useTranslations("nodesView.meshMap.bearer");
  const reducedMotion = usePrefersReducedMotion();
  const streams = useMemo(() => buildRelayStreams(graph), [graph]);

  /** The GCS sink is localised; an off-view relay parent is named as such (so a
   * funnel that stops at a filtered-out ground node never reads as a direct WFB
   * link to the GCS, Rule 44); every other vertex uses its own name. */
  const displayName = (id: string, fallback: string) =>
    id === MESH_GCS_ID ? t("sink") : fallback;
  const terminalLabel = (hop: RelayHop): string => {
    if (hop.toId === MESH_GCS_ID) return t("sink");
    if (hop.toKind === "offview") {
      return hop.toName ? tMap("offViewNode", { name: hop.toName }) : tMap("offViewRelay");
    }
    return hop.toName;
  };

  /** One coherent sentence per stream, so a screen reader reads the whole path
   * rather than a scatter of chips and arrow glyphs. */
  const streamSentence = (stream: RelayStream): string => {
    const parts = [
      displayName(stream.hops[0]?.fromId ?? stream.id, stream.leafName),
    ];
    for (const hop of stream.hops) {
      const node = terminalLabel(hop);
      parts.push(
        hop.style === "relay"
          ? t("hopRelay", { bearer: tBearer(hop.bearer), node })
          : t("hopData", { node }),
      );
    }
    const state = t(`state.${stream.live ? "live" : stream.worst}`);
    return t("streamAria", { path: parts.join(", "), state });
  };

  const stateOf = (stream: RelayStream): "live" | BearerVerification =>
    stream.live ? "live" : stream.worst;

  return (
    <div className="mt-3 border-t border-border-default pt-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary">
        <Waypoints size={12} className="text-text-tertiary" />
        {t("heading")}
      </h4>

      {streams.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={t("heading")}>
          {streams.map((stream) => {
            const state = stateOf(stream);
            return (
              <li
                key={stream.id}
                data-stream={stream.id}
                data-live={stream.live ? "true" : undefined}
                data-worst={stream.worst}
                className="text-[11px] leading-relaxed"
              >
                <span className="sr-only">{streamSentence(stream)}</span>
                <span
                  aria-hidden="true"
                  className="flex flex-wrap items-center gap-x-1 gap-y-0.5"
                >
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current",
                      STATE_TONE[state],
                      stream.live && !reducedMotion && "relay-live-pulse",
                    )}
                  />
                  {pathChips(stream, displayName, terminalLabel, tBearer)}
                  <span
                    className={cn(
                      "ml-0.5 text-[9px] font-medium uppercase tracking-wide",
                      STATE_TONE[state],
                    )}
                  >
                    {t(`state.${state}`)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The visible chips: each node's name, a labelled bearer arrow for a relay hop
 * and a plain arrow for the final reaches-home leg, ending at the sink. */
function pathChips(
  stream: RelayStream,
  displayName: (id: string, fallback: string) => string,
  terminalLabel: (hop: RelayHop) => string,
  tBearer: (key: string) => string,
): ReactNode[] {
  const out: ReactNode[] = [];
  stream.hops.forEach((hop, i) => {
    out.push(
      <NodeChip
        key={`${stream.id}-n${i}`}
        label={displayName(hop.fromId, hop.fromName)}
      />,
    );
    out.push(<Connector key={`${stream.id}-c${i}`} hop={hop} tBearer={tBearer} />);
  });
  const last = stream.hops[stream.hops.length - 1];
  if (last) {
    out.push(
      <NodeChip
        key={`${stream.id}-sink`}
        label={terminalLabel(last)}
        sink={last.toId === MESH_GCS_ID}
      />,
    );
  }
  return out;
}

function NodeChip({ label, sink }: { label: string; sink?: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 font-mono text-[10px]",
        sink
          ? "bg-accent-primary/10 text-accent-secondary"
          : "bg-bg-tertiary text-text-secondary",
      )}
    >
      {label}
    </span>
  );
}

/** A relay hop shows its bearer between the nodes; a data hop is the plain
 * reaches-home arrow (the GCS link, not a relay leg). */
function Connector({
  hop,
  tBearer,
}: {
  hop: RelayHop;
  tBearer: (key: string) => string;
}) {
  if (hop.style !== "relay") {
    return <span className="text-text-tertiary">→</span>;
  }
  return (
    <span className={cn("font-mono", HOP_TONE[hop.verification])}>
      —{tBearer(hop.bearer)}→
    </span>
  );
}
