"use client";

/**
 * @module ChannelHistoryChart
 * @description Hop-history sparkline for the Hardware Radio page. Renders
 * the channel-vs-time path the HopSupervisor has taken over the recent
 * past, with scatter markers per hop colour-coded by trigger (periodic
 * vs reactive) and outcome (success vs failed). Data comes from
 * `/api/video/config` → `hopping.history` polled at 1 Hz by the
 * surrounding VideoLinkPanel.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export type HopEntry = {
  at: number; // unix seconds
  from: number; // channel before
  to: number; // channel after
  trigger: "periodic" | "reactive" | string;
  ok: boolean;
};

export type HoppingState = {
  enabled: boolean;
  band: string | null;
  hop_period_seconds: number | null;
  history: HopEntry[];
  last_hop_at?: number;
};

type Props = {
  hopping: HoppingState | undefined;
  currentChannel: number | null;
};

type ChartPoint = {
  // Seconds since the first sample, used as the X axis numeric value.
  t: number;
  // Channel number on Y axis.
  channel: number;
  trigger: string;
  ok: boolean;
  fromChannel: number;
  // ISO timestamp for the tooltip.
  ts: string;
};

const COLOR_PERIODIC_OK = "#22c55e"; // green
const COLOR_REACTIVE_OK = "#f59e0b"; // amber
const COLOR_FAILED = "#ef4444"; // red
const COLOR_LINE = "#6B7280"; // neutral grey for the step path

function colorFor(trigger: string, ok: boolean): string {
  if (!ok) return COLOR_FAILED;
  if (trigger === "reactive") return COLOR_REACTIVE_OK;
  return COLOR_PERIODIC_OK;
}

export function ChannelHistoryChart({ hopping, currentChannel }: Props) {
  const t = useTranslations("hardware.radio.hopping");

  // Empty state: the supervisor is armed but has not fired a hop yet,
  // or the agent doesn't expose the hopping block. Render a placeholder
  // line at the current channel so the operator can see "armed, quiet".
  const history = hopping?.history ?? [];
  if (history.length === 0) {
    return (
      <section className="rounded border border-border-default bg-bg-primary p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-primary">
            {t("title")}
          </span>
          {hopping?.band ? (
            <span className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary">
              {hopping.band}
            </span>
          ) : null}
        </div>
        <div className="text-[11px] font-mono text-text-tertiary">
          {t("noHops")}
          {currentChannel != null
            ? ` · ${t("currentChannel")} ${currentChannel}`
            : null}
        </div>
      </section>
    );
  }

  // Normalize to seconds-from-start so the X axis is numeric and stable
  // even when only one or two hops have happened. Newest hop is on the
  // right edge.
  const t0 = history[0].at;
  const data: ChartPoint[] = history.map((h) => ({
    t: Math.max(0, h.at - t0),
    channel: h.to,
    trigger: h.trigger,
    ok: h.ok,
    fromChannel: h.from,
    ts: new Date(h.at * 1000).toLocaleTimeString(),
  }));

  // Auto-domain on the Y axis with a small pad so the marker doesn't
  // sit on the axis line.
  const channels = data.map((d) => d.channel);
  if (currentChannel != null) channels.push(currentChannel);
  const yMin = Math.max(1, Math.min(...channels) - 4);
  const yMax = Math.min(165, Math.max(...channels) + 4);

  const lastEntry = history[history.length - 1];
  const lastTime = new Date(lastEntry.at * 1000).toLocaleTimeString();

  return (
    <section className="rounded border border-border-default bg-bg-primary p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-primary">
          {t("title")}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary">
          {hopping?.band ?? ""} · {history.length} {t("hops")}
        </span>
      </div>
      <div className="relative" style={{ width: "100%", height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 6, right: 8, bottom: 18, left: 28 }}
          >
            <XAxis
              type="number"
              dataKey="t"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => `${Math.round(v)}s`}
              tick={{ fontSize: 9, fill: "#9CA3AF" }}
              stroke="#374151"
            />
            <YAxis
              type="number"
              domain={[yMin, yMax]}
              tickFormatter={(v) => String(v)}
              tick={{ fontSize: 9, fill: "#9CA3AF" }}
              stroke="#374151"
              width={28}
            />
            {currentChannel != null ? (
              <ReferenceLine
                y={currentChannel}
                stroke="#3A82FF"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            ) : null}
            <Line
              type="stepAfter"
              dataKey="channel"
              stroke={COLOR_LINE}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Scatter
              dataKey="channel"
              shape={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null || payload == null) {
                  return <g />;
                }
                const c = colorFor(payload.trigger, payload.ok);
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3.5}
                    fill={c}
                    stroke="#0B1320"
                    strokeWidth={1}
                  />
                );
              }}
              isAnimationActive={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0B1320",
                border: "1px solid #374151",
                fontSize: 11,
                fontFamily: "monospace",
              }}
              labelFormatter={(_, items) => {
                const p = items?.[0]?.payload as ChartPoint | undefined;
                return p ? p.ts : "";
              }}
              formatter={(_v, _name, item) => {
                const p = item?.payload as ChartPoint | undefined;
                if (!p) return ["", ""];
                const trigger = p.trigger === "reactive"
                  ? t("trigger.reactive")
                  : t("trigger.periodic");
                const status = p.ok ? t("status.success") : t("status.failed");
                return [
                  `${p.fromChannel} → ${p.channel} · ${trigger} · ${status}`,
                  "",
                ];
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-text-tertiary">
        <span>
          {t("lastHop")}: {lastTime} ({lastEntry.from} → {lastEntry.to})
        </span>
        <div className="flex items-center gap-3">
          <Legend color={COLOR_PERIODIC_OK} label={t("trigger.periodic")} />
          <Legend color={COLOR_REACTIVE_OK} label={t("trigger.reactive")} />
          <Legend color={COLOR_FAILED} label={t("status.failed")} />
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block rounded-full"
        style={{ width: 8, height: 8, backgroundColor: color }}
      />
      <span>{label}</span>
    </span>
  );
}
