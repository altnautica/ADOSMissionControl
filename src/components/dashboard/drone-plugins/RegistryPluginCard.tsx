"use client";

/**
 * @module RegistryPluginCard
 * @description Inline card rendered on the per-drone Plugins tab for one
 * registry plugin. Surfaces the catalog name, description, category,
 * author, license, tier, and an Install button that's
 * compatibility-gated against the connected drone. Click Install — the
 * parent grid resolves the version row's manifest, parses it, and opens
 * `PluginInstallDialog` on its single-page review surface. From there
 * the operator approves permissions and the dialog hands the URL + SHA
 * pin to the agent's install-from-URL endpoint.
 *
 * Risk classification is intentionally NOT rendered on the card — risk
 * is tied to the actual manifest and surfaces inside the review modal
 * where the operator can also see which permissions drive the rating.
 *
 * @license GPL-3.0-only
 */

import { useId, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Cpu, Layout, Package, PenTool, Radio, Sparkles } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { resolveNamedIcon } from "@/lib/icons/icon-registry";
import {
  pluginMatchesProfile,
  type PluginTargetProfile,
} from "@/lib/plugins/types";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import type { FleetDrone } from "@/lib/types";
import { resolveRelayReach } from "@/lib/nodes/relay-reach";
import { cn } from "@/lib/utils";

import { useRegistryCompatibility } from "../../plugins/install-dialog/use-registry-compatibility";

type RegistryCategory = "drivers" | "ui" | "ai" | "telemetry" | "tools";

export interface RegistryPluginRow {
  _id: string;
  plugin_id: string;
  name: string;
  description: string;
  category: RegistryCategory;
  license: string;
  author_id: string;
  verified_publisher: boolean;
  latest_version: string;
  icon_url?: string;
  /** A declared named icon (shared icon vocabulary, e.g. "camera"). When the
   * catalog carries one it drives the preview glyph; otherwise the per-plugin
   * fallback map below (then the category glyph) applies. */
  icon?: string;
  tier?: "first_party" | "verified" | "community";
  /** Node profiles the plugin's agent half targets (`drone` /
   * `ground-station` / `workstation`), denormalized from the manifest. Absent
   * on older catalog rows → treated as drone-only by {@link pluginMatchesProfile}
   * so a drone-targeting plugin is not offered on a ground-station or
   * workstation node. */
  target_profiles?: PluginTargetProfile[];
}

type CardState = "loading" | { error: string } | undefined;

export interface RegistryPluginCardProps {
  plugin: RegistryPluginRow;
  /** Whether the plugin already lives on the target drone's install
   * state. When `true` the card disables Install and surfaces an
   * "Installed" pill. */
  installed: boolean;
  /** Transient install state managed by the parent grid. */
  state: CardState;
  onInstall: () => void;
  /** Rendering context. `"node"` (default): the per-drone Extensions tab —
   * Install kicks off the archive-fetch + review flow directly via
   * `onInstall`, gated by this drone's reported compatibility. `"settings"`:
   * the fleet-wide Settings -> Extensions overview, which has no single
   * node context to gate compatibility against — Install opens a node
   * picker and routes the operator to that node's own Extensions tab
   * instead of installing here (plan step 10). */
  surface?: "node" | "settings";
  /** True when a Settings "Install on a node…" hand-off landed on this
   * card (the `?preselect=` query param matched its plugin id). Drives a
   * highlight ring; the grid also scrolls it into view on mount. */
  highlighted?: boolean;
}

/** Lucide icon + tailwind classes paired with each registry category.
 * The category pill picks the right combo at render time so the colour
 * language matches the catalog filter chips. */
const CATEGORY_STYLE: Record<
  RegistryCategory,
  {
    icon: typeof Package;
    classes: string;
  }
> = {
  drivers: {
    icon: Cpu,
    classes:
      "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  },
  ui: {
    icon: Layout,
    classes:
      "border-text-secondary/40 bg-bg-tertiary text-text-primary",
  },
  ai: {
    icon: Sparkles,
    classes:
      "border-status-warning/40 bg-status-warning/10 text-status-warning",
  },
  telemetry: {
    icon: Radio,
    classes:
      "border-status-success/40 bg-status-success/10 text-status-success",
  },
  tools: {
    icon: PenTool,
    classes:
      "border-text-secondary/40 bg-surface-secondary text-text-secondary",
  },
};

/** A distinct named glyph per first-party plugin (from the shared icon
 * vocabulary) so two plugins in the same category still read apart at a glance.
 * A plugin whose catalog row carries a declared `icon` uses that instead; a
 * plugin in neither falls back to its category icon, so a community plugin
 * always gets a real glyph — never a bare letter. Keep in lockstep with the
 * website mirror (`website/src/components/extensions/ExtensionIcon.tsx`). */
const PLUGIN_ICON_NAME: Record<string, string> = {
  "com.altnautica.follow-me": "follow",
  "com.altnautica.vision-nav": "navigation",
  "com.altnautica.battery-health-panel": "battery",
  "com.altnautica.thermal-flir-lepton-usb": "thermal",
  "com.altnautica.mavlink-gimbal-v2": "gimbal",
  "com.altnautica.siyi-pod": "camera",
};

export function RegistryPluginCard({
  plugin,
  installed,
  state,
  onInstall,
  surface = "node",
  highlighted = false,
}: RegistryPluginCardProps) {
  const t = useTranslations("pluginRegistry.browse");
  const router = useRouter();
  const descId = useId();
  const isSettingsSurface = surface === "settings";

  // The connected node's resolved profile + whether its capabilities have
  // loaded, so we can gate Install on a plugin the paired node cannot host
  // (a drone-only plugin on a workstation, a ground-station-only plugin on a
  // drone). Only meaningful on the per-node surface — Settings has no single
  // node to gate against (plan step 10).
  const nodeProfile = useAgentCapabilitiesStore((s) => s.profile);
  const profileLoaded = useAgentCapabilitiesStore((s) => s.loaded);

  // `listPlugins` returns the plugin row but not the per-version
  // compatibility envelope. `getPlugin` fills in `agent_min_version`
  // and `supported_boards`; Convex deduplicates the subscription
  // across cards that share an id.
  const detail = useQuery(api.pluginRegistry.getPlugin, {
    pluginId: plugin.plugin_id,
  }) as
    | {
        versions: ReadonlyArray<{
          version: string;
          agent_min_version: string;
          agent_max_version?: string;
          supported_boards?: ReadonlyArray<string>;
        }>;
      }
    | null
    | undefined;

  const latestVersionRow = useMemo(() => {
    if (!detail || detail === null) return null;
    return (
      detail.versions.find((v) => v.version === plugin.latest_version) ?? null
    );
  }, [detail, plugin.latest_version]);

  const compat = useRegistryCompatibility(
    latestVersionRow ?? {
      agent_min_version: plugin.latest_version,
      supported_boards: undefined,
    },
    { surface },
  );

  const isLoading = state === "loading";
  const errMessage =
    state && typeof state === "object" && "error" in state ? state.error : null;

  // Every compat reason — no_agent, version, board — is a genuine hard
  // block on the per-node surface: an operator must never see a clickable
  // Install next to "Not compatible with this drone's board" (defect: the
  // per-node page used to render that exact combination). The only
  // remaining soft state is a still-loading version row, which blocks
  // nothing.
  //
  // On Settings, Install no longer installs onto a specific node — it
  // opens a node picker — so a compat reading against whichever node
  // happens to be globally focused elsewhere in the app must not disable
  // the button here.
  const compatBlock = !isSettingsSurface && !compat.compatible;
  const loadingVersionDetail = !latestVersionRow;

  // The paired node cannot host this plugin's target profile. A hard block
  // on the per-node surface only; Settings has no single node to check.
  const profileBlock =
    !isSettingsSurface &&
    profileLoaded &&
    !pluginMatchesProfile(plugin.target_profiles, nodeProfile);

  const disabled = installed || isLoading || compatBlock || profileBlock;

  // Reason text, threaded through as BOTH the hover `title` and an
  // `aria-describedby`-linked accessible description below — a `title`
  // alone is invisible to keyboard and screen-reader users.
  const incompatibilityReason = (() => {
    if (installed) return undefined;
    if (profileBlock) {
      return t("card.notCompatible.profile");
    }
    if (compat.reason === "no_agent") {
      return compat.detail ?? t("card.notCompatible.noAgent");
    }
    if (compat.reason === "version") {
      return t("card.notCompatible.version", {
        version: compat.detail ?? "?",
      });
    }
    if (compat.reason === "board") {
      return t("card.notCompatible.board");
    }
    if (loadingVersionDetail) {
      return t("card.notCompatible.loadingDetail");
    }
    return undefined;
  })();

  // Settings has nothing to disable Install on, but `no_agent` still fires
  // whenever no node happens to be globally focused elsewhere in the app.
  // Reworded for a fleet-wide context and shown as an informational
  // description rather than a disable reason.
  const settingsHint =
    isSettingsSurface && compat.reason === "no_agent"
      ? (compat.detail ?? t("card.notCompatible.noAgent"))
      : undefined;

  const accessibleDescription = isSettingsSurface
    ? settingsHint
    : incompatibilityReason;

  // A still-loading version row never disables the button; it just
  // surfaces a "still loading" note underneath.
  const warningText =
    !isSettingsSurface && !disabled && loadingVersionDetail
      ? t("card.notCompatible.loadingDetail")
      : null;

  const tierKey =
    plugin.tier ?? (plugin.verified_publisher ? "verified" : "community");

  const categoryStyle = CATEGORY_STYLE[plugin.category];
  const CategoryIcon = categoryStyle.icon;
  // Preview glyph: the catalog's declared icon, else a distinct per-plugin
  // glyph, else the category icon — never a bare letter. All resolve through
  // the shared icon vocabulary. The catalog's icon_url SVGs are not hosted, so
  // the glyph is the canonical preview.
  const declaredIconName = plugin.icon ?? PLUGIN_ICON_NAME[plugin.plugin_id];
  const PreviewIcon = declaredIconName
    ? resolveNamedIcon(declaredIconName)
    : CategoryIcon;

  // ── Settings-surface node picker ──────────────────────────────────────
  // Install has no single node to target here, so it opens a picker of
  // every node whose own Extensions tab can accept an install — the same
  // reach gate `DronePluginsTab.tsx` widens (`agentDeviceId !== null ||
  // relayReach !== null`). Picking one focuses that drone (the same store
  // `NodeDetailPanel` reads) and hands off to the dashboard with this
  // plugin flagged for preselection.
  const [pickerOpen, setPickerOpen] = useState(false);
  const drones = useFleetStore((s) => s.drones);
  const selectDrone = useDroneManager((s) => s.selectDrone);
  const eligibleNodes = useMemo<FleetDrone[]>(() => {
    if (!isSettingsSurface) return [];
    return drones.filter((d) => {
      const agentDeviceId = d.cloudDeviceId ?? null;
      if (agentDeviceId !== null) return true;
      return (
        resolveRelayReach({
          agentDeviceId,
          reachedVia: d.reachedVia,
          droneDeviceId: d.id,
        }) !== null
      );
    });
  }, [isSettingsSurface, drones]);

  function handlePickNode(node: FleetDrone) {
    setPickerOpen(false);
    selectDrone(node.id);
    router.push(`/?preselect=${encodeURIComponent(plugin.plugin_id)}`);
  }

  function handlePrimaryAction() {
    if (isSettingsSurface) {
      setPickerOpen((v) => !v);
      return;
    }
    onInstall();
  }

  const installLabel = installed
    ? t("card.installed")
    : isLoading
      ? t("card.installing")
      : isSettingsSurface
        ? t("card.installOnNode")
        : t("card.install");

  return (
    <li className="h-full" data-plugin-id={plugin.plugin_id}>
      {/* The whole card is the click target. On the per-node surface it
       * opens the install/detail modal (the same action as the Install
       * button). On Settings there is no separate pre-install manifest
       * preview to route to, so it opens the same node picker as Install.
       * Keyboard-operable via role=button + Enter/Space. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handlePrimaryAction}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handlePrimaryAction();
          }
        }}
        aria-label={`${t("card.viewDetails")} — ${plugin.name}`}
        className={cn(
          "flex h-full cursor-pointer flex-col gap-2 rounded-lg border border-border-default bg-bg-secondary p-3 transition-colors hover:border-border-strong hover:bg-bg-tertiary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary",
          highlighted && "ring-2 ring-accent-primary",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border " +
              categoryStyle.classes
            }
          >
            <PreviewIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <h4 className="truncate text-sm font-medium text-text-primary">
                {plugin.name}
              </h4>
              <span className="text-xs text-text-tertiary">
                v{plugin.latest_version}
              </span>
              {installed && (
                <Badge variant="success" size="sm">
                  {t("card.installedPill")}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <span
                className={
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium " +
                  categoryStyle.classes
                }
              >
                <CategoryIcon className="h-3 w-3" aria-hidden />
                {t(`category.${plugin.category}`)}
              </span>
              <Badge variant="info" size="sm">
                {plugin.license}
              </Badge>
              {tierKey === "first_party" && (
                <Badge variant="success" size="sm">
                  {t("card.tierBadge.first_party")}
                </Badge>
              )}
              {tierKey === "verified" && (
                <Badge variant="info" size="sm">
                  {t("card.tierBadge.verified")}
                </Badge>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant={
              installed || compatBlock || profileBlock ? "secondary" : "primary"
            }
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              handlePrimaryAction();
            }}
            title={accessibleDescription}
            aria-label={`${installLabel} — ${plugin.name}`}
            aria-describedby={accessibleDescription ? descId : undefined}
            className="shrink-0"
          >
            {installLabel}
          </Button>
        </div>

        {accessibleDescription && (
          <span id={descId} className="sr-only">
            {accessibleDescription}
          </span>
        )}

        <p className="line-clamp-2 text-xs text-text-secondary">
          {plugin.description}
        </p>

        <p className="mt-auto truncate text-[11px] text-text-tertiary">
          {t("card.byAuthor", { author: plugin.author_id })}
        </p>

        {isSettingsSurface && pickerOpen && (
          <div
            className="space-y-1 rounded-md border border-border-default bg-bg-tertiary p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-1 text-[11px] font-medium text-text-tertiary">
              {t("card.pickNodeHeading")}
            </p>
            {eligibleNodes.length === 0 ? (
              <p className="px-1 text-[11px] text-text-tertiary">
                {t("card.pickNodeEmpty")}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {eligibleNodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePickNode(node);
                      }}
                      className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-bg-primary"
                    >
                      {node.name ?? node.id}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {errMessage && (
          <div
            className="flex items-start justify-between gap-2 rounded border border-status-error/40 bg-status-error/10 px-2 py-1.5 text-xs text-status-error"
            role="alert"
          >
            <div className="min-w-0 flex-1 break-words">
              <p className="font-medium">{t("card.error.title")}</p>
              <p className="mt-0.5 text-[11px] opacity-90">{errMessage}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onInstall();
              }}
              className="shrink-0"
            >
              {t("card.error.retry")}
            </Button>
          </div>
        )}

        {warningText && !errMessage && (
          <p
            className="rounded border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-[11px] text-status-warning"
            role="status"
          >
            {warningText}
          </p>
        )}
      </div>
    </li>
  );
}
