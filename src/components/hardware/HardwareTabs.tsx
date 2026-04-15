"use client";

/**
 * @module HardwareTabs
 * @description Secondary nav for the Hardware tab: Overview / Network / Physical UI.
 * @license GPL-3.0-only
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string }[] = [
  { href: "/hardware", label: "Overview" },
  { href: "/hardware/network", label: "Network" },
  { href: "/hardware/ui", label: "Physical UI" },
];

export function HardwareTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-5 flex gap-1 border-b border-border-primary">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-3 py-2 text-sm transition-colors border-b-2 -mb-px",
              active
                ? "border-accent-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
