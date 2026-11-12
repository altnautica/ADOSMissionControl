"use client";

/**
 * The skill picker's Tweak panel: the selected skill's manifest `params`,
 * then GO / Stop. Each control is picked from the parameter's manifest
 * schema, never from the cached value's type: an enum is a segmented
 * choice, a number a stepper that steps by the schema `step` and stays
 * inside `minimum`/`maximum`, a boolean a switch, anything else a text box.
 * A value is validated before it is sent and recorded only once the agent
 * accepts it; a refused write leaves the shown value and says so. Labels and
 * option words come from the extension's own locale bundle.
 *
 * @module cockpit/v2/SkillTweakPanel
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { usePluginConfigCache, pluginConfigKey } from "@/lib/plugins/config-cache";
import { resolveNodeAgentReach } from "@/lib/plugins/node-agent-reach";
import { loadPluginLocale, type PluginLocaleBundle } from "@/lib/plugins/plugin-locale";
import { clampValue, defaultFor, inferWidget, validateValue } from "@/lib/plugins/parameters/schema";
import type { PluginParameter } from "@/lib/plugins/parameters/schema";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";
import type { Skill } from "@/lib/skills";
import { specString } from "@/lib/cockpit/spec-strings";
import { isDemoMode } from "@/lib/utils";
import { useDronePluginParameters } from "@/hooks/use-drone-plugin-contributions";

/** A word from the extension's bundle, else the key itself. */
function bundled(strings: PluginLocaleBundle | undefined, key: string): string {
  return strings && Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : key;
}

/** Unit suffixes a parameter key may end in, shown in brackets. */
const KEY_UNITS = new Set(["m", "s", "ms", "deg", "dps", "mps", "hz", "pct"]);

/** A readable label for an unlabelled parameter key:
 *  `orbit_radius_m` → "Orbit radius (m)". */
export function humanizeParamKey(key: string): string {
  const words = key.split(/[_\-.]+/).filter(Boolean);
  if (words.length === 0) return key;
  const unit = words.length > 1 && KEY_UNITS.has(words[words.length - 1].toLowerCase()) ? words.pop() : undefined;
  const text = words.join(" ");
  const head = text.charAt(0).toUpperCase() + text.slice(1);
  return unit ? `${head} (${unit})` : head;
}

/** The Tweak row label: the manifest parameter's `ui.label` (a key into the
 *  extension's locale bundle, or a literal), else the key made readable. */
export function paramLabel(
  params: readonly { key: string; ui?: { label?: string } }[] | undefined,
  key: string,
  strings?: PluginLocaleBundle,
): string {
  const label = params?.find((p) => p.key === key)?.ui?.label;
  return label ? bundled(strings, label) : humanizeParamKey(key);
}

/** The next value of a stepper press: one schema step (1 when none), inside
 *  the schema's bounds. */
export function stepValue(param: PluginParameter, current: number, dir: 1 | -1): number {
  const step = typeof param.schema.step === "number" && param.schema.step > 0 ? param.schema.step : 1;
  const next = clampValue(param.schema, current + dir * step);
  return typeof next === "number" ? next : current;
}

/** The extension's locale bundle for a drone, read once per plugin and language. */
function usePluginStrings(droneId: string, pluginId: string): PluginLocaleBundle | undefined {
  const lang = useLocale();
  const [strings, setStrings] = useState<PluginLocaleBundle | undefined>(undefined);
  useEffect(() => {
    if (!pluginId || isDemoMode()) return;
    const reach = resolveNodeAgentReach(droneId);
    if (!reach) return;
    let alive = true;
    void loadPluginLocale(reach, pluginId, lang).then((b) => {
      if (alive) setStrings(b);
    });
    return () => {
      alive = false;
    };
  }, [droneId, pluginId, lang]);
  return strings;
}

export function SkillTweakPanel({
  droneId,
  skill,
  active,
  starting,
  onGo,
  onStop,
  notify,
}: {
  droneId: string;
  skill: Skill;
  active: boolean;
  starting: boolean;
  onGo: () => void;
  onStop: () => void;
  notify?: (msg: string) => void;
}) {
  const t = useTranslations("plugins.parameters");
  const deviceId = deviceIdFromNodeId(droneId) ?? droneId;
  const pluginId = skill.pluginId ?? "";
  const values = usePluginConfigCache((s) => s.values[pluginConfigKey(deviceId, pluginId)]);
  const manifestParams = useDronePluginParameters(deviceId).find((p) => p.pluginId === pluginId)?.parameters;
  const strings = usePluginStrings(deviceId, pluginId);

  // Validated first; recorded only once the agent took it.
  const write = async (param: PluginParameter | undefined, key: string, raw: unknown) => {
    const value = param ? clampValue(param.schema, raw) : raw;
    if (param && !validateValue(param.schema, value).ok) {
      notify?.(t("invalidValue"));
      return;
    }
    const ok = await writePluginConfigValue({ droneId: deviceId, pluginId, key, value });
    if (ok) usePluginConfigCache.getState().record(deviceId, pluginId, key, value);
    else notify?.(t("agentUnreachable"));
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border-default pt-2" data-testid="tweak-panel">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{specString("skill.tweak")}</h4>
      {(skill.params ?? []).map((key) => {
        const param = manifestParams?.find((p) => p.key === key);
        const cached = values?.[key];
        const label = paramLabel(manifestParams, key, strings);
        const widget = param ? inferWidget(param.schema, param.ui) : "string";
        const shown = cached ?? (param ? defaultFor(param.schema) : undefined);
        return (
          <div key={key} className="flex items-center justify-between gap-2 text-xs" data-param={key} data-widget={widget}>
            <span className="text-text-secondary">{label}</span>
            {param && widget === "enum" ? (
              <span className="flex flex-wrap justify-end gap-1" role="group" aria-label={label}>
                {(param.schema.enum ?? []).map((opt) => {
                  const word = bundled(strings, `${key}.${String(opt)}`);
                  return (
                    <button
                      key={String(opt)}
                      type="button"
                      aria-pressed={shown === opt}
                      className="min-h-12 rounded-[var(--fs-radius-sm)] border px-2 aria-pressed:border-accent-primary"
                      onClick={() => void write(param, key, opt)}
                    >
                      {word === `${key}.${String(opt)}` ? String(opt) : word}
                    </button>
                  );
                })}
              </span>
            ) : param && (widget === "number" || widget === "range") ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`${label} −`}
                  className="min-h-12 min-w-12 rounded-[var(--fs-radius-sm)] border"
                  onClick={() => void write(param, key, stepValue(param, Number(shown), -1))}
                >
                  −
                </button>
                <span className="w-10 text-center tabular-nums">{String(shown)}</span>
                <button
                  type="button"
                  aria-label={`${label} +`}
                  className="min-h-12 min-w-12 rounded-[var(--fs-radius-sm)] border"
                  onClick={() => void write(param, key, stepValue(param, Number(shown), 1))}
                >
                  +
                </button>
              </span>
            ) : param && widget === "boolean" ? (
              <button
                type="button"
                role="switch"
                aria-checked={shown === true}
                aria-label={label}
                className="min-h-12 min-w-12 rounded-[var(--fs-radius-sm)] border px-2"
                onClick={() => void write(param, key, shown !== true)}
              >
                {shown === true ? specString("skill.param.on") : "—"}
              </button>
            ) : (
              <input
                aria-label={label}
                className="min-h-12 w-28 rounded-[var(--fs-radius-sm)] border bg-transparent px-2 py-1"
                defaultValue={shown === undefined ? "" : String(shown)}
                onBlur={(e) => void write(param, key, e.target.value)}
              />
            )}
          </div>
        );
      })}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onGo}
          disabled={active || starting}
          className="min-h-12 flex-1 rounded-[var(--fs-radius-sm)] bg-accent-primary text-sm font-bold text-white disabled:opacity-40"
        >
          {specString(starting ? "skill.starting" : "skill.go")}
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!active}
          className="min-h-12 flex-1 rounded-[var(--fs-radius-sm)] border text-sm font-bold disabled:opacity-40"
        >
          {specString("skill.stop")}
        </button>
      </div>
    </div>
  );
}
