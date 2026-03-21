"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";

const tabs = [
  { labelKey: "changelog", href: "/community/changelog" },
  { labelKey: "kanban", href: "/community/kanban", adminOnly: true },
  { labelKey: "roadmap", href: "/community/roadmap" },
  { labelKey: "contact", href: "/community/contact" },
];

function CommunityLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = useIsAdmin();
  const t = useTranslations("communityNav");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border-default bg-bg-secondary px-4">
        <nav className="flex gap-1" aria-label="Community navigation">
          {tabs
            .filter((tab) => !tab.adminOnly || isAdmin)
            .map((tab) => {
              const isActive =
                pathname === tab.href || pathname.startsWith(tab.href + "/");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "px-3 py-2 text-xs font-medium transition-colors border-b-2",
                    isActive
                      ? "border-accent-primary text-text-primary"
                      : "border-transparent text-text-tertiary hover:text-text-secondary"
                  )}
                >
                  {t(tab.labelKey)}
                </Link>
              );
            })}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const convexAvailable = useConvexAvailable();
  const t = useTranslations("communityNav");

  if (!convexAvailable) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 p-8 max-w-md">
          <p className="text-text-secondary text-sm">
            {t("unavailableTitle")}{" "}
            <a
              href="https://command.altnautica.com/community"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary hover:underline"
            >
              command.altnautica.com/community
            </a>
          </p>
          <p className="text-text-tertiary text-xs">
            {t("unavailableSetup")}
          </p>
          <p className="text-text-tertiary text-xs">
            {t("unavailableOptional")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <SilentErrorBoundary label="CommunityLayout">
      <CommunityLayoutInner>{children}</CommunityLayoutInner>
    </SilentErrorBoundary>
  );
}
