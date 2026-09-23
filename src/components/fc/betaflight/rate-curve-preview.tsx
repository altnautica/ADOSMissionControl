"use client";

import { useMemo } from "react";
import { CHART_GRID } from "../chart-theme";

/** Betaflight `rates_type` (ratesType_e). */
export const RATES_TYPE = {
  BETAFLIGHT: 0,
  RACEFLIGHT: 1,
  KISS: 2,
  ACTUAL: 3,
  QUICK: 4,
} as const;

export const RATES_TYPE_OPTIONS = [
  { value: String(RATES_TYPE.BETAFLIGHT), label: "Betaflight" },
  { value: String(RATES_TYPE.RACEFLIGHT), label: "RaceFlight" },
  { value: String(RATES_TYPE.KISS), label: "KISS" },
  { value: String(RATES_TYPE.ACTUAL), label: "Actual" },
  { value: String(RATES_TYPE.QUICK), label: "Quick" },
];

/** One axis of a rate profile, in the raw MSP_RC_TUNING units. */
export interface AxisRates {
  /** rcRates[axis] */
  rcRate: number;
  /** rcExpo[axis] */
  expo: number;
  /** rates[axis] (super rate / max rate, depending on the type) */
  superRate: number;
  /** rate_limit[axis], deg/s */
  rateLimit: number;
}

/** Firmware SETPOINT_RATE_LIMIT_MAX, deg/s. */
const SETPOINT_RATE_LIMIT = 1998;
const RC_RATE_INCREMENTAL = 14.54;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function betaflightRate(r: AxisRates, cmd: number, abs: number): number {
  let x = cmd;
  if (r.expo) {
    const expof = r.expo / 100;
    x = cmd * abs ** 3 * expof + cmd * (1 - expof);
  }
  let rcRate = r.rcRate / 100;
  if (rcRate > 2) rcRate += RC_RATE_INCREMENTAL * (rcRate - 2);
  let angleRate = 200 * rcRate * x;
  if (r.superRate) angleRate *= 1 / clamp(1 - abs * (r.superRate / 100), 0.01, 1);
  return angleRate;
}

function raceflightRate(r: AxisRates, cmd: number, abs: number): number {
  const x = (1 + 0.01 * r.expo * (cmd * cmd - 1)) * cmd;
  return 10 * r.rcRate * x * (1 + abs * r.superRate * 0.01);
}

function kissRate(r: AxisRates, cmd: number, abs: number): number {
  const curve = r.expo / 100;
  const useRates = 1 / clamp(1 - abs * (r.superRate / 100), 0.01, 1);
  const x = (cmd ** 3 * curve + cmd * (1 - curve)) * (r.rcRate / 1000);
  return clamp(2000 * useRates * x, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
}

function actualRate(r: AxisRates, cmd: number, abs: number): number {
  const e = r.expo / 100;
  const expof = abs * (cmd ** 5 * e + cmd * (1 - e));
  const center = r.rcRate * 10;
  const stickMovement = Math.max(0, r.superRate * 10 - center);
  return cmd * center + stickMovement * expof;
}

/** Quick rates with `quick_rates_rc_expo` off (its firmware default). */
function quickRate(r: AxisRates, cmd: number, abs: number): number {
  const rcRate = r.rcRate * 2;
  if (rcRate === 0) return 0;
  const maxDps = Math.max(r.superRate * 10, rcRate);
  const expof = r.expo / 100;
  const superFactorConfig = (maxDps / rcRate - 1) / (maxDps / rcRate);
  const curve = abs ** 3 * expof + abs * (1 - expof);
  const superFactor = 1 / clamp(1 - curve * superFactorConfig, 0.01, 1);
  return clamp(cmd * rcRate * superFactor, -SETPOINT_RATE_LIMIT, SETPOINT_RATE_LIMIT);
}

/**
 * Setpoint rate (deg/s) for a stick deflection `rcCommand` in -1..1, as the
 * flight controller computes it for the profile's `rates_type`, limited by
 * the axis `rate_limit`.
 */
export function applyRates(ratesType: number, r: AxisRates, rcCommand: number): number {
  const cmd = clamp(rcCommand, -1, 1);
  const abs = Math.abs(cmd);
  let rate: number;
  switch (ratesType) {
    case RATES_TYPE.RACEFLIGHT: rate = raceflightRate(r, cmd, abs); break;
    case RATES_TYPE.KISS: rate = kissRate(r, cmd, abs); break;
    case RATES_TYPE.ACTUAL: rate = actualRate(r, cmd, abs); break;
    case RATES_TYPE.QUICK: rate = quickRate(r, cmd, abs); break;
    default: rate = betaflightRate(r, cmd, abs);
  }
  return clamp(rate, -r.rateLimit, r.rateLimit);
}

const CURVE_W = 280;
const CURVE_H = 160;
const CURVE_PAD = 28;

export interface CurveData {
  label: string;
  color: string;
  rates: AxisRates;
}

export function RateCurvePreview({ ratesType, curves }: { ratesType: number; curves: CurveData[] }) {
  const maxRate = useMemo(() => {
    let max = 0;
    for (const c of curves) {
      const r = Math.abs(applyRates(ratesType, c.rates, 1));
      if (r > max) max = r;
    }
    return Math.max(max, 100);
  }, [ratesType, curves]);

  const plotW = CURVE_W - CURVE_PAD * 2;
  const plotH = CURVE_H - CURVE_PAD * 2;

  return (
    <div className="border border-border-default bg-bg-tertiary/30 p-2">
      <svg width={CURVE_W} height={CURVE_H} className="block">
        <line x1={CURVE_PAD} y1={CURVE_H - CURVE_PAD} x2={CURVE_W - CURVE_PAD} y2={CURVE_H - CURVE_PAD} stroke={CHART_GRID} strokeWidth={1} />
        <line x1={CURVE_PAD} y1={CURVE_PAD} x2={CURVE_PAD} y2={CURVE_H - CURVE_PAD} stroke={CHART_GRID} strokeWidth={1} />
        <text x={CURVE_W / 2} y={CURVE_H - 4} textAnchor="middle" className="text-[8px] fill-text-tertiary">Stick %</text>
        <text x={8} y={CURVE_H / 2} textAnchor="middle" className="text-[8px] fill-text-tertiary" transform={`rotate(-90, 8, ${CURVE_H / 2})`}>deg/s</text>
        {[0.25, 0.5, 0.75].map((frac) => (
          <line key={`h-${frac}`} x1={CURVE_PAD} y1={CURVE_H - CURVE_PAD - plotH * frac} x2={CURVE_W - CURVE_PAD} y2={CURVE_H - CURVE_PAD - plotH * frac} stroke={CHART_GRID} strokeWidth={0.5} strokeDasharray="2,3" />
        ))}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line key={`v-${frac}`} x1={CURVE_PAD + plotW * frac} y1={CURVE_PAD} x2={CURVE_PAD + plotW * frac} y2={CURVE_H - CURVE_PAD} stroke={CHART_GRID} strokeWidth={0.5} strokeDasharray="2,3" />
        ))}
        {[0, 0.5, 1].map((frac) => (
          <text key={`yt-${frac}`} x={CURVE_PAD - 3} y={CURVE_H - CURVE_PAD - plotH * frac + 3} textAnchor="end" className="text-[7px] fill-text-tertiary font-mono">{Math.round(maxRate * frac)}</text>
        ))}
        {[0, 50, 100].map((pct) => (
          <text key={`xt-${pct}`} x={CURVE_PAD + plotW * (pct / 100)} y={CURVE_H - CURVE_PAD + 12} textAnchor="middle" className="text-[7px] fill-text-tertiary font-mono">{pct}</text>
        ))}
        {curves.map((c) => {
          const points: string[] = [];
          const steps = 50;
          for (let i = 0; i <= steps; i++) {
            const rc = i / steps;
            const rate = Math.abs(applyRates(ratesType, c.rates, rc));
            const x = CURVE_PAD + (rc * plotW);
            const y = CURVE_H - CURVE_PAD - (rate / maxRate) * plotH;
            points.push(`${x},${y}`);
          }
          return <polyline key={c.label} points={points.join(" ")} fill="none" stroke={c.color} strokeWidth={1.5} />;
        })}
      </svg>
      <div className="flex gap-3 mt-1 px-1">
        {curves.map((c) => (
          <div key={c.label} className="flex items-center gap-1">
            <div className="w-2 h-0.5" style={{ backgroundColor: c.color }} />
            <span className="text-[9px] text-text-secondary">{c.label}: {Math.round(Math.abs(applyRates(ratesType, c.rates, 1)))} deg/s</span>
          </div>
        ))}
      </div>
    </div>
  );
}
