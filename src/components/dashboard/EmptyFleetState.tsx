/**
 * @module EmptyFleetState
 * @description The first-run screen: the entire product surface when nothing
 * is paired yet.
 *
 * It answers the three questions a new operator actually has, in order, and
 * every one of them is a route forward rather than a description:
 *
 *   1. **I have no node yet** → the install one-liner (`InstallAgentStrip`).
 *   2. **I have a node on this network** → the live discovery list, or an
 *      explicit line saying the scan found nothing and what to do instead.
 *   3. **I just want to look around** → demo mode.
 *
 * What it deliberately is not: flight-controller-first. The previous screen
 * offered "Connect flight controller" as the primary action and never
 * mentioned installing the agent, never showed the agents already on the
 * network, and exposed demo mode nowhere — it was discoverable only by reading
 * package.json. A direct FC stays available as the secondary action, because a
 * board on USB is a real starting point, just not the common one.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Cpu, Plug, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { usePairDialogStore } from "@/stores/pair-dialog-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useDiscoveredAgents } from "@/hooks/use-discovered-agents";
import { DiscoveredAgentsList } from "@/components/command/disconnected/DiscoveredAgentsList";
import { InstallAgentStrip } from "@/components/command/disconnected/InstallAgentStrip";

/** The only UI entry point to demo mode. `?demo=true` is what `isDemoMode()`
 * looks for; until this existed the flag was discoverable only by reading
 * package.json. */
const DEMO_URL = "/?demo=true";

export function EmptyFleetState() {
  const t = useTranslations("emptyState");
  const tLink = useTranslations("linkUp");
  const openConnect = useConnectDialogStore((s) => s.openDialog);
  const openPairing = usePairDialogStore((s) => s.openDialog);

  // Drives the LAN mDNS scan. Running it here is the point: the agents on the
  // operator's network are visible before they are asked to type anything.
  useDiscoveredAgents();
  const discoveredAgents = usePairingStore((s) => s.discoveredAgents);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <Plug size={40} className="text-text-tertiary" />
          <div>
            <h2 className="font-display text-lg font-semibold text-text-primary">
              {t("title")}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
              {tLink("disambiguation")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="primary"
              icon={<Cpu size={14} />}
              onClick={() => openPairing("add")}
            >
              {tLink("cta.pairNode")}
            </Button>
            <Button
              variant="secondary"
              icon={<Plug size={14} />}
              onClick={openConnect}
            >
              {tLink("cta.connectFc")}
            </Button>
          </div>
        </div>

        {/* Route forward 1 — the agents already on this network. Clicking one
            hands its proven address to the pair form, which probes it
            immediately, so this is a genuinely zero-typing path. */}
        {discoveredAgents.length > 0 ? (
          <DiscoveredAgentsList
            agents={discoveredAgents}
            onSelect={(agent) => {
              const target = agent.localIp || agent.mdnsHost;
              if (!target) return;
              openPairing("add", target);
            }}
          />
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-border-default bg-bg-secondary p-3">
            <Search size={12} className="mt-0.5 shrink-0 text-text-tertiary" />
            <p className="text-[11px] leading-relaxed text-text-tertiary">
              {t("scanEmpty")}
            </p>
          </div>
        )}

        {/* Route forward 2 — install the agent on a board. */}
        <InstallAgentStrip />

        {/* Route forward 3 — demo mode. Deliberately a hard navigation, not a
            `next/link`: `isDemoMode()` reads the query string at call time, so
            a client-side push would leave every already-mounted store and
            bridge on the real path while the URL claimed otherwise. */}
        <div className="text-center">
          <button
            type="button"
            onClick={() =>
              window.location.assign(
                new URL(DEMO_URL, window.location.origin).toString(),
              )
            }
            className="text-[11px] text-text-tertiary underline decoration-dotted underline-offset-2 transition-colors hover:text-text-secondary"
          >
            {t("tryDemo")}
          </button>
        </div>

        <p className="text-center text-[10px] text-text-tertiary">
          <kbd className="border border-border-default px-1 py-0.5 font-mono">
            ⌘K
          </kbd>{" "}
          {t("commandPaletteHint")}
        </p>
      </div>
    </div>
  );
}
