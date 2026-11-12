"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type {
  BetaflightTarget, BetaflightRelease,
  BetaflightBuildOptions, BetaflightBuildStatus,
} from "@/lib/protocol/firmware/types";
import { HardDrive, Zap, RefreshCw, Wrench, Loader2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import { buildBetaflightSelectGroups } from "@/lib/boards";

interface Props {
  bfTargets: BetaflightTarget[];
  bfReleases: BetaflightRelease[];
  bfLoading: boolean;
  bfError: string;
  selectedBfTarget: string;
  setSelectedBfTarget: (v: string) => void;
  selectedBfRelease: string;
  setSelectedBfRelease: (v: string) => void;
  bfCustomBuild: boolean;
  setBfCustomBuild: (v: boolean) => void;
  bfBuildOptions: BetaflightBuildOptions | null;
  bfSelectedOptions: string[];
  bfBuildStatus: BetaflightBuildStatus | null;
  bfBuildPolling: boolean;
  bfBuildRetrying: boolean;
  bfBuildTimedOut: boolean;
  onCloudBuild: () => void;
  onCheckBuildAgain: () => void;
  onToggleOption: (option: string) => void;
  onRetry: () => void;
}

function BuildOptionGroup({ label, options, selected, onToggle }: {
  label: string; options: string[]; selected: string[]; onToggle: (o: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] text-text-secondary font-semibold mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={`px-2 py-0.5 text-[10px] border cursor-pointer ${
              selected.includes(opt)
                ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                : "border-border-default text-text-tertiary"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FirmwareBetaflightSection({
  bfTargets, bfReleases, bfLoading, bfError,
  selectedBfTarget, setSelectedBfTarget,
  selectedBfRelease, setSelectedBfRelease,
  bfCustomBuild, setBfCustomBuild,
  bfBuildOptions, bfSelectedOptions, bfBuildStatus, bfBuildPolling,
  bfBuildRetrying, bfBuildTimedOut,
  onCloudBuild, onCheckBuildAgain, onToggleOption, onRetry,
}: Props) {
  const tm = useTranslations("fcPanels.firmwareBetaflightSection");
  const targetGroups = useMemo(() => buildBetaflightSelectGroups(bfTargets), [bfTargets])

  return (
    <>
      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
            <HardDrive size={14} />
            {tm("targetBoard")}
          </h2>
          {bfLoading && (
            <span className="text-[10px] text-text-tertiary flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" /> {tm("loadingTargets")}
            </span>
          )}
        </div>

        {bfError && (
          <div className="text-[10px] text-status-error flex items-center justify-between">
            <span>{bfError}</span>
            <button onClick={onRetry} className="underline cursor-pointer">{tm("retry")}</button>
          </div>
        )}

        <Select
          value={selectedBfTarget}
          onChange={setSelectedBfTarget}
          disabled={bfLoading || bfTargets.length === 0}
          placeholder={tm("loadingTargets")}
          searchable
          options={targetGroups.length > 0 ? targetGroups : bfTargets.map((t) => ({
            value: t.target, label: t.target,
            description: `${t.manufacturer} / ${t.mcu}`,
          }))}
        />
        <p className="text-[10px] text-text-tertiary">{bfTargets.length} targets available</p>
      </div>

      <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
        <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
          <Zap size={14} />
          {tm("firmwareVersion")}
        </h2>
        <Select
          label={tm("release")}
          value={selectedBfRelease}
          onChange={setSelectedBfRelease}
          disabled={bfReleases.length === 0}
          placeholder={selectedBfTarget ? "Loading releases..." : "Select target first"}
          options={bfReleases.map((r) => ({ value: r.release, label: r.label || r.release }))}
        />

        <div className="border-t border-border-default pt-3">
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={bfCustomBuild} onChange={(e) => setBfCustomBuild(e.target.checked)} className="accent-accent-primary" />
            <Wrench size={12} />
            {tm("customCloudBuild")}
          </label>
          <p className="text-[10px] text-text-tertiary mt-1 ml-6">
            {tm("buildFirmwareWithSpecificFeatures")}
          </p>
        </div>

        {bfCustomBuild && bfBuildOptions && (
          <div className="space-y-3 pl-2 border-l-2 border-accent-primary/30">
            <BuildOptionGroup label={tm("radioProtocol")} options={bfBuildOptions.radioProtocols} selected={bfSelectedOptions} onToggle={onToggleOption} />
            <BuildOptionGroup label={tm("telemetryProtocol")} options={bfBuildOptions.telemetryProtocols} selected={bfSelectedOptions} onToggle={onToggleOption} />
            <BuildOptionGroup label={tm("motorProtocol")} options={bfBuildOptions.motorProtocols} selected={bfSelectedOptions} onToggle={onToggleOption} />
            <BuildOptionGroup label={tm("osdOptions")} options={bfBuildOptions.osdOptions} selected={bfSelectedOptions} onToggle={onToggleOption} />
            <BuildOptionGroup label={tm("otherOptions")} options={bfBuildOptions.otherOptions} selected={bfSelectedOptions} onToggle={onToggleOption} />

            {bfSelectedOptions.length > 0 && (
              <p className="text-[10px] text-text-tertiary">Selected: {bfSelectedOptions.join(", ")}</p>
            )}

            <button
              onClick={onCloudBuild}
              disabled={bfBuildPolling || !selectedBfTarget || !selectedBfRelease}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold border border-accent-primary text-accent-primary hover:bg-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {bfBuildPolling ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
              {bfBuildPolling ? "Building..." : "Build Firmware"}
            </button>

            {bfBuildStatus && (
              <div className={`text-[10px] p-2 border ${
                bfBuildStatus.status === "success" ? "border-status-success/40 text-status-success"
                : bfBuildStatus.status === "error" ? "border-status-error/40 text-status-error"
                : "border-border-default text-text-tertiary"
              }`}>
                <p className="font-semibold">Build: {bfBuildStatus.status}</p>
                {bfBuildStatus.progress !== undefined && <p>Progress: {bfBuildStatus.progress}%</p>}
                {bfBuildRetrying && <p>{tm("statusCheckFailedRetrying")}</p>}
                {bfBuildStatus.status === "success" && bfBuildStatus.file && (
                  <p className="font-mono mt-1">{bfBuildStatus.file}</p>
                )}
                {bfBuildStatus.status === "error" && (
                  <button
                    onClick={onCloudBuild}
                    disabled={bfBuildPolling}
                    className="mt-1.5 flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border border-status-error/40 text-status-error hover:bg-status-error/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  >
                    <RefreshCw size={10} />
                    {tm("retryBuild")}
                  </button>
                )}
                {bfBuildTimedOut && (
                  <div className="mt-1.5">
                    <p>{tm("theBuildIsStillRunning")}</p>
                    <button
                      onClick={onCheckBuildAgain}
                      disabled={bfBuildPolling}
                      className="mt-1 flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border border-border-default text-text-secondary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
                    >
                      <RefreshCw size={10} />
                      {tm("checkAgain")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
