"use client";

/**
 * @module command/settings/Section
 * @description The shared card wrapper for node Settings tab sections: one
 * CARD class + a titled section shell (optional icon + blurb), so every
 * settings page renders the same chrome instead of re-declaring it.
 * @license GPL-3.0-only
 */

import type { LucideIcon } from "lucide-react";

export const CARD = "rounded border border-border-default bg-bg-secondary p-5";

export function Section({
  title,
  icon: Icon,
  blurb,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      {Icon ? (
        <div className="mb-3 flex items-center gap-2">
          <Icon size={16} className="text-accent-primary" aria-hidden="true" />
          <h2 className="text-lg font-medium text-text-primary">{title}</h2>
        </div>
      ) : (
        <h2 className="mb-3 text-lg font-medium text-text-primary">{title}</h2>
      )}
      {blurb ? <p className="mb-4 text-xs text-text-secondary">{blurb}</p> : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}
