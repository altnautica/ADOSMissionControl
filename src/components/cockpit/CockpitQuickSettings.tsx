/**
 * The in-cockpit quick-settings drawer: a right-side slide-in surface that lets
 * the operator adjust an installed plugin's parameters AND switch the active
 * vision model without leaving the immersive `/fly` cockpit.
 *
 * It is an ASSEMBLY of surfaces that already exist and are tested:
 *   - `<PluginParametersPanel>` (compact, schema-driven) per installed plugin
 *     that contributes `gcs.contributes.parameters` for the active drone — the
 *     same native panel the per-drone tab body renders, just relocated here.
 *   - `<ModelPicker mode="compact">` for the engine-wide active detector
 *     (`engine.detector`), so the operator can download / set / upload a vision
 *     model from the cockpit.
 *   - any plugin-contributed `cockpit.panel` iframe, mounted through a real
 *     `<PluginSlot name="cockpit.panel">` fed by the per-drone contribution
 *     producer, so a plugin can add its own cockpit surface.
 *
 * Two open modes:
 *   - the bar-button / keybinding path opens it showing every parameter-bearing
 *     plugin + the model picker (an unfocused, full view);
 *   - a per-skill affordance opens it filtered to a single plugin via
 *     `focusPluginId`, so a long-press on a plugin skill jumps straight to that
 *     plugin's settings.
 *
 * The drawer is gated like the other cockpit overlays (it mounts only while
 * Cockpit is on, in `CockpitView`) and owns its own Escape so a press closes
 * the drawer before the cockpit's Escape would leave the cockpit.
 *
 * @module fly/CockpitQuickSettings
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { useDroneManager } from "@/stores/drone-manager";
import { useDronePluginContributions } from "@/hooks/use-drone-plugin-contributions";
import { usePluginContributions } from "@/hooks/use-plugin-contributions";
import {
  PluginHostProvider,
  type PluginSlotContribution,
} from "@/components/plugins/PluginHostProvider";
import { PluginSlot } from "@/components/plugins/PluginSlot";
import { PluginParametersPanel } from "@/components/plugins/parameters/PluginParametersPanel";
import { ModelPicker } from "@/components/vision/ModelPicker";
import type { DronePluginContribution } from "@/hooks/use-drone-plugin-contributions";

interface CockpitQuickSettingsProps {
  /** Close the drawer (the cockpit owns the open flag). */
  onClose: () => void;
  /**
   * When set, the drawer shows only this plugin's parameters (the per-skill
   * affordance path). When omitted, every parameter-bearing plugin shows plus
   * the model picker.
   */
  focusPluginId?: string;
}

/**
 * One installed plugin's quick-settings card: a header + its native compact
 * parameter panel. Only rendered for plugins that contribute parameters.
 */
function PluginQuickCard({
  droneId,
  contribution,
}: {
  droneId: string;
  contribution: DronePluginContribution;
}) {
  return (
    <section className="flex flex-col gap-2 border border-border-default bg-bg-secondary/60 p-3">
      <h4 className="text-xs font-semibold text-text-primary">
        {contribution.title}
      </h4>
      {/* No confirmed-values source today (the agent exposes a config write but
          no read-back); the panel seeds from schema defaults and badges each
          unconfirmed value as a default rather than a live reading. */}
      <PluginParametersPanel
        droneId={droneId}
        pluginId={contribution.pluginId}
        parameters={contribution.parameters}
      />
    </section>
  );
}

export function CockpitQuickSettings({
  onClose,
  focusPluginId,
}: CockpitQuickSettingsProps) {
  const t = useTranslations("cockpitQuickSettings");
  const tVision = useTranslations("vision");
  const drawerRef = useRef<HTMLDivElement>(null);

  const droneId = useDroneManager((s) => s.selectedDroneId);

  // The per-drone plugin contributions carry each plugin's declarative
  // parameters (the same source the per-drone tab body reads). We render a
  // card for each plugin that contributes at least one parameter.
  const contributions = useDronePluginContributions(droneId ?? undefined);

  const paramPlugins = useMemo(
    () =>
      contributions
        .filter((c) => c.parameters.length > 0)
        .filter((c) => !focusPluginId || c.pluginId === focusPluginId),
    [contributions, focusPluginId],
  );

  // Plugin-contributed cockpit.panel iframes for the active drone. Narrowed to
  // the focused plugin when the drawer was opened from a per-skill affordance.
  const cockpitPanels = usePluginContributions(
    droneId ?? null,
    "cockpit.panel",
  );
  const visiblePanels = useMemo<
    ReadonlyArray<PluginSlotContribution & { slot: "cockpit.panel" }>
  >(() => {
    const list = focusPluginId
      ? cockpitPanels.filter((c) => c.pluginId === focusPluginId)
      : cockpitPanels;
    // Every item comes from the cockpit.panel producer; pin the literal slot so
    // the host provider gets the narrowed contribution shape it requires.
    return list.map((c) => ({ ...c, slot: "cockpit.panel" as const }));
  }, [cockpitPanels, focusPluginId]);

  // The model picker is engine-wide, so only show it on the unfocused (all)
  // view — a per-skill focus is about that plugin, not the global detector.
  const showModelPicker = !focusPluginId && Boolean(droneId);

  // Own Escape while the drawer is open: close the drawer, and stop the event
  // so the cockpit's own Escape (which would leave the cockpit) never fires in
  // the same press. Capture phase so we win the race against the window
  // listener the cockpit installs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  // Move focus into the drawer on open so a keyboard operator lands inside it.
  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  const hasContent =
    paramPlugins.length > 0 || visiblePanels.length > 0 || showModelPicker;

  return (
    <div
      className="pointer-events-auto absolute inset-0 z-40 flex justify-end"
      data-cockpit-layer="quick-settings"
    >
      {/* Scrim — a click outside the drawer closes it. */}
      <button
        type="button"
        aria-label={t("close")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[1px]"
        tabIndex={-1}
      />

      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        tabIndex={-1}
        className="relative flex h-full w-[360px] max-w-[90vw] flex-col border-l border-border-default bg-bg-primary shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-text-primary">
              {t("title")}
            </h3>
            <p className="text-[11px] text-text-tertiary">
              {focusPluginId ? t("subtitleFocused") : t("subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-7 w-7 items-center justify-center border border-border-default text-text-secondary transition-colors hover:border-accent-primary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {!droneId ? (
            <p className="py-6 text-center text-xs text-text-tertiary">
              {t("noDrone")}
            </p>
          ) : !hasContent ? (
            <p className="py-6 text-center text-xs text-text-tertiary">
              {focusPluginId ? t("emptyFocused") : t("empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Engine-wide vision model picker (unfocused view only). */}
              {showModelPicker ? (
                <section className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {t("modelSection")}
                  </h4>
                  <span className="text-xs text-text-secondary">
                    {tVision("detector")}
                  </span>
                  <ModelPicker droneId={droneId} mode="compact" hideHeaderLabel />
                </section>
              ) : null}

              {/* Per-plugin native parameter cards. */}
              {paramPlugins.map((c) => (
                <PluginQuickCard
                  key={c.installId}
                  droneId={droneId}
                  contribution={c}
                />
              ))}

              {/* Plugin-contributed cockpit.panel iframes. */}
              {visiblePanels.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {t("pluginPanelsSection")}
                  </h4>
                  <PluginHostProvider
                    deviceId={droneId}
                    contributions={visiblePanels}
                  >
                    <PluginSlot
                      name="cockpit.panel"
                      contributions={visiblePanels}
                      className="flex flex-col gap-3"
                      iframeClassName="w-full h-[280px] border border-border-default"
                    />
                  </PluginHostProvider>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
