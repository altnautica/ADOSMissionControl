"use client";

/**
 * @module atlas/WorldArtifactBlock
 * @description One artifact slot of a world-model generation — the splat, the
 * point cloud, the mesh, or the occupancy / ESDF grid — rendered from its
 * descriptor.
 *
 * Strings live in the existing top-level `atlas` namespace under the `world*`
 * prefix, beside `worldModelHeading` / `worldModelEmpty` / `liveWorld*`. World
 * model is one subject and its strings stay in one namespace; a nested
 * `atlas.world` would have split it in two.
 *
 * Every number here is nullable by contract, and the two null readings are
 * deliberately different:
 *
 *  - The whole slot null means the generation produced no artifact of that kind.
 *    It says so in words, because an absent mesh must never read as an empty
 *    mesh.
 *  - A count null means the descriptor stated no measurement. It renders as the
 *    unknown marker and NEVER as `0`, because a fabricated zero gaussian count
 *    or a fabricated clearance figure is a fact an operator would act on.
 *
 * A descriptor that omitted a required measurement is also badged with the field
 * names it left unstated, so a partial descriptor is visible as partial rather
 * than as a confident row of unknowns.
 *
 * @license GPL-3.0-only
 */

import {
  boundsExtent,
  occupancyVoxelCount,
  type WorldArtifact,
  type WorldArtifactKind,
} from "@/lib/atlas/world-descriptors";

/** The `next-intl` translator for the `atlas` namespace, narrowed to what these
 * rows call. */
export type WorldTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** i18n key for each artifact kind. An explicit map rather than a built string,
 * so every key a component asks for is greppable in the catalogue. */
export const WORLD_ARTIFACT_KEY: Record<WorldArtifactKind, string> = {
  splat: "worldSplat",
  pointcloud: "worldPointcloud",
  mesh: "worldMesh",
  occupancy: "worldOccupancy",
};

/** A measured count, or the unknown marker when the descriptor stated none. */
export function CountRow({
  label,
  value,
  locale,
  unknownLabel,
}: {
  label: string;
  value: number | null;
  locale: string;
  unknownLabel: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-tertiary">{label}</span>
      <span
        className={
          value === null
            ? "font-mono text-text-tertiary"
            : "font-mono text-text-secondary tabular-nums"
        }
      >
        {value === null ? unknownLabel : value.toLocaleString(locale)}
      </span>
    </div>
  );
}

export function TextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-tertiary">{label}</span>
      <span className="font-mono text-text-secondary">{value}</span>
    </div>
  );
}

function SplatRows({
  artifact,
  t,
  locale,
  unknownLabel,
}: {
  artifact: Extract<WorldArtifact, { kind: "splat" }>;
  t: WorldTranslate;
  locale: string;
  unknownLabel: string;
}) {
  return (
    <>
      <CountRow
        label={t("worldGaussians")}
        value={artifact.gaussianCount}
        locale={locale}
        unknownLabel={unknownLabel}
      />
      <CountRow
        label={t("worldTrainingStep")}
        value={artifact.step}
        locale={locale}
        unknownLabel={unknownLabel}
      />
      {artifact.manifestUrl !== null && (
        <CountRow
          label={t("worldLodLevels")}
          value={artifact.lodLevels}
          locale={locale}
          unknownLabel={unknownLabel}
        />
      )}
    </>
  );
}

function CloudRows({
  artifact,
  t,
  locale,
  unknownLabel,
}: {
  artifact: Extract<WorldArtifact, { kind: "pointcloud" }>;
  t: WorldTranslate;
  locale: string;
  unknownLabel: string;
}) {
  const extent = boundsExtent(artifact.bounds);
  return (
    <>
      <CountRow
        label={t("worldPoints")}
        value={artifact.pointCount}
        locale={locale}
        unknownLabel={unknownLabel}
      />
      <TextRow
        label={t("worldExtent")}
        value={
          extent === null
            ? t("worldExtentUnmeasured")
            : extent.map((d) => `${d.toFixed(1)} m`).join(" × ")
        }
      />
    </>
  );
}

function MeshRows({
  artifact,
  t,
  locale,
  unknownLabel,
}: {
  artifact: Extract<WorldArtifact, { kind: "mesh" }>;
  t: WorldTranslate;
  locale: string;
  unknownLabel: string;
}) {
  return (
    <>
      <CountRow
        label={t("worldVertices")}
        value={artifact.vertexCount}
        locale={locale}
        unknownLabel={unknownLabel}
      />
      <CountRow
        label={t("worldFaces")}
        value={artifact.faceCount}
        locale={locale}
        unknownLabel={unknownLabel}
      />
    </>
  );
}

function OccupancyRows({
  artifact,
  t,
  locale,
  unknownLabel,
}: {
  artifact: Extract<WorldArtifact, { kind: "occupancy" }>;
  t: WorldTranslate;
  locale: string;
  unknownLabel: string;
}) {
  return (
    <>
      <TextRow
        label={t("worldField")}
        value={
          artifact.field === "esdf"
            ? t("worldFieldEsdf")
            : t("worldFieldOccupancy")
        }
      />
      <CountRow
        label={t("worldVoxels")}
        value={occupancyVoxelCount(artifact)}
        locale={locale}
        unknownLabel={unknownLabel}
      />
      <TextRow
        label={t("worldVoxelSize")}
        value={
          artifact.resolutionM === null
            ? unknownLabel
            : `${artifact.resolutionM.toFixed(2)} m`
        }
      />
      {/* Truncation is meaningless on a plain occupancy buffer (the producer
          documents its zero as meaningless), so it is not rendered there — a
          "0.0 m" clearance radius would be a fabricated distance. */}
      {artifact.field === "esdf" && (
        <TextRow
          label={t("worldTruncation")}
          value={
            artifact.truncationM === null
              ? unknownLabel
              : `${artifact.truncationM.toFixed(1)} m`
          }
        />
      )}
    </>
  );
}

/**
 * One artifact slot. `artifact === null` means the generation produced no
 * artifact of this kind, which is stated in words rather than shown as zeroes.
 */
export function WorldArtifactBlock({
  kind,
  artifact,
  t,
  locale,
}: {
  kind: WorldArtifactKind;
  artifact: WorldArtifact | null;
  t: WorldTranslate;
  locale: string;
}) {
  const unknownLabel = t("worldUnknown");
  return (
    <div
      className="border border-border-default rounded-md p-2 space-y-1"
      data-testid={`world-artifact-${kind}`}
    >
      <div className="text-xs font-medium text-text-secondary">
        {t(WORLD_ARTIFACT_KEY[kind])}
      </div>
      {artifact === null ? (
        <div className="text-[10px] text-text-tertiary">
          {t("worldNotProduced")}
        </div>
      ) : (
        <>
          {artifact.kind === "splat" && (
            <SplatRows
              artifact={artifact}
              t={t}
              locale={locale}
              unknownLabel={unknownLabel}
            />
          )}
          {artifact.kind === "pointcloud" && (
            <CloudRows
              artifact={artifact}
              t={t}
              locale={locale}
              unknownLabel={unknownLabel}
            />
          )}
          {artifact.kind === "mesh" && (
            <MeshRows
              artifact={artifact}
              t={t}
              locale={locale}
              unknownLabel={unknownLabel}
            />
          )}
          {artifact.kind === "occupancy" && (
            <OccupancyRows
              artifact={artifact}
              t={t}
              locale={locale}
              unknownLabel={unknownLabel}
            />
          )}
          {artifact.unstated.length > 0 && (
            <div className="text-[10px] text-status-warning">
              {t("worldPartialDescriptor", {
                fields: artifact.unstated.join(", "),
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
