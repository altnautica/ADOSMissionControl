"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Terminal, Route, Play, Radar, History, Crosshair } from "lucide-react";
import { cn, isBattleNet } from "@/lib/utils";

const baseTabs = [
  { icon: LayoutDashboard, labelKey: "dashboard", href: "/" },
  { icon: Terminal, labelKey: "command", href: "/command" },
  { icon: Route, labelKey: "plan", href: "/plan" },
  { icon: Play, labelKey: "simulate", href: "/simulate" },
  { icon: Radar, labelKey: "airTraffic", href: "/air-traffic" },
  { icon: History, labelKey: "history", href: "/history" },
];

const defenseTabs = isBattleNet()
  ? [{ icon: Crosshair, labelKey: "tactical", href: "/tactical" }]
  : [];

const tabs = [...baseTabs.slice(0, 3), ...defenseTabs, ...baseTabs.slice(3)];

export function CommandNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex items-center gap-1">
      {tabs.map(({ icon: Icon, labelKey, href }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
              active
                ? "text-accent-primary border-b-2 border-accent-primary"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Icon size={14} />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
