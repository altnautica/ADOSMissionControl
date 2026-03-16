"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { SilentErrorBoundary } from "@/components/ui/SilentErrorBoundary";

const tabs = [
  { label: "Changelog", href: "/community/changelog" },
  { label: "Kanban", href: "/community/kanban", adminOnly: true },
{ label: "Roadmap", href: "/community/roadmap" },
  { label: "Contact", href: "/community/contact" },
];

function CommunityLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = useIsAdmin();

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
                  {tab.label}
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

  if (!convexAvailable) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3 p-8 max-w-md">
          <p className="text-text-secondary text-sm">
            Community data (changelog, roadmap, contact) is
            live on the hosted version at{" "}
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
            Disabled by default in local builds. To run your own internal
            community board, set up a Convex backend and configure{" "}
            <code className="text-accent-primary">NEXT_PUBLIC_CONVEX_URL</code>.
          </p>
          <p className="text-text-tertiary text-xs">
            Completely optional. The GCS works without it.
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
