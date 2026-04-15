"use client";

/**
 * @module HardwareControllersPage
 * @description Phase 4 Track A (Wave 2) Controllers sub-view. Browser-side
 * Web Gamepad API surface: live axis bars, calibration wizard, dead zone,
 * expo curve, and active-controller status. Migrated from /config/input.
 * @license GPL-3.0-only
 */

import Link from "next/link";
import { useTranslations } from "next-intl";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { ControllersSection } from "@/components/hardware/ControllersSection";

export default function HardwareControllersPage() {
  const t = useTranslations("hardware");

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <Link href="/hardware" className="hover:text-text-primary transition-colors">
            {t("overview")}
          </Link>
          <span>/</span>
          <span>{t("controllers")}</span>
        </div>
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">{t("controllers")}</h1>

        <HardwareTabs />

        <ControllersSection />
      </div>
    </div>
  );
}
