"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutDashboard, Terminal, Cable, Route, Play, Radar, History } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { icon: LayoutDashboard, labelKey: "dashboard", href: "/" },
  { icon: Terminal, labelKey: "command", href: "/command" },
  { icon: Route, labelKey: "plan", href: "/plan" },
  { icon: Play, labelKey: "simulate", href: "/simulate" },
  { icon: Radar, labelKey: "airTraffic", href: "/airspace" },
  { icon: History, labelKey: "history", href: "/history" },
  { icon: Cable, labelKey: "hardware", href: "/hardware" },
];

export function CommandNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex items-stretch gap-1 h-full">
      {tabs.map(({ icon: Icon, labelKey, href }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 px-3 text-xs font-medium transition-colors -mb-px border-b-2",
              active
                ? "text-accent-primary border-accent-primary"
                : "text-text-secondary hover:text-text-primary border-transparent"
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
