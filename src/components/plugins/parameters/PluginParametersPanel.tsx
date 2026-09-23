"use client";

/**
 * @module plugins/parameters/PluginParametersPanel
 * @description Renders a plugin's declared parameter contributions as a
 * grouped, schema-driven form for one drone. Each control's committed value is
 * routed by its binding: `plugin.config` writes the per-drone plugin config
 * over the LAN agent (local-first); `engine.detector` (the model widgets)
 * renders the board-filtered ModelPicker, which writes the engine-wide
 * detector itself and reports the new active model back so the form state
 * tracks it; `agent.config` stays read-only here — the native config write
 * router is deferred until a plugin actually declares `binding: agent.config`
 * (no consumer today), so the control renders read-only rather than a false
 * write surface (no fabricated reading) and the write router is built when a consumer lands.
 *
 * The panel owns the form state. A `plugin.config` commit is applied
 * optimistically and rolled back if the agent write does not land, so the
 * surface never shows a value the agent did not accept.
 *
 * Status honesty: the agent exposes a config WRITE
 * (`PUT /api/plugins/{id}/config`) but no config READ, so the GCS cannot fetch
 * a plugin's persisted per-drone config back. When the caller has no confirmed
 * live value for a `plugin.config` parameter, the control seeds from the schema
 * default but is badged "Default — not read from drone" so the operator is
 * never shown a default presented as the drone's live setting. A value the
 * caller passed in `values` (a confirmed source), or one committed this
 * session, is treated as confirmed and the badge clears.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, useState } from "react";

import { useToast } from "@/components/ui/toast";
import {
  defaultFor,
  resolveBinding,
} from "@/lib/plugins/parameters/schema";
import type { ParsedParameterContribution } from "@/lib/plugins/parameters/parse";
import { writePluginConfigValue } from "@/lib/skills/plugin-config-writer";

import { ParameterControl } from "./ParameterControl";

type ParameterValue = string | number | boolean;

interface PluginParametersPanelProps {
  droneId: string;
  pluginId: string;
  parameters: ParsedParameterContribution[];
  /** Confirmed live values keyed by parameter key, from a source that reflects
   * what the agent is actually using (a future config read-back or the deferred
   * cloud mirror). A key present here is rendered as confirmed; a key absent
   * here falls back to the schema default, badged as unconfirmed. */
  values?: Record<string, ParameterValue>;
}

/** Ungrouped parameters collect under this sentinel group (no header). */
const DEFAULT_GROUP = "";

const AGENT_UNREACHABLE = "Couldn't reach the agent to apply this change";

/** Shown on a `plugin.config` control whose displayed value is the schema
 * default rather than a value confirmed to be the drone's live setting. */
const UNCONFIRMED_DEFAULT_NOTE = "Default — not read from drone";

/** Shown on an `agent.config` control: it binds a shared agent-level setting,
 * which this surface renders read-only (the agent owns it), so the disabled
 * state is self-explaining rather than a mysteriously-dead control. */
const AGENT_MANAGED_NOTE = "Agent-managed — read-only here";

export function PluginParametersPanel({
  droneId,
  pluginId,
  parameters,
  values,
}: PluginParametersPanelProps) {
  const { toast } = useToast();

  const [state, setState] = useState<Record<string, ParameterValue>>(() => {
    const seed: Record<string, ParameterValue> = {};
    for (const param of parameters) {
      const provided = values?.[param.key];
      seed[param.key] =
        provided !== undefined ? provided : defaultFor(param.schema);
    }
    return seed;
  });

  // Which `plugin.config` keys carry a confirmed live value vs. a schema
  // default. Seeded from the keys the caller passed in `values`; a commit this
  // session promotes the key to confirmed (we just wrote it, so we know it).
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const param of parameters) {
      seed[param.key] = values?.[param.key] !== undefined;
    }
    return seed;
  });

  // Group parameters by `ui.group`; order groups by first appearance and
  // controls within a group by `ui.order` then declaration order.
  const groups = useMemo(() => {
    const order: string[] = [];
    const buckets = new Map<
      string,
      { param: ParsedParameterContribution; idx: number }[]
    >();
    parameters.forEach((param, idx) => {
      const group = param.ui?.group ?? DEFAULT_GROUP;
      let bucket = buckets.get(group);
      if (!bucket) {
        bucket = [];
        buckets.set(group, bucket);
        order.push(group);
      }
      bucket.push({ param, idx });
    });
    for (const group of order) {
      buckets.get(group)!.sort((a, b) => {
        const oa = a.param.ui?.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.param.ui?.order ?? Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : a.idx - b.idx;
      });
    }
    return order.map((group) => ({
      group,
      items: buckets.get(group)!.map((entry) => entry.param),
    }));
  }, [parameters]);

  const isVisible = useCallback(
    (param: ParsedParameterContribution): boolean => {
      const cond = param.ui?.visible_if;
      if (!cond) return true;
      return state[cond.key] === cond.equals;
    },
    [state],
  );

  const handleCommit = useCallback(
    async (param: ParsedParameterContribution, value: ParameterValue) => {
      const binding = resolveBinding(param);

      // The model widgets (engine.detector) own their write: the ModelPicker
      // already set the engine-wide detector on the agent before reporting the
      // new active id here, so just reflect it in the form state — no second
      // write, no optimistic rollback.
      if (binding === "engine.detector") {
        setState((s) => ({ ...s, [param.key]: value }));
        return;
      }

      // Only the per-drone plugin config writes from this surface; agent.config
      // is read-only here — its native write router is deferred until a plugin
      // declares it (build-when-a-consumer-lands), so this is a documented no-op.
      if (binding !== "plugin.config") return;

      const previous = state[param.key];
      // No change, no write: a re-commit of the shown value (possibly an
      // unconfirmed default) must not overwrite the drone's setting.
      if (value === previous) return;
      const wasConfirmed = confirmed[param.key] ?? false;
      setState((s) => ({ ...s, [param.key]: value }));
      // Optimistically treat the value as confirmed: we just wrote it to the
      // agent, so on success it IS the live value (clearing the default badge).
      setConfirmed((c) => ({ ...c, [param.key]: true }));
      try {
        const ok = await writePluginConfigValue({
          droneId,
          pluginId,
          key: param.key,
          value,
        });
        if (!ok) {
          setState((s) => ({ ...s, [param.key]: previous }));
          setConfirmed((c) => ({ ...c, [param.key]: wasConfirmed }));
          toast(AGENT_UNREACHABLE, "warning");
        }
      } catch {
        setState((s) => ({ ...s, [param.key]: previous }));
        setConfirmed((c) => ({ ...c, [param.key]: wasConfirmed }));
        toast(AGENT_UNREACHABLE, "warning");
      }
    },
    [droneId, pluginId, state, confirmed, toast],
  );

  if (parameters.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ group, items }) => {
        const visible = items.filter(isVisible);
        if (visible.length === 0) return null;
        return (
          <section key={group || "__default"} className="flex flex-col gap-3">
            {group ? (
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                {group}
              </h4>
            ) : null}
            {visible.map((param) => {
              const binding = resolveBinding(param);
              // plugin.config + engine.detector are both live this surface;
              // only agent.config renders read-only.
              const interactive =
                binding === "plugin.config" || binding === "engine.detector";
              // Badge a per-drone config value the GCS could not confirm is
              // the drone's live setting (no agent config read-back exists):
              // the operator sees it is a default, not a verified reading.
              // engine.detector reads its own live model; agent.config is a
              // separate read-only concern — neither is badged here.
              const unconfirmedDefault =
                binding === "plugin.config" && !confirmed[param.key];
              return (
                <div key={param.key} className="flex flex-col gap-1">
                  <ParameterControl
                    param={param}
                    value={state[param.key] ?? defaultFor(param.schema)}
                    disabled={!interactive}
                    droneId={droneId}
                    onCommit={(next) => handleCommit(param, next)}
                  />
                  {unconfirmedDefault ? (
                    <span className="text-[10px] text-text-tertiary italic leading-tight">
                      {UNCONFIRMED_DEFAULT_NOTE}
                    </span>
                  ) : null}
                  {binding === "agent.config" ? (
                    <span className="text-[10px] text-text-tertiary italic leading-tight">
                      {AGENT_MANAGED_NOTE}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
