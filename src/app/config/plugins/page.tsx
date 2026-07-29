"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { RegistryPluginGrid } from "@/components/dashboard/drone-plugins/RegistryPluginGrid";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalPluginInstallsStore } from "@/stores/local-plugin-installs-store";
import { useFleetNodes } from "@/hooks/use-fleet-nodes";
import { cn } from "@/lib/utils";

/** One row in the fleet-wide installed-by-node table (cloud + local-first merged). */
interface InstalledRow {
  /** Stable list key. */
  key: string;
  /** Convex install id when this came from the cloud (links to detail). */
  cloudId?: string;
  pluginId: string;
  name: string;
  version: string;
  status: string;
  /** Where it landed: a drone wire id, or null for a GCS-level install. */
  deviceId: string | null;
}

/** All installs on one node (or the GCS-only bucket), for the fleet-wide
 * "what is installed where" table below. */
interface NodeInstallGroup {
  deviceId: string | null;
  nodeName: string;
  rows: InstalledRow[];
}

/**
 * Settings -> Extensions: a READ-ONLY fleet-wide overview. Extensions
 * install per node, from that node's own Agent -> Extensions tab
 * (`DronePluginsTab.tsx` / `command/PluginsTab.tsx`) — this page answers
 * "what is installed where" across the fleet and hosts the registry
 * browser + the permission-management detail page
 * (`/config/plugins/[id]`), but it never kicks off an install itself
 * (plan step 9). A registry card's primary action instead opens a node
 * picker that routes the operator to the right node
 * (`RegistryPluginCard.tsx`, `surface="settings"`).
 */
export default function PluginsIndexPage() {
  const t = useTranslations("plugins");
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const cloudInstalls = useConvexSkipQuery(communityApi.plugins.listMine, {
    enabled: isAuthenticated,
  });
  const localInstalls = useLocalPluginInstallsStore((s) => s.installs);
  const fleetNodes = useFleetNodes();

  // Node display name for a device id, so the table reads "Skynode A7S",
  // not a bare wire id.
  const nodeNameByDeviceId = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of fleetNodes) m.set(n.deviceId, n.name ?? n.deviceId);
    return m;
  }, [fleetNodes]);

  // Merge cloud + local-first installs into one list. Cloud rows win on a
  // collision (they carry status + risk); a local-only install renders with
  // a neutral pill so a signed-out operator still sees what they installed.
  const installs = useMemo<InstalledRow[] | undefined>(() => {
    // Still loading the cloud list (signed in, query pending).
    if (isAuthenticated && cloudInstalls === undefined) return undefined;
    const byKey = new Map<string, InstalledRow>();
    const keyOf = (deviceId: string | null, pluginId: string) =>
      `${deviceId ?? "fleet"}::${pluginId}`;
    for (const i of localInstalls) {
      const key = keyOf(i.deviceId, i.pluginId);
      byKey.set(key, {
        key,
        pluginId: i.pluginId,
        name: i.name,
        version: i.version,
        status: "installed",
        deviceId: i.deviceId,
      });
    }
    for (const c of cloudInstalls ?? []) {
      const deviceId = c.droneId ?? null;
      const key = keyOf(deviceId, c.pluginId);
      byKey.set(key, {
        key,
        cloudId: c._id,
        pluginId: c.pluginId,
        name: c.name,
        version: c.version,
        status: c.status,
        deviceId,
      });
    }
    return Array.from(byKey.values());
  }, [isAuthenticated, cloudInstalls, localInstalls]);

  // Group by node so the fleet-wide table answers "what is installed
  // where" rather than a flat, node-agnostic list.
  const groups = useMemo<NodeInstallGroup[]>(() => {
    if (!installs) return [];
    const byDevice = new Map<string | null, InstalledRow[]>();
    for (const row of installs) {
      const list = byDevice.get(row.deviceId) ?? [];
      list.push(row);
      byDevice.set(row.deviceId, list);
    }
    return Array.from(byDevice.entries())
      .map(([deviceId, rows]) => ({
        deviceId,
        nodeName: deviceId
          ? (nodeNameByDeviceId.get(deviceId) ?? deviceId)
          : t("scopeGcs"),
        rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.nodeName.localeCompare(b.nodeName));
  }, [installs, nodeNameByDeviceId, t]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">
          {t("pageTitle")}
        </h1>
        <p className="max-w-2xl text-xs text-text-tertiary">
          {t("pageBlurb")}
        </p>
      </header>

      {installs === undefined ? (
        <p className="py-12 text-center text-sm text-text-tertiary">
          {t("loadingInstalls")}
        </p>
      ) : groups.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section
              key={group.deviceId ?? "fleet"}
              className="overflow-hidden rounded-md border border-border-default bg-bg-secondary"
            >
              <h2 className="border-b border-border-default px-4 py-2 text-sm font-semibold text-text-primary">
                {group.nodeName}
              </h2>
              <ul className="divide-y divide-border-default">
                {group.rows.map((install) => (
                  <li key={install.key}>
                    <InstalledItem install={install} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Discover extensions in the registry; each card routes the operator
          to a node's own Extensions tab to install (plan step 10) — this
          page never installs anything itself. */}
      <RegistryPluginGrid target={null} surface="settings" />
    </div>
  );
}

function InstalledItem({ install }: { install: InstalledRow }) {
  const t = useTranslations("plugins");
  const scopeLabel = install.deviceId ? t("scopeDrone") : t("scopeGcs");
  const body = (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">
            {install.name}
          </span>
          <span className="text-xs text-text-tertiary">v{install.version}</span>
        </div>
        <code className="block truncate text-xs text-text-tertiary">
          {install.pluginId}
        </code>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="rounded-md border border-border-default bg-bg-tertiary px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
          {scopeLabel}
        </span>
        <StatusPill status={install.status} />
      </div>
    </div>
  );
  // Cloud rows link to their detail page (permission grant/revoke, events —
  // management, not install); a local-only row has no detail route yet, so
  // it renders inert (still visible in the list).
  return install.cloudId ? (
    <Link
      href={`/config/plugins/${install.cloudId}`}
      className="block transition-colors hover:bg-bg-tertiary"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

function EmptyState() {
  const t = useTranslations("plugins");
  return (
    <div className="rounded-md border border-dashed border-border-default p-8 text-center">
      <p className="text-sm text-text-primary">{t("emptyTitle")}</p>
      <p className="mt-1 text-xs text-text-tertiary">{t("emptyBlurb")}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, string> = {
    installed: "border-text-secondary/30 bg-bg-tertiary text-text-tertiary",
    enabled: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
    running:
      "border-status-success/40 bg-status-success/10 text-status-success",
    disabled: "border-text-secondary/30 bg-bg-tertiary text-text-tertiary",
    crashed: "border-status-error/40 bg-status-error/10 text-status-error",
    removed: "border-text-secondary/30 bg-bg-tertiary text-text-tertiary",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        palette[status] ?? palette.disabled,
      )}
    >
      {status}
    </span>
  );
}
