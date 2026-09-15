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

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useUiStore } from "@/stores/ui-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import { useNodeConfig } from "@/components/command/settings/use-node-config";
import { useStableRelayReach } from "@/hooks/use-stable-relay-reach";
import type { SettingsPageContext } from "@/components/command/settings/settings-nav";
import type { SurfaceContext } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import { NodeSubNav, type SubNavSection } from "./NodeSubNav";
import { AgentShowcase } from "./AgentShowcase";
import { resolveAgentNav, resolveSubpage } from "./agent-nav-sections";
import { SurfaceErrorBoundary, SurfaceBody } from "../SurfaceErrorBoundary";
import { SegmentedPane } from "../SegmentedPane";

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
  // The node this page is rendered FOR — direct reach when the GCS has it,
  // else the relayed drone's own peer id. Passed explicitly so the config
  // surface can never read or write the previously focused node: the singleton
  // connection store lags this render (focus is applied asynchronously, and a
  // failed connect or a node with no LAN credentials leaves the prior client
  // attached).
  const nodeDeviceId = surfaceNodeDeviceId(ctx);
  // `ctx.relayReach` is re-minted every render; the pages that resolve their
  // own transport from it need a stable reference or their effects re-fire on
  // every parent render.
  const relayReach = useStableRelayReach(ctx.relayReach);
  const { config, loading, readOnly, error, setValue } = useNodeConfig(
    nodeDeviceId,
    relayReach,
  );

  const [active, setActive] = useState(
    () =>
      useUiPrefsStore.getState().getLastAgentPanel(ctx.droneId) ?? DEFAULT_PANEL,
  );
  // Reseed on a node switch. The panel is not remounted per node, so a
  // mount-only initializer kept node A's sub-page on node B and the persist
  // effect then wrote it into B's record.
  const seededForNode = useRef(ctx.droneId);
  if (seededForNode.current !== ctx.droneId) {
    seededForNode.current = ctx.droneId;
    setActive(
      useUiPrefsStore.getState().getLastAgentPanel(ctx.droneId) ??
        DEFAULT_PANEL,
    );
  }

  const profile = ctx.drone.profile ?? "drone";
  const settingsCtx: SettingsPageContext = useMemo(
    () => ({
      droneId: ctx.droneId,
      nodeDeviceId,
      relayReach,
      profile,
      config,
      readOnly,
      setValue,
    }),
    [
      ctx.droneId,
      nodeDeviceId,
      relayReach,
      profile,
      config,
      readOnly,
      setValue,
    ],
  );

  const { sections, entries } = useMemo(
    () => resolveAgentNav(ctx, settingsCtx),
    [ctx, settingsCtx],
  );
  // A persisted or deep-linked id that this node does not offer (a page whose
  // gate closed, or one renamed out from under the stored value) falls back to
  // the first visible entry rather than rendering an empty pane.
  //
  // A retired "…-config" id resolves to the live page that absorbed it, with
  // the Setup segment named — so a deep link to the old page lands on the
  // half the operator asked for, not the live view beside it.
  const requested = resolveSubpage(active);
  const activeItem =
    entries.find((e) => e.id === requested.id) ?? entries[0];
  const activeId = activeItem?.id ?? DEFAULT_PANEL;
  // The fallback fired: the operator asked for a page this node does not
  // offer. Saying so is the difference between "the vision page is empty" and
  // "you are reading the Health page".
  const requestedMissing = entries.length > 0 && activeId !== requested.id;

  // Consume a deep-link handoff (a persisted or Cmd+K jump to a now-nested id).
  useEffect(() => {
    if (pendingAgentPanel) {
      setActive(pendingAgentPanel);
      setPendingAgentPanel(null);
    }
  }, [pendingAgentPanel, setPendingAgentPanel]);

  // Remember the last sub-page per node so re-opening the Agent page returns
  // to it — but only when the node actually offered it. Writing the FALLBACK
  // id here is what destroyed the remembered position whenever a gate closed
  // transiently: toggling the World Model feature off while parked on it
  // rewrote the record to Health, and toggling it back on did not restore it.
  useEffect(() => {
    if (requestedMissing) return;
    useUiPrefsStore.getState().setLastAgentPanel(ctx.droneId, activeId);
  }, [ctx.droneId, activeId, requestedMissing]);

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
  //
  // Logs are the one sub-page that works without a companion (they read the
  // GCS history store), and the row menu offers "View logs" on every profile.
  // The pending-panel effect above has already consumed and cleared the
  // request by the time this branch runs, so the showcase has to honour it —
  // otherwise a deep link to Logs lands on a "pair a computer" upsell and the
  // request is silently discarded.
  const noCompanion =
    profile === "drone" && ctx.agentDeviceId === null && ctx.relayReach === null;
  if (noCompanion) {
    return (
      <AgentShowcase droneId={ctx.droneId} initialShowLogs={active === "logs"} />
    );
  }

  // The scrolling pane, subtitle and transport banners every configuration
  // page renders inside. Shared by a standalone config row and by the Setup
  // segment of a merged subsystem, so a merged page is not a second-class
  // one that silently loses its banners.
  const configChrome = (pane: {
    readsConfig: boolean;
    render: () => ReactNode;
  }) => (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="space-y-4 p-4">
        <p className="text-xs text-text-secondary">
          {ctx.relayReach !== null ? t("subtitleRelayed") : t("subtitle")}
        </p>

        {pane.readsConfig ? (
          <ConfigBanner
            readOnly={readOnly}
            firstLoad={loading && config === null}
            failed={error !== null}
          />
        ) : null}

        {/* Key the page body by node id so a field's local draft / pending
            state (an unsaved value the operator typed) cannot survive a switch
            from node A to B — the fields render the same instances in place,
            so without a remount `draft ?? current` would show A's value over B
            and Apply would write it to the wrong node. The active sub-page
            lives outside this key, so the operator stays on the same page
            across the switch. */}
        <Fragment key={ctx.droneId}>
          <SurfaceBody render={pane.render} />
        </Fragment>
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <NodeSubNav
        title={tRoot("dronePanel.agent")}
        sections={subNavSections}
        activeId={activeId}
        onSelect={setActive}
      />
      <div
        id="node-subnav-panel"
        tabIndex={-1}
        className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col"
      >
        {requestedMissing && (
          <div className={`m-3 ${NOTE_MUTED}`} role="status">
            {t("pageUnavailableHere", { page: active })}
          </div>
        )}
        {/* One boundary per SUB-PAGE, keyed by its id — not one around the
            whole Agent page. A single outer boundary made the sidebar a child
            of the thing that threw, so any render error in one page replaced
            the entire configuration surface (navigation included) with a
            generic card, leaving no way to reach a working page, and "Try
            again" re-mounted the same failing page forever. Keying by id also
            clears the caught error the moment the operator picks another
            page. */}
        <SurfaceErrorBoundary
          key={activeId}
          message={tRoot("dronePanel.surfaceError")}
          retryLabel={tRoot("dronePanel.surfaceErrorRetry")}
        >
          {activeItem?.setup ? (
            // A merged subsystem: one row, two segments. Keyed by the
            // requested segment so a deep link to the retired "…-config" id
            // opens on Setup rather than the live view beside it.
            <SegmentedPane
              key={`${activeId}:${requested.segment}`}
              ariaLabel={tRoot(activeItem.labelKey)}
              initialId={requested.segment}
              segments={[
                {
                  id: "live",
                  label: t("segmentLive"),
                  render: () => <SurfaceBody render={activeItem.render} />,
                },
                {
                  id: "setup",
                  label: t("segmentSetup"),
                  render: () => configChrome(activeItem.setup!),
                },
              ]}
            />
          ) : activeItem?.isConfigPage ? (
            configChrome({
              readsConfig: activeItem.readsConfig,
              render: activeItem.render,
            })
          ) : activeItem ? (
            <SurfaceBody render={activeItem.render} />
          ) : null}
        </SurfaceErrorBoundary>
      </div>
    </div>
  );
}
