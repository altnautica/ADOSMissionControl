"use client";

/**
 * @module RequirementsFooter
 * @description Alpha disclaimer banner, system requirements summary, and
 * GitHub link shown at the bottom of the disconnected page.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowUpRight, Cpu } from "lucide-react";

export function RequirementsFooter() {
  const t = useTranslations("disconnectedPage");

  return (
    <>
      {/* Alpha Disclaimer */}
      <div className="flex items-start gap-3 p-4 bg-status-warning/5 border border-status-warning/20 rounded">
        <AlertTriangle
          size={16}
          className="text-status-warning shrink-0 mt-0.5"
        />
        <p className="text-sm text-status-warning/80 leading-relaxed">
          {t("alphaDisclaimer")}
        </p>
      </div>

      {/* Requirements */}
      <div className="text-center space-y-3">
        <h2 className="text-base font-medium text-text-primary">
          {t("requirements")}
        </h2>
        <div className="inline-flex items-center gap-4 text-sm text-text-tertiary">
          <span className="flex items-center gap-1.5">
            <Cpu size={12} />
            Python 3.11+
          </span>
          <span className="text-border-default">|</span>
          <span>Linux (Raspberry Pi OS recommended)</span>
          <span className="text-border-default">|</span>
          <span>ArduPilot or PX4 flight controller</span>
        </div>
      </div>

      {/* GitHub link */}
      <div className="text-center pb-6">
        <a
          href="https://github.com/altnautica/ADOSDroneAgent"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-text-primary bg-bg-tertiary border border-border-default rounded hover:bg-bg-secondary transition-colors"
        >
          {t("viewOnGitHub")}
          <ArrowUpRight size={12} />
        </a>
      </div>
    </>
  );
}
