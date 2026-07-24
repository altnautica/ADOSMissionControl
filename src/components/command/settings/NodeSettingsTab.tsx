"use client";

/**
 * @module command/settings/NodeSettingsTab
 * @description The node-detail Settings tab: a two-pane surface (the grouped
 * settings sidebar + the active page) over the settings page registry. Pages
 * organize into Identity / Link & network / Video & vision / Cloud & remote /
 * System & safety — the same sectioned sidebar pattern the Agent page uses —
 * and each page renders the exact same section component the stacked layout
 * used, unchanged. Availability gates (profile fit, the node advertising a
 * feature block) hide a page rather than offering an empty one.
 *
 * Every writable field reads its value from the live agent config and writes
 * back over the LAN with a read-back confirm; the read-only / loading / error
 * banners stay global so every page carries the same transport honesty.
 * @license GPL-3.0-only
 */

import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import {
  NodeSubNav,
  type SubNavSection,
} from "@/components/dashboard/node-detail/agent/NodeSubNav";
import { useNodeConfig } from "./use-node-config";
import {
  SETTINGS_GROUPS,
  SETTINGS_GROUP_ORDER,
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "./settings-nav";

const DEFAULT_PAGE = "profile";

export function NodeSettingsTab({
  droneId,
  profile,
}: {
  droneId: string;
  profile: NodeProfile;
}) {
  const t = useTranslations("nodeSettings");
  const tRoot = useTranslations();
  const { config, loading, readOnly, error, setValue } = useNodeConfig();

  const ctx: SettingsPageContext = useMemo(
    () => ({ droneId, profile, config, readOnly, setValue }),
    [droneId, profile, config, readOnly, setValue],
  );

  const visible = useMemo(
    () => SETTINGS_NAV_ITEMS.filter((i) => (i.when ? i.when(ctx) : true)),
    [ctx],
  );

  const [active, setActive] = useState(DEFAULT_PAGE);
  const activeId = visible.some((i) => i.id === active)
    ? active
    : (visible[0]?.id ?? DEFAULT_PAGE);
  const activeItem = visible.find((i) => i.id === activeId);

  const sections: SubNavSection[] = useMemo(
    () =>
      SETTINGS_GROUP_ORDER.map((key) => ({
        key,
        label: tRoot(SETTINGS_GROUPS[key]),
        items: visible
          .filter((i) => i.group === key)
          .map((i) => ({ id: i.id, label: tRoot(i.labelKey), icon: i.icon })),
      })).filter((s) => s.items.length > 0),
    [visible, tRoot],
  );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <NodeSubNav
        title={t("title")}
        sections={sections}
        activeId={activeId}
        onSelect={setActive}
      />
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="space-y-4 p-4">
          <p className="text-xs text-text-secondary">{t("subtitle")}</p>

          {readOnly ? (
            <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
              {t("readOnlyNoAgent")}
            </div>
          ) : loading && !config ? (
            <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
              {t("loading")}
            </div>
          ) : error ? (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
              {t("loadFailed")}
            </div>
          ) : null}

          {/* Key the page body by node id so a field's local draft / pending
              state (an unsaved value the operator typed) cannot survive a
              switch from node A to B — the fields render the same instances in
              place, so without a remount `draft ?? current` would show A's
              value over B and Apply would write it to the wrong node. The
              active sub-page (`active`) lives outside this key, so the operator
              stays on the same page across the switch. */}
          <Fragment key={droneId}>{activeItem?.render(ctx)}</Fragment>
        </div>
      </div>
    </div>
  );
}
