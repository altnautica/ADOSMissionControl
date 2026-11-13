"use client";

/**
 * @module dashboard/FleetDrawerButton
 * @description Opens the fleet sidebar as a drawer below md, where the
 * dashboard hides the sidebar so the node detail or the fleet views get the
 * full width. Never rendered from md up, where the sidebar is always shown.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { PanelLeftOpen } from "lucide-react";

export function FleetDrawerButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useTranslations("fleet");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      title={t("expandPanel")}
      data-testid="fleet-drawer-open"
      className="md:hidden flex h-9 shrink-0 items-center gap-1.5 rounded-[4px] px-2 text-xs font-medium text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
    >
      <PanelLeftOpen size={14} aria-hidden="true" />
      {t("title")}
    </button>
  );
}
