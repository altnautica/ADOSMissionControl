"use client";

/**
 * The shell's navigation and header links, folded into one menu button below
 * the `md` breakpoint where the full top bar does not fit.
 *
 * @license GPL-3.0-only
 */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { openCommandPalette } from "@/lib/command-palette-open";
import { SHELL_NAV_TABS } from "./shell-nav-tabs";

const EXTERNAL: Record<string, string> = {
  docs: "https://docs.altnautica.com",
  starOnGitHub: "https://github.com/altnautica/ADOSMissionControl",
  joinDiscord: "https://discord.gg/uxbvuD4d5q",
};

export function ShellCompactMenu() {
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const router = useRouter();

  const items = [
    ...SHELL_NAV_TABS.map((tab) => ({ id: `nav:${tab.href}`, label: tNav(tab.labelKey) })),
    { id: "div-1", label: "", divider: true },
    { id: "palette", label: t("commandPalette") },
    { id: "route:/config", label: t("settings") },
    { id: "route:/config/firmware", label: t("flashTool") },
    { id: "div-2", label: "", divider: true },
    { id: "docs", label: t("docs") },
    { id: "starOnGitHub", label: t("starOnGitHub") },
    { id: "joinDiscord", label: t("joinDiscord") },
  ];

  const onSelect = (id: string) => {
    if (id === "palette") return openCommandPalette();
    if (id.startsWith("nav:")) return router.push(id.slice(4));
    if (id.startsWith("route:")) return router.push(id.slice(6));
    const url = EXTERNAL[id];
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <DropdownMenu
      align="right"
      items={items}
      onSelect={onSelect}
      trigger={
        <button
          type="button"
          aria-label={t("menu")}
          className="flex items-center text-text-secondary hover:text-text-primary transition-colors"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
      }
    />
  );
}
