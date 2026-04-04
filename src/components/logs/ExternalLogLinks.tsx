"use client";

/**
 * @module ExternalLogLinks
 * @description Links to external ArduPilot log analysis tools.
 * Opens in new tabs.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

const LINKS = [
  {
    name: "ArduPilot Log Plotter",
    url: "https://plot.ardupilot.org",
    descriptionKey: "plotterDescription",
  },
  {
    name: "ArduPilot Log Reviewer",
    url: "https://review.ardupilot.org",
    descriptionKey: "reviewerDescription",
  },
] as const;

export function ExternalLogLinks() {
  const t = useTranslations("logs.externalAnalysis");

  return (
    <div className="border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center gap-2 mb-2">
        <ExternalLink size={12} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          {t("title")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {LINKS.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-mono border border-border-default bg-bg-tertiary/30 hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors rounded"
          >
            <ExternalLink size={10} />
            <div>
              <div className="font-semibold">{link.name}</div>
              <div className="text-text-tertiary text-[9px]">
                {t(link.descriptionKey)}
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
