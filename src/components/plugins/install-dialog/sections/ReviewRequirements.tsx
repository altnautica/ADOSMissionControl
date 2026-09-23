/**
 * @module ReviewRequirements
 * @description The requirements section of the install review: forecast
 * resource impact, hardware requirements, and per-firmware FC parameter
 * hints.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";

import type { InstallManifestSummary } from "../types";

import { SectionLabel } from "./SectionLabel";

/** The requirements block: forecast resource impact, hardware requirements,
 * and per-firmware FC parameter hints. Renders nothing when the plugin
 * declares none of them. */
export function RequirementsSection({
  manifest,
}: {
  manifest: InstallManifestSummary;
}) {
  const t = useTranslations("pluginInstall.review");
  const impact = manifest.resourceImpact;
  const hasHardware = hasHardwareRequirements(manifest);
  const hasParams = hasFcParameters(manifest);
  if (!impact && !hasHardware && !hasParams) return null;
  return (
    <section>
      <SectionLabel label={t("requirements.title")} />
      <div className="space-y-4">
        {impact && <ResourceImpactSection impact={impact} />}
        {hasHardware && <HardwareRequirements manifest={manifest} />}
        {hasParams && <FcParametersTable manifest={manifest} />}
      </div>
    </section>
  );
}

function ResourceImpactSection({
  impact,
}: {
  impact: NonNullable<InstallManifestSummary["resourceImpact"]>;
}) {
  const t = useTranslations("pluginInstall.review.resourceGrid");
  const cells: Array<{ label: string; value: string }> = [];
  if (typeof impact.outputRateHz === "number") {
    cells.push({
      label: t("output"),
      value: `${impact.outputRateHz} ${t("units.hz")}`,
    });
  } else if (typeof impact.cpuPercentPeak === "number") {
    cells.push({
      label: t("cpu"),
      value: `${impact.cpuPercentPeak}${t("units.percent")}`,
    });
  }
  if (typeof impact.ramMb === "number") {
    cells.push({ label: t("ram"), value: `${impact.ramMb} ${t("units.mb")}` });
  }
  if (typeof impact.pids === "number") {
    cells.push({ label: t("pids"), value: String(impact.pids) });
  }
  if (typeof impact.startupTimeSeconds === "number") {
    cells.push({
      label: t("startup"),
      value: `${impact.startupTimeSeconds} ${t("units.seconds")}`,
    });
  }
  if (cells.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-bg-tertiary/40 px-5 py-4 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col items-start">
          <span className="text-2xl font-semibold tabular-nums text-text-primary">
            {c.value}
          </span>
          <span className="mt-0.5 text-[11px] uppercase tracking-wide text-text-tertiary">
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function hasHardwareRequirements(manifest: InstallManifestSummary): boolean {
  const h = manifest.hardwareRequirements;
  if (!h) return false;
  return !!(
    h.cameras ||
    h.fcFirmware ||
    (h.boards && h.boards.length) ||
    (h.optional && h.optional.length)
  );
}

function HardwareRequirements({
  manifest,
}: {
  manifest: InstallManifestSummary;
}) {
  const t = useTranslations("pluginInstall.review.hardwareReq");
  const h = manifest.hardwareRequirements;
  if (!h) return null;
  const rows: Array<{ label: string; value: string }> = [];
  if (h.cameras) rows.push({ label: t("cameras"), value: h.cameras });
  if (h.fcFirmware) rows.push({ label: t("fcFirmware"), value: h.fcFirmware });
  if (h.boards && h.boards.length > 0) {
    rows.push({ label: t("boards"), value: h.boards.join(", ") });
  }
  if (h.optional && h.optional.length > 0) {
    rows.push({ label: t("optional"), value: h.optional.join(", ") });
  }
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl bg-bg-tertiary/40 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        {t("title")}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-text-tertiary">{r.label}</dt>
            <dd className="text-text-secondary">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function hasFcParameters(manifest: InstallManifestSummary): boolean {
  const g = manifest.requiredFcParameters;
  if (!g) return false;
  return !!(
    (g.ardupilot && g.ardupilot.length) ||
    (g.px4 && g.px4.length) ||
    (g.inav && g.inav.length)
  );
}

function FcParametersTable({ manifest }: { manifest: InstallManifestSummary }) {
  const t = useTranslations("pluginInstall.review.fcParamsTable");
  const groups = manifest.requiredFcParameters;
  if (!groups) return null;
  return (
    <div className="space-y-3 rounded-xl bg-bg-tertiary/40 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        {t("title")}
      </p>
      {(["ardupilot", "px4", "inav"] as const).map((firmware) => {
        const rows = groups[firmware];
        if (!rows || rows.length === 0) return null;
        return (
          <div key={firmware}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
              {firmware}
            </p>
            <ul className="space-y-0.5 text-text-secondary">
              {rows.map((row, idx) => (
                <li
                  key={`${firmware}.${idx}`}
                  className="grid grid-cols-[1fr_auto_2fr] items-baseline gap-3 font-mono text-[11px]"
                >
                  <span className="truncate text-text-primary">
                    {row.param}
                  </span>
                  <span className="text-text-tertiary">
                    {row.value !== undefined ? `= ${row.value}` : ""}
                  </span>
                  <span className="truncate text-text-tertiary">
                    {row.note ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
