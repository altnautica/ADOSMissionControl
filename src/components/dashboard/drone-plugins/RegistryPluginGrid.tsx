"use client";

/**
 * @module RegistryPluginGrid
 * @description Inline registry catalog rendered on the per-drone Plugins
 * tab below the installed list. Surfaces every published first-party
 * plugin via Convex `pluginRegistry.listPlugins`, applies client-side
 * search + category filtering, and on Install click reads the version
 * row's manifest YAML, parses it for the dialog preview, and opens
 * `<PluginInstallDialog>` directly at the `review` stage. The dialog
 * then hands the URL + SHA256 pin to the agent's
 * `POST /api/plugins/install_from_url` endpoint so the archive is never
 * pulled through the browser.
 *
 * Already-installed plugins (read from `cmdPlugins:listForDevice`)
 * render with an Installed pill and a disabled Install button. The
 * compat hook gates Install on each card against the connected drone's
 * agent version + board.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useTranslations } from "next-intl";
import { Package, Search } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useLocalPluginInstallsStore } from "@/stores/local-plugin-installs-store";
import { isDemoMode, cn } from "@/lib/utils";

import { PluginInstallDialog } from "@/components/plugins/PluginInstallDialog";
import type {
  InstallTargetDrone,
  InstallManifestSummary,
  InstallSource,
} from "@/components/plugins/install-dialog/types";
import {
  parseManifestYaml,
  toInstallSummary,
} from "@/components/plugins/transports/manifest-parse";

import {
  RegistryPluginCard,
  type RegistryPluginRow,
} from "./RegistryPluginCard";
// The demo catalog is a fixture set that only ever renders under demo mode.
// Loaded on demand so its fixtures stay out of the initial bundle.
const DemoRegistryGrid = dynamic(
  () => import("./DemoRegistryGrid").then((m) => m.DemoRegistryGrid),
  { ssr: false },
);

type RegistryCategory = "drivers" | "ui" | "ai" | "telemetry" | "tools";
type CategoryFilter = "all" | RegistryCategory;

const CATEGORIES: ReadonlyArray<RegistryCategory> = [
  "drivers",
  "ui",
  "ai",
  "telemetry",
  "tools",
];

interface ListPluginsResult {
  items: ReadonlyArray<RegistryPluginRow>;
  nextCursor: string | null;
  total: number;
}

/** Subset of the version row the install path needs. Carries the
 * manifest YAML + canonical download URL + SHA-256 pin so the agent
 * can verify archive bytes after pulling, plus the signing fields and
 * vendor-attribution rows the modal renders (the manifest YAML text
 * is for display copy; the registry row is authoritative for signing
 * + vendor entries). */
interface RegistryVersionLite {
  manifest_yaml: string;
  download_url: string;
  archive_sha256: string;
  /** Ed25519 signer key id (e.g. `altnautica-2026-A`). Drives the
   * "Signed by" chip in the trust strip and the sidebar metadata. */
  signer_key_id?: string;
  /** Base64 Ed25519 signature over the canonical archive bytes.
   * Plumbed through for future revocation checks; not rendered. */
  signature?: string;
  /** Hex digest of the signed payload (manifest+archive). */
  payload_hash?: string;
  /** Bundled-vendor-binary attribution array stored verbatim from the
   * agent manifest's `agent.vendor_attribution` block. Triggers the
   * "What's included" warning rows and the sidebar's Vendor Binaries
   * branch. */
  vendor_attribution?: ReadonlyArray<{
    name: string;
    license: string;
    source_url: string;
    upstream_version?: string;
    notice?: string;
  }>;
}

const getVersionRef = makeFunctionReference<
  "query",
  { pluginId: string; version: string },
  RegistryVersionLite | null
>("pluginRegistry:getVersion");

/** Per-device install row shape (subset). Only needs `pluginId` so the
 * grid can mark installed plugins on their card. */
interface InstallRowForDevice {
  pluginId: string;
}

const listForDeviceRef = makeFunctionReference<
  "query",
  { deviceId: string },
  InstallRowForDevice[]
>("cmdPlugins:listForDevice");

type CardState = "loading" | { error: string } | undefined;

interface PendingInstall {
  manifest: InstallManifestSummary;
  manifestHash: string;
  source: Extract<InstallSource, { kind: "registry" }>;
}

export interface RegistryPluginGridProps {
  /** Drone the install lands on. The per-drone Plugins tab passes the
   * active drone; the Settings → Plugins home passes the operator's
   * chosen target from its drone picker. Null only while no drone is
   * selectable (the grid still renders the catalog read-only). */
  target?: InstallTargetDrone | null;
}

export function RegistryPluginGrid({ target = null }: RegistryPluginGridProps) {
  const t = useTranslations("pluginRegistry.browse");
  const convexAvailable = useConvexAvailable();

  const deviceId = target?.deviceId ?? null;

  const catalog = useQuery(
    api.pluginRegistry.listPlugins,
    convexAvailable && !isDemoMode() ? {} : "skip",
  ) as ListPluginsResult | undefined;

  // Already-installed plugin ids so we can mark cards. The Convex
  // per-device query returns an empty list for unauthenticated callers
  // (correct for LAN-only mode), and the local-first install store is
  // merged in so a plugin installed with no cloud session still shows
  // the Installed pill.
  const installs = useConvexSkipQuery(listForDeviceRef, {
    args: { deviceId: deviceId ?? "" },
    enabled: !isDemoMode() && deviceId !== null,
  });
  const localInstalls = useLocalPluginInstallsStore((s) => s.installs);
  const installedIds = useMemo(() => {
    const ids = new Set<string>();
    if (installs) for (const row of installs) ids.add(row.pluginId);
    // Local records for this scope (a specific drone, or the fleet/GCS
    // bucket when there is no drone).
    for (const i of localInstalls) {
      if (i.deviceId === deviceId) ids.add(i.pluginId);
    }
    return ids;
  }, [installs, localInstalls, deviceId]);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [cardState, setCardState] = useState<Record<string, CardState>>({});
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [pendingFetch, setPendingFetch] = useState<{
    pluginId: string;
    version: string;
  } | null>(null);

  // Drive the version lookup reactively so the install handler can
  // wait for the result without an action hop. Convex deduplicates
  // overlapping subscriptions across cards that share an id.
  const versionRow = useQuery(
    getVersionRef,
    pendingFetch && convexAvailable
      ? { pluginId: pendingFetch.pluginId, version: pendingFetch.version }
      : "skip",
  ) as RegistryVersionLite | null | undefined;

  const installTarget = target;

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const needle = search.trim().toLowerCase();
    return catalog.items.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (needle) {
        const haystack = `${p.name} ${p.description}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [catalog, search, category]);

  // Once the version row resolves, parse its embedded manifest yaml
  // and open the dialog with a registry-source descriptor.
  useEffect(() => {
    if (!pendingFetch || versionRow === undefined) return;
    const key = pendingFetch.pluginId;
    const targetVersion = pendingFetch.version;
    setPendingFetch(null);
    if (!versionRow) {
      setCardState((prev) => ({
        ...prev,
        [key]: { error: `[registry.lookup] version row missing` },
      }));
      return;
    }
    (async () => {
      try {
        const yaml = versionRow.manifest_yaml;
        const parsed = parseManifestYaml(yaml);
        const hashBytes = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(yaml),
        );
        const manifestHash = Array.from(new Uint8Array(hashBytes))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        // The Convex row wins for signing + vendor binaries because
        // the row is what the registry actually signed and seeded.
        const summary = toInstallSummary(parsed, manifestHash, {
          signerId: versionRow.signer_key_id,
          vendorAttribution: versionRow.vendor_attribution
            ? versionRow.vendor_attribution.map((v) => ({ ...v }))
            : undefined,
          archiveSha256: versionRow.archive_sha256,
        });

        setCardState((prev) => ({ ...prev, [key]: undefined }));
        setPending({
          manifest: summary,
          manifestHash,
          source: {
            kind: "registry",
            url: versionRow.download_url,
            expectedSha256: versionRow.archive_sha256,
            pluginId: key,
            version: targetVersion,
          },
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        console.error("[plugin install]", key, "manifest.parse", err);
        setCardState((prev) => ({
          ...prev,
          [key]: { error: `[manifest.parse] ${raw}` },
        }));
      }
    })();
  }, [pendingFetch, versionRow]);

  const handleInstall = useCallback((plugin: RegistryPluginRow) => {
    const key = plugin.plugin_id;
    setCardState((prev) => ({ ...prev, [key]: "loading" }));
    setPendingFetch({ pluginId: key, version: plugin.latest_version });
  }, []);

  // Demo mode: the live registry is Convex-backed and unreachable, so render a
  // fixture catalog that opens the same install / detail pop-up (Rule 4).
  if (isDemoMode()) {
    return <DemoRegistryGrid target={target} />;
  }

  if (!convexAvailable) {
    return (
      <section className="space-y-2">
        <SectionHeader t={t} />
        <ErrorMessage text={t("error.unavailable")} />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <SectionHeader t={t} />
      <Toolbar
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
        t={t}
      />

      {catalog === undefined && <SkeletonList />}

      {catalog !== undefined && filtered.length === 0 && <EmptyState t={t} />}

      {catalog !== undefined && filtered.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((plugin) => (
            <RegistryPluginCard
              key={plugin._id}
              plugin={plugin}
              installed={installedIds.has(plugin.plugin_id)}
              state={cardState[plugin.plugin_id]}
              onInstall={() => handleInstall(plugin)}
            />
          ))}
        </ul>
      )}

      <PluginInstallDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        targetDevice={installTarget}
        initialManifest={pending?.manifest}
        initialManifestHash={pending?.manifestHash}
        initialSource={pending?.source}
      />
    </section>
  );
}

type T = ReturnType<typeof useTranslations>;

function SectionHeader({ t }: { t: T }) {
  return (
    <header className="space-y-0.5">
      <h3 className="text-base font-semibold text-text-primary">
        {t("title")}
      </h3>
      <p className="text-xs text-text-tertiary">{t("subtitle")}</p>
    </header>
  );
}

function Toolbar({
  search,
  setSearch,
  category,
  setCategory,
  t,
}: {
  search: string;
  setSearch: (v: string) => void;
  category: CategoryFilter;
  setCategory: (v: CategoryFilter) => void;
  t: T;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-md border border-border-default bg-bg-secondary py-1.5 pl-7 pr-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          aria-label={t("searchPlaceholder")}
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
        <CategoryChip
          active={category === "all"}
          onClick={() => setCategory("all")}
          label={t("category.all")}
        />
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
            label={t(`category.${c}`)}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
          : "border-border-default bg-bg-secondary text-text-secondary hover:border-border-strong",
      )}
    >
      {label}
    </button>
  );
}

function EmptyState({ t }: { t: T }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border-default p-6 text-center">
      <Package className="h-6 w-6 text-text-tertiary" aria-hidden />
      <p className="text-sm text-text-primary">{t("empty.title")}</p>
      <p className="text-xs text-text-tertiary">{t("empty.subtitle")}</p>
    </div>
  );
}

function ErrorMessage({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-status-error/30 bg-status-error/10 p-3 text-sm text-status-error">
      {text}
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="h-[120px] animate-pulse rounded-md border border-border-default bg-bg-secondary"
        />
      ))}
    </ul>
  );
}
