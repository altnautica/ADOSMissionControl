"use client";

/**
 * @module command/settings/VideoSection
 * @description The node Settings "Video" page: the camera stream config the
 * agent persists — the multi-stream `video.cameras` list when the node
 * declares one, else the single camera block — plus the encode preferences.
 * A drone gets the page; a ground station and a workstation run no camera
 * pipeline of their own, so they get nothing.
 *
 * The radio half of `video.*` lives on its own Radio page: this file owns
 * cameras and encoding, and renders no `video.wfb.*` field at all.
 *
 * Writer discipline: stream sources and legs are managed on the Cameras
 * tab, so they render read-only here and this page never runs a second
 * writer for the same keys. The writable fields (wire codec preference,
 * encode bitrate) bind to the shared config writer, so every change is
 * validated by the agent and read back from the persisted config.
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
import { readConfigPath } from "./use-node-config";
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
  /** Clockwise image rotation in degrees (0|90|180|270), default 0. */
  rotation: number;
  /** Horizontal image flip, default false. */
  hflip: boolean;
  /** Vertical image flip, default false. */
  vflip: boolean;
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
  const rotation = (v: unknown): number => {
    const n = num(v);
    return n === 90 || n === 180 || n === 270 ? n : 0;
  };
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
      rotation: rotation(e.rotation),
      hflip: e.hflip === true,
      vflip: e.vflip === true,
    }));
}

/** Render the orientation transforms of a camera leg as a compact label, or
 * null when everything is at its identity default. */
function formatOrientation(
  rotation: number,
  hflip: boolean,
  vflip: boolean,
): string | null {
  const parts: string[] = [];
  if (rotation) parts.push(`${rotation}°`);
  if (hflip) parts.push("hflip");
  if (vflip) parts.push("vflip");
  return parts.length ? parts.join(" ") : null;
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

  // Only a drone runs a camera pipeline; a ground station relays video it
  // never encodes, and a workstation has none at all.
  if (profile !== "drone") return null;

  const legs = parseCameraLegs(config);

  const codecPrefOptions = [
    { value: "auto", label: t("codecPrefAuto") },
    { value: "h264", label: "H.264" },
    { value: "h265", label: "H.265" },
  ];

  return (
    <Section title={t("title")} icon={Video} blurb={t("blurb")}>
      {/* Camera streams — the persisted list, read-only (the Cameras tab
          owns the roster writes). */}
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
                  {[
                    leg.source,
                    leg.codec,
                    formatShape(leg.width, leg.height, leg.fps),
                    formatOrientation(leg.rotation, leg.hflip, leg.vflip),
                  ]
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

        {/* Image orientation — writable, applies to the live encoder. */}
        <div className="space-y-4 border-t border-border-default pt-3">
          <div>
            <div className="text-xs text-text-secondary">
              {t("orientationTitle")}
            </div>
            <p className="mt-0.5 text-[11px] text-text-tertiary">
              {t("orientationHint")}
            </p>
          </div>
          <ConfigSelectField
            configKey="video.camera.rotation"
            label={t("rotationLabel")}
            hint={t("rotationHint")}
            options={[
              { value: "0", label: t("rotation0") },
              { value: "90", label: "90°" },
              { value: "180", label: "180°" },
              { value: "270", label: "270°" },
            ]}
            placeholder={t("rotationDefault")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigToggleField
            configKey="video.camera.hflip"
            label={t("hflipLabel")}
            hint={t("hflipHint")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
          <ConfigToggleField
            configKey="video.camera.vflip"
            label={t("vflipLabel")}
            hint={t("vflipHint")}
            config={config}
            readOnly={readOnly}
            setValue={setValue}
          />
        </div>

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
    </Section>
  );
}
