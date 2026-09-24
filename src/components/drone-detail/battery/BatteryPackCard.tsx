"use client";

/**
 * @module drone-detail/battery/BatteryPackCard
 * @description One battery pack on the Battery page: the per-cell bar with
 * the weakest cell marked, the pack readings, the time-to-reserve prediction
 * and the anomalies currently live on it. A reading the flight controller did
 * not report renders as the no-data glyph, never as a zero.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { AlertOctagon, AlertTriangle } from "lucide-react";

import type { BatteryPack, BatteryPrediction } from "@/lib/agent/schemas/battery";
import { cn, formatDuration } from "@/lib/utils";
import {
  NOT_REPORTED,
  formatRuleValue,
  ruleLabel,
  type BatteryTranslator,
} from "./battery-format";

/** The cell-bar fill spans a LiPo's working range: empty at 3.0 V, full at
 * 4.2 V. Display only; the agent's rules use the configured thresholds. */
const CELL_EMPTY_V = 3.0;
const CELL_FULL_V = 4.2;

const fixed = (value: number | null, digits: number, unit: string) =>
  value === null ? NOT_REPORTED : `${value.toFixed(digits)} ${unit}`;

function CellBar({ pack, t }: { pack: BatteryPack; t: BatteryTranslator }) {
  if (!pack.cells_plausible || pack.cell_voltages_v.length === 0) {
    return (
      <p className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
        {t("cellsNotReported")}
      </p>
    );
  }
  return (
    <div>
      <div className="flex gap-1">
        {pack.cell_voltages_v.map((volts, index) => {
          const weakest = index === pack.weakest_cell_index;
          const fill = Math.min(
            1,
            Math.max(0, (volts - CELL_EMPTY_V) / (CELL_FULL_V - CELL_EMPTY_V)),
          );
          return (
            <div
              key={index}
              role="img"
              aria-label={t("cellLabel", { index: index + 1, volts: volts.toFixed(2) })}
              className={cn(
                "relative flex h-14 flex-1 items-end overflow-hidden rounded border",
                weakest
                  ? "border-status-warning bg-status-warning/10"
                  : "border-border-default bg-bg-tertiary/40",
              )}
            >
              <div
                aria-hidden="true"
                className={cn(
                  "w-full",
                  weakest ? "bg-status-warning/40" : "bg-accent-primary/30",
                )}
                style={{ height: `${fill * 100}%` }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 bottom-1 text-center font-mono text-[10px]",
                  weakest ? "text-status-warning" : "text-text-primary",
                )}
              >
                {volts.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-text-tertiary">
        <span>
          {pack.weakest_cell_index !== null
            ? t("weakestCell", { index: pack.weakest_cell_index + 1 })
            : null}
        </span>
        <span>
          {pack.divergence_mv !== null
            ? t("spread", { mv: Math.round(pack.divergence_mv) })
            : null}
        </span>
      </div>
    </div>
  );
}

function PredictionStrip({
  prediction,
  reservePercent,
  t,
}: {
  prediction: BatteryPrediction;
  reservePercent: number;
  t: BatteryTranslator;
}) {
  const eta = prediction.eta_s === null ? null : formatDuration(prediction.eta_s);
  const { text, tone } = (() => {
    switch (prediction.state) {
      case "past":
        return {
          text: t("predictionPast", { reserve: reservePercent }),
          tone: "text-status-error",
        };
      case "high":
        return eta === null
          ? { text: t("predictionUnknown"), tone: "text-text-tertiary" }
          : {
              text: t("predictionHigh", { eta, reserve: reservePercent }),
              tone: "text-status-warning",
            };
      case "normal":
        return eta === null
          ? { text: t("predictionUnknown"), tone: "text-text-tertiary" }
          : {
              text: t("predictionNormal", { eta, reserve: reservePercent }),
              tone: "text-text-primary",
            };
      default:
        return { text: t("predictionIdle"), tone: "text-text-tertiary" };
    }
  })();
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-text-tertiary">{t("predictionTitle")}</span>
        <span className={cn("font-mono text-xs", tone)}>{text}</span>
      </div>
      {prediction.drop_pct_per_s !== null || prediction.mean_current_a !== null ? (
        <div className="mt-0.5 flex justify-end gap-3 font-mono text-[10px] text-text-tertiary">
          {prediction.drop_pct_per_s !== null ? (
            <span>{t("drainRate", { rate: prediction.drop_pct_per_s.toFixed(2) })}</span>
          ) : null}
          {prediction.mean_current_a !== null ? (
            <span>{t("meanCurrent", { current: prediction.mean_current_a.toFixed(1) })}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BatteryPackCard({
  pack,
  reservePercent,
}: {
  pack: BatteryPack;
  reservePercent: number;
}) {
  const t = useTranslations("batteryHealth");
  const readings: [string, string][] = [
    [t("voltage"), fixed(pack.voltage_v, 2, "V")],
    [t("current"), fixed(pack.current_a, 1, "A")],
    [t("remaining"), pack.remaining_pct === null ? NOT_REPORTED : `${pack.remaining_pct} %`],
    [t("temperature"), fixed(pack.temperature_c, 1, "°C")],
    [t("consumed"), pack.consumed_mah === null ? NOT_REPORTED : `${pack.consumed_mah} mAh`],
    [t("energy"), fixed(pack.consumed_wh, 1, "Wh")],
  ];

  return (
    <section
      className="space-y-3 rounded border border-border-default bg-bg-secondary p-4"
      data-testid={`battery-pack-${pack.id}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">
          {t("packTitle", { id: pack.id })}
        </h3>
        <span className="font-mono text-xs text-text-secondary">
          {fixed(pack.voltage_v, 2, "V")}
          {pack.remaining_pct !== null ? ` · ${pack.remaining_pct} %` : ""}
        </span>
      </div>

      <div>
        <div className="mb-1 text-[11px] text-text-tertiary">{t("cellsTitle")}</div>
        <CellBar pack={pack} t={t} />
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        {readings.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] text-text-tertiary">{label}</dt>
            <dd
              className={cn(
                "font-mono text-xs",
                value === NOT_REPORTED ? "text-text-tertiary" : "text-text-primary",
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <PredictionStrip prediction={pack.prediction} reservePercent={reservePercent} t={t} />

      <div>
        <div className="mb-1 text-[11px] text-text-tertiary">{t("anomaliesTitle")}</div>
        {pack.anomalies.length === 0 ? (
          <p className="text-[11px] text-text-tertiary">{t("anomaliesNone")}</p>
        ) : (
          <ul className="space-y-1">
            {pack.anomalies.map((a) => {
              const critical = a.severity === "critical";
              const Icon = critical ? AlertOctagon : AlertTriangle;
              const tone = critical ? "text-status-error" : "text-status-warning";
              return (
                <li key={a.rule} className="flex items-center gap-2 text-xs">
                  <span role="img" aria-label={t(`severity.${a.severity}`)} className="flex shrink-0">
                    <Icon size={12} aria-hidden="true" className={tone} />
                  </span>
                  <span className={cn("flex-1", tone)}>{ruleLabel(t, a.rule)}</span>
                  <span className="font-mono text-[11px] text-text-secondary">
                    {formatRuleValue(a.rule, a.value)}
                    <span className="text-text-tertiary">
                      {" "}
                      ({t("limit", { threshold: formatRuleValue(a.rule, a.threshold) })})
                    </span>
                  </span>
                  {a.cleared_at_ms !== null ? (
                    <span className="rounded border border-border-default px-1 text-[10px] text-text-tertiary">
                      {t("clearing")}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
