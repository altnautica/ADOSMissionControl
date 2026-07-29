"use client";

/**
 * @module command/settings/VisionPerceptionSection
 * @description The node Settings "Perception setup" page: one surface for
 * WHAT this node detects (the engine-wide detector model, via the shared
 * model picker) and WHERE perception executes (the offload / serving
 * tri-states over the agent's `perception.offload.*` / `perception.serving.*`
 * config keys). A drone gets the detector picker + the offload client; a
 * workstation gets the serving controls (its served-detector select + live
 * GPU facts). Renders nothing for a ground-station node.
 *
 * The detector picker needs the node's LAN vision client (model listing,
 * download, and upload are not proxied); a cloud-only session says so
 * instead of rendering a dead picker. The offload / serving fields bind to
 * the shared config writer, so every change is read back from the agent.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Cpu } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import type { SelectOption } from "@/components/ui/select";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useComputeStore } from "@/stores/compute-store";
import { useComputeLocalState } from "@/hooks/use-compute-local-state";
import { resolveVisionClient } from "@/lib/vision/resolve-vision-client";
import { nodeToOffloadAddr } from "@/lib/vision/offload-target";
import { ModelPicker } from "@/components/vision/ModelPicker";
import { ConfigSelectField } from "./ConfigFields";
import { CARD } from "./Section";

interface SectionProps {
  droneId: string;
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

type HalfProps = Omit<SectionProps, "profile">;

/** The shared auto | on | off enablement tri-state both halves use. */
function useEnableOptions(): SelectOption[] {
  const t = useTranslations("nodeSettings");
  return useMemo(
    () => [
      { value: "auto", label: t("perception.enabledAuto") },
      { value: "on", label: t("perception.enabledOn") },
      { value: "off", label: t("perception.enabledOff") },
    ],
    [t],
  );
}

/** A labelled read-only value row (used for the drone's active target and the
 * workstation GPU facts). */
function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="shrink-0 font-mono text-xs text-text-primary">{value}</span>
    </div>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

/** Drone detector subsection: the engine-wide model this node runs, through
 * the shared model picker. The picker needs the LAN vision client (model
 * listing / download / upload are not proxied); without one this states the
 * requirement instead of rendering a dead picker. */
function DroneDetector({ droneId }: { droneId: string }) {
  const t = useTranslations("nodeSettings");
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const client = useMemo(
    () => resolveVisionClient(agentUrl, apiKey),
    [agentUrl, apiKey],
  );

  return (
    <div className="space-y-2">
      <div className="text-xs text-text-secondary">
        {t("perception.detectorTitle")}
      </div>
      <p className="text-[11px] text-text-tertiary">
        {t("perception.detectorHint")}
      </p>
      {client ? (
        <ModelPicker droneId={droneId} mode="compact" hideHeaderLabel />
      ) : (
        <InfoNote>{t("perception.detectorRequiresLan")}</InfoNote>
      )}
    </div>
  );
}

/** Drone half: where this node offloads perception, and which workstation it
 * pins (empty = auto-discover any serving workstation on the LAN). */
function DroneOffloadClient({
  config,
  readOnly,
  setValue,
}: Omit<HalfProps, "droneId">) {
  const t = useTranslations("nodeSettings");
  const enableOptions = useEnableOptions();
  const nodes = useLocalNodesStore((s) => s.nodes);
  const activeTarget = useAgentCapabilitiesStore(
    (s) => s.perceptionOffloadTarget,
  );

  const workstations = useMemo(
    () => nodes.filter((n) => n.profile === "workstation"),
    [nodes],
  );
  const pinOptions: SelectOption[] = useMemo(
    () => [
      { value: "", label: t("perception.offload.pinAuto") },
      ...workstations.map((n) => ({
        value: nodeToOffloadAddr(n),
        label: n.name || n.hostname,
      })),
    ],
    [workstations, t],
  );

  return (
    <div className="space-y-4">
      {/* Active offload target — the agent's own heartbeat status. */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-text-secondary">
            {t("perception.offload.activeLabel")}
          </div>
          <p className="mt-0.5 text-[11px] text-text-tertiary">
            {t("perception.offload.activeHint")}
          </p>
        </div>
        <div className="shrink-0 font-mono text-sm text-text-primary">
          {activeTarget ? (
            activeTarget
          ) : (
            <span className="text-text-tertiary">
              {t("perception.offload.activeNone")}
            </span>
          )}
        </div>
      </div>

      <ConfigSelectField
        configKey="perception.offload.enabled"
        label={t("perception.offload.enabledLabel")}
        hint={t("perception.offload.enabledHint")}
        options={enableOptions}
        placeholder={t("perception.enabledAutoDefault")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      <ConfigSelectField
        configKey="perception.offload.compute_node_addr"
        label={t("perception.offload.pinLabel")}
        hint={
          workstations.length === 0
            ? t("perception.offload.pinNoWorkstation")
            : t("perception.offload.pinHint")
        }
        options={pinOptions}
        placeholder={t("perception.offload.pinAuto")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
    </div>
  );
}

/** Workstation half: whether this node serves offloaded perception, which
 * detector it runs, and its live GPU facts (read-only, real values only). */
function WorkstationServing({ droneId, config, readOnly, setValue }: HalfProps) {
  const t = useTranslations("nodeSettings");
  const enableOptions = useEnableOptions();
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  // Poll this workstation's compute status so the GPU rows below reflect the
  // live node (the same producer the Overview uses). No-op off local-first.
  useComputeLocalState(droneId);
  const gpu = useComputeStore((s) => s.gpu);

  // Detector options — the workstation's own vision registry (installed +
  // custom + downloadable), deduped by id. Empty on an agent that does not
  // serve the model endpoint; the picker then shows only the default option.
  const client = useMemo(
    () => resolveVisionClient(agentUrl, apiKey),
    [agentUrl, apiKey],
  );
  const [modelOptions, setModelOptions] = useState<SelectOption[]>([]);
  useEffect(() => {
    // No client ⇒ nothing to fetch; the empty case is derived below (no
    // synchronous setState in the effect). The state is only written from the
    // async resolve/reject.
    if (!client) return;
    let cancelled = false;
    void client
      .listModels()
      .then((res) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const opts: SelectOption[] = [];
        for (const m of [...res.installed, ...res.custom, ...res.registry]) {
          if (!m.id || seen.has(m.id)) continue;
          seen.add(m.id);
          const label = "name" in m && m.name ? m.name : m.id;
          opts.push({ value: m.id, label });
        }
        setModelOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setModelOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const detectorOptions: SelectOption[] = useMemo(
    () => [
      { value: "", label: t("perception.serving.modelDefault") },
      // When there is no client, show only the default (ignore any stale list).
      ...(client ? modelOptions : []),
    ],
    [client, modelOptions, t],
  );

  const hasGpu =
    gpu != null &&
    (gpu.name != null ||
      gpu.cores != null ||
      gpu.unifiedMemoryMb != null ||
      gpu.utilizationPct != null);

  return (
    <div className="space-y-4">
      <ConfigSelectField
        configKey="perception.serving.enabled"
        label={t("perception.serving.enabledLabel")}
        hint={t("perception.serving.enabledHint")}
        options={enableOptions}
        placeholder={t("perception.enabledAutoDefault")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      <ConfigSelectField
        configKey="perception.serving.detector_model"
        label={t("perception.serving.modelLabel")}
        hint={t("perception.serving.modelHint")}
        options={detectorOptions}
        placeholder={t("perception.serving.modelDefault")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* GPU — read-only, real values only. */}
      {hasGpu ? (
        <div className="space-y-2 border-t border-border-default pt-3">
          <div className="flex items-center gap-1.5">
            <Cpu size={12} className="text-text-tertiary" aria-hidden="true" />
            <span className="text-xs text-text-secondary">
              {t("perception.serving.gpuTitle")}
            </span>
          </div>
          {gpu?.name != null ? (
            <ReadRow label={t("perception.serving.gpuName")} value={gpu.name} />
          ) : null}
          {gpu?.cores != null ? (
            <ReadRow
              label={t("perception.serving.gpuCores")}
              value={String(gpu.cores)}
            />
          ) : null}
          {gpu?.unifiedMemoryMb != null ? (
            <ReadRow
              label={t("perception.serving.gpuMemory")}
              value={`${Math.round(gpu.unifiedMemoryMb / 1024)} GB`}
            />
          ) : null}
          {gpu?.utilizationPct != null ? (
            <ReadRow
              label={t("perception.serving.gpuUtil")}
              value={`${gpu.utilizationPct.toFixed(0)}%`}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The Settings-tab "Perception setup" page. Drone → detector model +
 * offload client; workstation → serving controls + GPU facts; ground-station
 * → nothing. */
export function VisionPerceptionSection({
  droneId,
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings");
  if (profile !== "drone" && profile !== "workstation") return null;

  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center gap-2">
        <Layers size={16} className="text-accent-primary" aria-hidden="true" />
        <h2 className="text-lg font-medium text-text-primary">
          {t("perception.title")}
        </h2>
      </div>
      <p className="mb-4 text-xs text-text-secondary">
        {profile === "drone"
          ? t("perception.blurb")
          : t("perception.serving.blurb")}
      </p>
      {profile === "drone" ? (
        <div className="space-y-4">
          <DroneDetector droneId={droneId} />
          <div className="space-y-4 border-t border-border-default pt-3">
            <div>
              <div className="text-xs text-text-secondary">
                {t("perception.offloadTitle")}
              </div>
              <p className="mt-0.5 text-[11px] text-text-tertiary">
                {t("perception.offload.blurb")}
              </p>
            </div>
            <DroneOffloadClient
              config={config}
              readOnly={readOnly}
              setValue={setValue}
            />
          </div>
        </div>
      ) : (
        <WorkstationServing
          droneId={droneId}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
      )}
    </section>
  );
}
