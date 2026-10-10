"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

// Extensions are discovered and installed per node from the node's own
// Extensions tab. This section lists the extensions the operator has
// installed.
const INSTALLED_HREF = "/config/plugins";

export default function PluginsSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("plugins");
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border-default bg-bg-tertiary/40 px-4">
        <nav className="flex gap-1" aria-label={t("sectionNavLabel")}>
          <Link
            href={INSTALLED_HREF}
            className="border-b-2 border-accent-primary px-3 py-2 text-sm text-text-primary"
          >
            {t("sectionInstalled")}
          </Link>
        </nav>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
