"use client";

/**
 * @module command/settings/VideoSection
 * @description The node Settings "Video" page: the camera stream config the
 * agent persists (the multi-stream `video.cameras` list when the node
 * declares one, else the single camera block) plus the video radio link
 * (WFB) tunables the agent config exposes. A drone gets both subsections; a
 * ground station gets the radio link half; a workstation (no video pipeline,
 * no WFB radio) gets nothing.
 *
 * Writer discipline: stream sources and legs are managed on the Cameras
 * tab, and live TX power is managed from the Link tab's slider — those
 * render read-only here so this page never runs a second writer for the
 * same keys. The writable fields (wire codec preference, encode bitrate,
 * link preset, band, auto-hop, adaptive bitrate) bind to the shared config
 * writer, so every change is validated by the agent and read back from the
 * persisted config.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Video } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import {
  ConfigIntField,
  ConfigReadonlyRow,
  ConfigSelectField,
  ConfigToggleField,
} from "./ConfigFields";
import { configAdvertises, readConfigPath } from "./use-node-config";
import { Section } from "./Section";

interface SectionProps {
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** One entry of the persisted `video.cameras` list, defensively parsed: a
 * malformed entry renders what it has, never a guess. */
export interface CameraLegEntry {
  id: string | null;
  role: string | null;
  source: string | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  enabled: boolean;
}

/** Parse the `video.cameras` config list. Returns null when the config does
 * not carry a list (older agent / config not loaded) — distinct from a
 * present-but-empty list (a single-stream node). */
export function parseCameraLegs(
  config: Record<string, unknown> | null,
): CameraLegEntry[] | null {
  const raw = readConfigPath(config, "video.cameras");
  if (!Array.isArray(raw)) return null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: str(e.id),
      role: str(e.role),
      source: str(e.source),
      codec: str(e.codec),
      width: num(e.width),
      height: num(e.height),
      fps: num(e.fps),
      // Absent reads enabled (the agent's model default), an explicit false
      // reads disabled.
      enabled: e.enabled !== false,
    }));
}

/** Format `WxH @ fps` from whatever the entry actually carries. */
function formatShape(
  width: number | null,
  height: number | null,
  fps: number | null,
): string | null {
  const res = width != null && height != null ? `${width}×${height}` : null;
  const rate = fps != null ? `${fps} fps` : null;
  if (res && rate) return `${res} @ ${rate}`;
  return res ?? rate;
}

/** Read a numeric config value, or null. */
function readNum(
  config: Record<string, unknown> | null,
  path: string,
): number | null {
  const v = readConfigPath(config, path);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function VideoSection({
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings.video");

  // A workstation runs no video pipeline and carries no WFB radio.
  if (profile !== "drone" && profile !== "ground-station") return null;

  const isDrone = profile === "drone";
  const legs = parseCameraLegs(config);
  const hasWfb = configAdvertises(config, "video.wfb");

  const codecPrefOptions = [
    { value: "auto", label: t("codecPrefAuto") },
    { value: "h264", label: "H.264" },
    { value: "h265", label: "H.265" },
  ];
  const presetOptions = [
    { value: "conservative", label: t("presetConservative") },
    { value: "balanced", label: t("presetBalanced") },
    { value: "aggressive", label: t("presetAggressive") },
  ];
  const bandOptions = [
    { value: "u-nii-1", label: t("bandUnii1") },
    { value: "u-nii-3", label: t("bandUnii3") },
    { value: "all", label: t("bandAll") },
  ];

  return (
    <Section title={t("title")} icon={Video} blurb={t("blurb")}>
      {/* Camera streams — the persisted list, read-only (the Cameras tab
          owns the roster writes). */}
      {isDrone ? (
        <div className="space-y-3">
          <div>
            <div className="text-xs text-text-secondary">
              {t("camerasTitle")}
            </div>
            <p className="mt-0.5 text-[11px] text-text-tertiary">
              {t("camerasManagedHint")}
            </p>
          </div>
          {legs !== null && legs.length > 0 ? (
            <ul className="space-y-1.5">
              {legs.map((leg, idx) => (
                <li
                  key={leg.id ?? idx}
                  className="flex items-baseline justify-between gap-3 rounded border border-border-default bg-bg-tertiary px-3 py-2"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="font-mono text-xs text-text-primary">
                      {leg.id ?? t("legNoId")}
                    </span>
                    {leg.role ? (
                      <span className="rounded border border-border-default px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
                        {leg.role}
                      </span>
                    ) : null}
                    {!leg.enabled ? (
                      <span className="text-[10px] text-text-tertiary">
                        {t("legDisabled")}
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 truncate text-right font-mono text-[11px] text-text-secondary">
                    {[leg.source, leg.codec, formatShape(leg.width, leg.height, leg.fps)]
                      .filter((p): p is string => p != null)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-2">
              {/* Single-stream node — the one camera block. */}
              <ConfigReadonlyRow
                configKey="video.camera.source"
                label={t("sourceLabel")}
                config={config}
              />
              <ConfigReadonlyRow
                configKey="video.camera.codec"
                label={t("codecLabel")}
                config={config}
              />
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-text-secondary">
                  {t("resolutionLabel")}
                </span>
                <span className="shrink-0 font-mono text-sm text-text-primary">
                  {formatShape(
                    readNum(config, "video.camera.width"),
                    readNum(config, "video.camera.height"),
                    readNum(config, "video.camera.fps"),
                  ) ?? (
                    <span className="text-text-tertiary">
                      {t("notReported")}
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Encode preferences — writable, no other writer owns them. */}
          <div className="space-y-4 border-t border-border-default pt-3">
            <ConfigSelectField
              configKey="video.camera.codec_preference"
              label={t("codecPrefLabel")}
              hint={t("codecPrefHint")}
              options={codecPrefOptions}
              config={config}
              readOnly={readOnly}
              setValue={setValue}
            />
            <ConfigIntField
              configKey="video.camera.bitrate_kbps"
              label={t("bitrateLabel")}
              hint={t("bitrateHint")}
              min={250}
              max={20000}
              config={config}
              readOnly={readOnly}
              setValue={setValue}
            />
          </div>
        </div>
      ) : null}

      {/* Video radio link (WFB) — rendered only when the node's config
          surface advertises the block. */}
      {hasWfb ? (
        <div
          className={
            isDrone
              ? "space-y-4 border-t border-border-default pt-3"
              : "space-y-4"
          }
        >
          <div className="text-xs text-text-secondary">{t("wfbTitle")}</div>
          <ConfigSelectField
            configKey="video.wfb.wfb_link_preset"
            label={t("presetLabel")}
            hint={t("presetHint")}
            options={presetOptions}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigSelectField
            configKey="video.wfb.band"
            label={t("bandLabel")}
            hint={t("bandHint")}
            options={bandOptions}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigToggleField
            configKey="video.wfb.auto_hop_enabled"
            label={t("autoHopLabel")}
            hint={t("autoHopHint")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigToggleField
            configKey="video.wfb.adaptive_bitrate_enabled"
            label={t("adaptiveLabel")}
            hint={t("adaptiveHint")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />

          {/* Owned elsewhere — read-only so this page never runs a second
              writer: the pairing/auto-hop machinery owns the channel, the
              Link tab's slider owns live TX power. */}
          <div className="space-y-2 border-t border-border-default pt-3">
            <ConfigReadonlyRow
              configKey="video.wfb.channel"
              label={t("channelLabel")}
              hint={t("channelHint")}
              config={config}
            />
            <ConfigReadonlyRow
              configKey="video.wfb.tx_power_dbm"
              label={t("txPowerLabel")}
              hint={t("txPowerHint")}
              config={config}
            />
          </div>
        </div>
      ) : null}
    </Section>
  );
}
