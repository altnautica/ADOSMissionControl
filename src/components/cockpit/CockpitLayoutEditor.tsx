/**
 * The cockpit layout section of the Skill Bar editor: for each widget the
 * registry marks arrangeable (the chips + any plugin cockpit widget), a zone
 * picker + a show/hide toggle, so the operator can place it in any corner or
 * hide it. Both persist on the active loadout.
 *
 * Accessible: each widget row pairs a labelled zone `<Select>` with a labelled
 * switch button (role="switch", aria-checked), reachable and toggleable by
 * keyboard, with a non-colour state cue (the knob position + an On/Off label).
 *
 * A toggle only shows or hides; density is separate. A card that is on but
 * thinned out by the active density says "Hidden at this density" in place
 * of "On", so the editor never claims a card is showing when it is not.
 *
 * @module fly/CockpitLayoutEditor
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import {
  DEFAULT_LOADOUT_ID,
  cloneDefaultCockpitLayout,
  type CockpitLayout,
} from "@/stores/settings/keybindings-slice";
import { COCKPIT_ZONES, type CockpitZone } from "@/lib/cockpit/zones";
import {
  effectiveWidgetZone,
  isCockpitWidgetEnabled,
  useCockpitWidgetRegistry,
  widgetMeetsDensity,
  type CockpitWidget,
} from "@/lib/cockpit/widget-registry";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";


/** Each zone's i18n label key. */
const ZONE_LABEL_KEY: Record<CockpitZone, string> = {
  "top-left": "zoneTopLeft",
  "top-center": "zoneTopCenter",
  "top-right": "zoneTopRight",
  left: "zoneLeft",
  center: "zoneCenter",
  right: "zoneRight",
  "bottom-left": "zoneBottomLeft",
  "bottom-center": "zoneBottomCenter",
  "bottom-right": "zoneBottomRight",
  full: "zoneFull",
};

/** A reusable on/off switch button (the same shape both sections use). */
function SwitchButton({
  on,
  densityHidden,
  onClick,
  ariaLabel,
  children,
  stateLabel,
}: {
  on: boolean;
  /** On, but the active density keeps it off screen. */
  densityHidden: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  /** Visible state text (On / Off / Hidden at this density). */
  stateLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={onClick}
      data-density-hidden={densityHidden || undefined}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md border bg-bg-tertiary px-2.5 py-2 text-left text-xs transition-colors duration-200 ease-out motion-reduce:transition-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        on && !densityHidden
          ? "border-accent-primary/60 text-text-primary"
          : "border-border-default text-text-secondary hover:border-border-strong",
      )}
    >
      <span className="truncate">{children}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn(
            "font-mono text-[9px] uppercase tracking-wide",
            on && !densityHidden ? "text-accent-primary" : "text-text-tertiary",
          )}
        >
          {stateLabel}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "relative h-4 w-7 rounded-full border transition-colors duration-200 ease-out motion-reduce:transition-none",
            on
              ? "border-accent-primary bg-accent-primary/30"
              : "border-border-default bg-bg-secondary",
            densityHidden && "opacity-60",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all duration-200 ease-out motion-reduce:transition-none",
              on ? "left-3.5 bg-accent-primary" : "left-0.5 bg-text-tertiary",
            )}
          />
        </span>
      </span>
    </button>
  );
}

export function CockpitLayoutEditor() {
  const t = useTranslations("skillBindings");
  const tl = useTranslations("cockpit.layout");

  const loadouts = useSettingsStore((s) => s.loadouts);
  const activeLoadoutId = useSettingsStore((s) => s.activeLoadoutId);
  const setLoadoutWidget = useSettingsStore((s) => s.setLoadoutWidget);

  // The registered widgets: the arrangeable ones get a row.
  const items = useCockpitWidgetRegistry((s) => s.items);
  const arrangeable = useMemo(() => {
    const all = items.size ? useCockpitWidgetRegistry.getState().resolve() : [];
    return all.filter((w) => w.arrangeable === true);
  }, [items]);

  const loadout = loadouts[activeLoadoutId] ?? loadouts[DEFAULT_LOADOUT_ID];
  const layout = loadout?.layout ?? cloneDefaultCockpitLayout();

  const zoneOptions = useMemo(
    () => COCKPIT_ZONES.map((z) => ({ value: z, label: t(ZONE_LABEL_KEY[z]) })),
    [t],
  );

  if (!loadout) return null;

  const stateLabel = (on: boolean, densityHidden: boolean) =>
    densityHidden ? tl("hiddenAtDensity") : on ? t("layoutOn") : t("layoutOff");

  return (
    <>
      {arrangeable.length > 0 && (
        <section
          className="rounded-xl border border-border-default bg-bg-secondary p-2.5"
          aria-label={t("widgetsSectionLabel")}
        >
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            {t("widgetsSectionTitle")}
          </h4>
          <p className="mb-2 text-[11px] text-text-tertiary">
            {t("widgetsHint")}
          </p>

          <div role="group" aria-label={t("widgetsSectionLabel")} className="flex flex-col gap-2">
            {arrangeable.map((w) => {
              const name = w.title ?? w.id;
              const zone = effectiveWidgetZone(w, layout);
              const on = isCockpitWidgetEnabled(w, layout);
              const densityHidden = on && !widgetMeetsDensity(w, layout.density);
              return (
                <div key={w.id} className="flex items-end gap-1.5">
                  <div className="min-w-0 flex-1">
                    <Select
                      label={t("widgetZoneLabel", { widget: name })}
                      options={zoneOptions}
                      value={zone}
                      onChange={(v) =>
                        setLoadoutWidget(loadout.id, w.id, {
                          zone: v as CockpitZone,
                        })
                      }
                    />
                  </div>
                  <SwitchButton
                    on={on}
                    densityHidden={densityHidden}
                    onClick={() =>
                      setLoadoutWidget(loadout.id, w.id, { hidden: on })
                    }
                    ariaLabel={
                      on
                        ? t("widgetHide", { widget: name })
                        : t("widgetShow", { widget: name })
                    }
                    stateLabel={stateLabel(on, densityHidden)}
                  >
                    {name}
                  </SwitchButton>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
