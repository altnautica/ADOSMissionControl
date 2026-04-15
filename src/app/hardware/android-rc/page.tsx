"use client";

/**
 * @module HardwareAndroidRcPage
 * @description Phase 4 Wave 3 stub. Placeholder for the ADOS Android RC
 * handheld controller panel. Lights up when the product ships
 * (DEC-090/091/092).
 * @license GPL-3.0-only
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";

export default function HardwareAndroidRcPage() {
  const t = useTranslations("hardware");

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <Link
            href="/hardware"
            className="hover:text-text-primary transition-colors"
          >
            {t("overview")}
          </Link>
          <span>/</span>
          <span>{t("androidRc.title")}</span>
        </div>
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">
          {t("androidRc.title")}
        </h1>

        <HardwareTabs />

        <div className="rounded border border-border-primary bg-surface-secondary px-6 py-10">
          <div className="mb-4 inline-flex rounded bg-accent-primary/10 px-2 py-1 text-xs text-accent-primary">
            {t("androidRc.stubBadge")}
          </div>
          <h2 className="mb-3 text-xl font-semibold text-text-primary">
            {t("androidRc.stubHeading")}
          </h2>
          <p className="mb-4 max-w-2xl text-sm text-text-secondary">
            {t("androidRc.stubBody")}
          </p>
        </div>
      </div>
    </div>
  );
}
