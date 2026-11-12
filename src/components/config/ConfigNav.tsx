"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  Settings,
  Gamepad2,
  Video,
  Bell,
  Palette,
  Database,
  Zap,
  User,
  Puzzle,
  Network,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  labelKey: string;
  icon: ReactNode;
}

const GCS_NAV_ITEMS: NavItem[] = [
  { href: "/config", labelKey: "general", icon: <Settings size={14} /> },
  { href: "/config/operator", labelKey: "operator", icon: <User size={14} /> },
  { href: "/config/input", labelKey: "inputDevices", icon: <Gamepad2 size={14} /> },
  { href: "/config/aircraft-setup", labelKey: "aircraftSetup", icon: <Wrench size={14} /> },
  // `/config/can` shipped as a route with no entry here, so the only way in was
  // to type the URL — while `canConfig.slcanHint` tells the operator to
  // "Configure SLCAN via /config/can".
  { href: "/config/can", labelKey: "can", icon: <Network size={14} /> },
  { href: "/config/video", labelKey: "video", icon: <Video size={14} /> },
  { href: "/config/notifications", labelKey: "notifications", icon: <Bell size={14} /> },
  { href: "/config/theme", labelKey: "theme", icon: <Palette size={14} /> },
  { href: "/config/data", labelKey: "data", icon: <Database size={14} /> },
  { href: "/config/firmware", labelKey: "firmware", icon: <Zap size={14} /> },
  { href: "/config/plugins", labelKey: "plugins", icon: <Puzzle size={14} /> },
];

export function ConfigNav() {
  const pathname = usePathname();
  const t = useTranslations("configNav");

  return (
    // Below md the nav is a horizontal tab strip above the content, so the
    // page gets the full width on a phone; from md up it is the side column.
    <nav
      aria-label={t("title")}
      className="w-full md:w-[200px] border-b md:border-b-0 md:border-r border-border-default bg-bg-secondary flex-shrink-0 overflow-x-auto md:overflow-x-visible md:overflow-y-auto"
    >
      <div className="hidden md:block px-3 py-3 border-b border-border-default">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {t("title")}
        </h2>
      </div>
      <div className="flex md:flex-col py-1">
        {GCS_NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/config/plugins"
              ? pathname.startsWith(item.href)
              : pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 px-3 py-2 min-h-12 md:min-h-0 whitespace-nowrap text-xs text-left transition-colors",
                isActive
                  ? "text-accent-primary bg-accent-primary/10 border-b-2 md:border-b-0 md:border-l-2 border-accent-primary"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-b-2 md:border-b-0 md:border-l-2 border-transparent"
              )}
            >
              {item.icon}
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
