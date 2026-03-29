"use client";

import { useTranslations } from "next-intl";
import { OfflineMapManager } from "./OfflineMapManager";

export function DataSection() {
  const t = useTranslations("data");

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>
      <OfflineMapManager />
    </div>
  );
}
