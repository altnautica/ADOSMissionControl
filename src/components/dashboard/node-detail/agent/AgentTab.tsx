"use client";

/**
 * @module node-detail/agent/AgentTab
 * @description The Agent page: a two-pane surface (ONE sectioned secondary
 * sidebar + the active sub-page) that collapses every companion-computer
 * surface and every node configuration page behind one node-detail tab. For a
 * drone with no companion paired it renders the onboarding showcase instead of
 * the sidebar. The active sub-page is remembered per node and can be deep-linked
 * via the panel's pendingAgentPanel handoff.
 *
 * The configuration pages used to hang off a `settings` sub-page that carried a
 * third sidebar of its own. They are hoisted into this one, so this component
 * now owns what that host owned: the single `useNodeConfig()` call feeding every
 * config page and its availability gate, the transport banners — scoped to the
 * pages that actually read the config — and the per-node key that stops one
 * node's unsaved field draft from being applied to another.
 * @license GPL-3.0-only
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useUiStore } from "@/stores/ui-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import { useNodeConfig } from "@/components/command/settings/use-node-config";
import type { SettingsPageContext } from "@/components/command/settings/settings-nav";
import type { SurfaceContext } from "../surface-types";
import { NodeSubNav, type SubNavSection } from "./NodeSubNav";
import { AgentShowcase } from "./AgentShowcase";
import { resolveAgentNav } from "./agent-nav-sections";

const DEFAULT_PANEL = "system";

const NOTE_MUTED =
  "rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary";
const NOTE_ERROR =
  "rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error";

/**
 * The config-transport banner: no path to the node, a first read in flight, or
 * a read that failed. Rendered only above a page that reads the node config —
 * "Could not read the node configuration" over Health, Logs, Wi-Fi or Operating
 * region would be a false alarm about a document those pages never open.
 */
function ConfigBanner({
  readOnly,
  firstLoad,
  failed,
}: {
  readOnly: boolean;
  firstLoad: boolean;
  failed: boolean;
}) {
  const t = useTranslations("nodeSettings");
  if (readOnly) return <div className={NOTE_MUTED}>{t("readOnlyNoAgent")}</div>;
  if (firstLoad) return <div className={NOTE_MUTED}>{t("loading")}</div>;
  if (failed) return <div className={NOTE_ERROR}>{t("loadFailed")}</div>;
  return null;
}

export function AgentTab({ ctx }: { ctx: SurfaceContext }) {
  const t = useTranslations("nodeSettings");
  const tRoot = useTranslations();
  const pendingAgentPanel = useUiStore((s) => s.pendingAgentPanel);
  const setPendingAgentPanel = useUiStore((s) => s.setPendingAgentPanel);
  // Pass the relay reach straight in: a drone reached only through its ground
  // station's relay-proxy has a real config path, so its pages must be writable
  // rather than banner-ed as unreachable. The hook re-keys the reach on its own
  // fields, so this identity-unstable object needs no memo here.
  const { config, loading, readOnly, error, setValue } = useNodeConfig(
    ctx.relayReach,
  );

  const [active, setActive] = useState(
    () =>
      useUiPrefsStore.getState().getLastAgentPanel(ctx.droneId) ?? DEFAULT_PANEL,
  );

  const profile = ctx.drone.profile ?? "drone";
  const settingsCtx: SettingsPageContext = useMemo(
    () => ({ droneId: ctx.droneId, profile, config, readOnly, setValue }),
    [ctx.droneId, profile, config, readOnly, setValue],
  );

  const { sections, entries } = useMemo(
    () => resolveAgentNav(ctx, settingsCtx),
    [ctx, settingsCtx],
  );

  // A persisted or deep-linked id that this node does not offer (a page whose
  // gate closed, or one renamed out from under the stored value) falls back to
  // the first visible entry rather than rendering an empty pane.
  const activeItem = entries.find((e) => e.id === active) ?? entries[0];
  const activeId = activeItem?.id ?? DEFAULT_PANEL;

  // Consume a deep-link handoff (a persisted or Cmd+K jump to a now-nested id).
  useEffect(() => {
    if (pendingAgentPanel) {
      setActive(pendingAgentPanel);
      setPendingAgentPanel(null);
    }
  }, [pendingAgentPanel, setPendingAgentPanel]);

  // Remember the last sub-page per node so re-opening the Agent page returns to it.
  useEffect(() => {
    useUiPrefsStore.getState().setLastAgentPanel(ctx.droneId, activeId);
  }, [ctx.droneId, activeId]);

  const subNavSections: SubNavSection[] = useMemo(
    () =>
      sections.map((section) => ({
        key: section.key,
        label: tRoot(section.labelKey),
        items: section.items.map((entry) => ({
          id: entry.id,
          label: tRoot(entry.labelKey),
          icon: entry.icon,
        })),
      })),
    [sections, tRoot],
  );

  // A drone with no companion the GCS can reach: sell what an onboard computer
  // unlocks rather than showing a near-empty page. A drone reached through its
  // ground station's relay-proxy DOES have one, and every sub-page below reads
  // it over that lane, so it must not land here.
  const noCompanion =
    profile === "drone" && ctx.agentDeviceId === null && ctx.relayReach === null;
  if (noCompanion) {
    return <AgentShowcase droneId={ctx.droneId} />;
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <NodeSubNav
        title={tRoot("dronePanel.agent")}
        sections={subNavSections}
        activeId={activeId}
        onSelect={setActive}
      />
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {activeItem?.isConfigPage ? (
          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="space-y-4 p-4">
              <p className="text-xs text-text-secondary">
                {ctx.relayReach !== null ? t("subtitleRelayed") : t("subtitle")}
              </p>

              {activeItem.readsConfig ? (
                <ConfigBanner
                  readOnly={readOnly}
                  firstLoad={loading && config === null}
                  failed={error !== null}
                />
              ) : null}

              {/* Key the page body by node id so a field's local draft / pending
                  state (an unsaved value the operator typed) cannot survive a
                  switch from node A to B — the fields render the same instances
                  in place, so without a remount `draft ?? current` would show
                  A's value over B and Apply would write it to the wrong node.
                  The active sub-page (`active`) lives outside this key, so the
                  operator stays on the same page across the switch. */}
              <Fragment key={ctx.droneId}>{activeItem.render()}</Fragment>
            </div>
          </div>
        ) : (
          activeItem?.render()
        )}
      </div>
    </div>
  );
}
