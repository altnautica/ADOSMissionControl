"use client";

/**
 * @module node-detail/agent/AgentShowcase
 * @description The Agent page empty state, shown for a drone with no companion
 * computer paired. A hero + a grid of capability cards + a "Pair a computer"
 * CTA that opens the pairing dialog. A secondary link opens the flight logs
 * (which work without a companion) so nothing is lost versus the old Logs tab.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Cpu } from "lucide-react";
import { openPairNode } from "@/components/shared/link-up/link-up-actions";
import { PRIMARY_CTA_CLASS } from "@/components/onboarding/constants";
import { Button } from "@/components/ui/button";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import { AGENT_SHOWCASE_ITEMS } from "./agent-showcase-items";

export function AgentShowcase({
  droneId,
  initialShowLogs,
}: {
  droneId: string;
  /** Open straight into the flight logs. The Agent page passes this when a
   *  deep link asked for the Logs sub-page on a drone with no companion: Logs
   *  is the one page that works without one, so landing on the upsell instead
   *  would discard the request. */
  initialShowLogs?: boolean;
}) {
  const t = useTranslations("dronePanel.agentShowcase");
  const [showLogs, setShowLogs] = useState(initialShowLogs ?? false);

  if (showLogs) {
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border-default">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={14} />}
            onClick={() => setShowLogs(false)}
          >
            {t("back")}
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <LogsTab droneId={droneId} nodeDeviceId={null} showFlights />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="text-center">
          <Cpu size={32} className="mx-auto text-accent-primary" />
          <h2 className="mt-3 text-xl font-display font-semibold text-text-primary">
            {t("title")}
          </h2>
          <p className="mt-2 mx-auto max-w-md text-sm text-text-secondary leading-relaxed">
            {t("subtitle")}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={openPairNode}
              className={PRIMARY_CTA_CLASS}
            >
              {t("cta")}
            </button>
            <button
              type="button"
              onClick={() => setShowLogs(true)}
              className="text-xs font-medium text-text-secondary hover:text-accent-primary transition-colors cursor-pointer"
            >
              {t("viewLogs")} &rarr;
            </button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AGENT_SHOWCASE_ITEMS.map(({ key, icon: Icon }) => (
            <div
              key={key}
              className="border border-border-default bg-bg-secondary rounded-lg p-4"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent-primary/10 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-accent-primary" />
                </div>
                <p className="text-sm font-medium text-text-primary">
                  {t(`cards.${key}.title`)}
                </p>
              </div>
              <p className="mt-2 text-[11px] text-text-tertiary leading-relaxed">
                {t(`cards.${key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
