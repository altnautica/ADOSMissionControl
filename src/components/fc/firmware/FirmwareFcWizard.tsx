"use client";

/**
 * Stepped flight-controller flashing flow: Connect -> Select -> Confirm ->
 * Flash. Reuses the existing per-stack section components as step bodies and
 * adds the pre-flight gate, staged progress, live debug panel, and the
 * actionable error-remedy card. Companion-SBC (ADOS) and CAN-node (AP_Periph)
 * stacks keep their own flat layout in FirmwarePanel; this wizard is for the
 * ArduPilot / Betaflight / PX4 chip-flash flow.
 *
 * @module fc/firmware/FirmwareFcWizard
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useFirmwareState } from "./useFirmwareState";
import { FirmwarePreflightGate } from "./FirmwarePreflightGate";
import { FirmwareBoardInfo } from "./FirmwareBoardInfo";
import { FirmwareArduPilotSection } from "./FirmwareArduPilotSection";
import { FirmwareBetaflightSection } from "./FirmwareBetaflightSection";
import { FirmwarePx4Section } from "./FirmwarePx4Section";
import { FirmwareSourceToggle, FlashMethodSelector, PreFlashChecklist, DfuStatusBanner } from "./FirmwareCommonSections";
import { FirmwareBackupRestore } from "./FirmwareBackupRestore";
import { FirmwareFlashProgress } from "./FirmwareFlashProgress";
import { FirmwareDebugPanel } from "./FirmwareDebugPanel";
import { FirmwareErrorRemedy } from "./FirmwareErrorRemedy";

type FirmwareState = ReturnType<typeof useFirmwareState>;

const STEPS = ["connect", "select", "confirm", "flash"] as const;
type Step = (typeof STEPS)[number];

export function FirmwareFcWizard({ fw }: { fw: FirmwareState }) {
  const t = useTranslations("flashTool.wizard");
  const [step, setStep] = useState<Step>("connect");

  // Jump to the flash step automatically once flashing begins.
  useEffect(() => {
    if (fw.isFlashing) setStep("flash");
  }, [fw.isFlashing]);

  const envOk = fw.serialSupported || fw.usbSupported;
  const fwSelected = fw.useCustom
    ? !!fw.customFile
    : fw.firmwareStack === "ardupilot"
      ? !!fw.selectedApVersion
      : fw.firmwareStack === "betaflight"
        ? !!fw.selectedBfRelease
        : fw.firmwareStack === "px4"
          ? !!fw.selectedPx4Board
          : false;
  const idx = STEPS.indexOf(step);
  const done = fw.progress?.phase === "done";
  const errored = fw.progress?.phase === "error";

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <ol className="flex items-center gap-1" aria-label={t("stepsLabel")}>
        {STEPS.map((s, i) => {
          const state = i < idx ? "done" : i === idx ? "active" : "pending";
          return (
            <li key={s} className="flex items-center gap-1 flex-1">
              <button
                type="button"
                onClick={() => { if (i <= idx && !fw.isFlashing) setStep(s); }}
                disabled={i > idx || fw.isFlashing}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold transition-colors w-full",
                  state === "active" ? "text-accent-primary" : state === "done" ? "text-text-secondary" : "text-text-tertiary",
                  i <= idx && !fw.isFlashing ? "cursor-pointer hover:text-text-primary" : "cursor-default",
                )}
              >
                <span className={cn(
                  "flex items-center justify-center w-5 h-5 rounded-full border text-[10px]",
                  state === "active" ? "border-accent-primary text-accent-primary" : state === "done" ? "border-status-success text-status-success" : "border-border-default",
                )}>
                  {state === "done" ? <Check size={11} /> : i + 1}
                </span>
                {t(`step.${s}`)}
              </button>
              {i < STEPS.length - 1 && <ChevronRight size={12} className="text-text-tertiary shrink-0" />}
            </li>
          );
        })}
      </ol>

      {/* Step 1: Connect */}
      {step === "connect" && (
        <div className="space-y-4">
          <FirmwarePreflightGate serialSupported={fw.serialSupported} usbSupported={fw.usbSupported} />
          <DfuStatusBanner
            dfuDevices={fw.dfuDevices} selectedDroneId={fw.selectedDroneId}
            usbSupported={fw.usbSupported} isFlashing={fw.isFlashing}
            onDetectDfu={fw.handleDetectDfu}
          />
          {fw.drone && (
            <FirmwareBoardInfo
              firmwareVersionString={fw.drone.vehicleInfo.firmwareVersionString || ""}
              vehicleClass={fw.drone.vehicleInfo.vehicleClass || ""}
              systemId={fw.drone.vehicleInfo.systemId}
            />
          )}
          {!fw.drone && (
            <div className="bg-bg-secondary border border-border-default p-3">
              <p className="text-[10px] text-text-tertiary">{t("noDroneHint")}</p>
            </div>
          )}
          <NavRow
            onNext={() => setStep("select")}
            nextDisabled={!envOk}
            nextLabel={t("next")}
          />
        </div>
      )}

      {/* Step 2: Select firmware */}
      {step === "select" && (
        <div className="space-y-4">
          {fw.firmwareStack === "ardupilot" && !fw.useCustom && (
            <FirmwareArduPilotSection
              apBoards={fw.apBoards} apLoading={fw.apLoading} apError={fw.apError}
              apVersions={fw.apVersions} selectedApBoard={fw.selectedApBoard}
              setSelectedApBoard={fw.setSelectedApBoard}
              selectedVehicleType={fw.selectedVehicleType} setSelectedVehicleType={fw.setSelectedVehicleType}
              selectedApVersion={fw.selectedApVersion} setSelectedApVersion={fw.setSelectedApVersion}
              onRetry={fw.loadApManifest}
            />
          )}
          {fw.firmwareStack === "betaflight" && !fw.useCustom && (
            <FirmwareBetaflightSection
              bfTargets={fw.bfTargets} bfReleases={fw.bfReleases}
              bfLoading={fw.bfLoading} bfError={fw.bfError}
              selectedBfTarget={fw.selectedBfTarget} setSelectedBfTarget={fw.setSelectedBfTarget}
              selectedBfRelease={fw.selectedBfRelease} setSelectedBfRelease={fw.setSelectedBfRelease}
              bfCustomBuild={fw.bfCustomBuild} setBfCustomBuild={fw.setBfCustomBuild}
              bfBuildOptions={fw.bfBuildOptions} bfSelectedOptions={fw.bfSelectedOptions}
              bfBuildStatus={fw.bfBuildStatus} bfBuildPolling={fw.bfBuildPolling}
              onCloudBuild={fw.handleBfCloudBuild} onToggleOption={fw.toggleBfOption}
              onRetry={fw.loadBfTargetsRetry}
            />
          )}
          {fw.firmwareStack === "px4" && !fw.useCustom && (
            <FirmwarePx4Section
              px4Releases={fw.px4Releases} px4Loading={fw.px4Loading} px4Error={fw.px4Error}
              selectedPx4Release={fw.selectedPx4Release} setSelectedPx4Release={fw.setSelectedPx4Release}
              selectedPx4Board={fw.selectedPx4Board} setSelectedPx4Board={fw.setSelectedPx4Board}
              px4Boards={fw.px4Boards} onRetry={fw.loadPx4ReleasesRetry}
            />
          )}
          <FirmwareSourceToggle
            firmwareStack={fw.firmwareStack} useCustom={fw.useCustom} setUseCustom={fw.setUseCustom}
            customFileAccept={fw.customFileAccept} customFile={fw.customFile} onCustomFile={fw.handleCustomFile}
          />
          <FlashMethodSelector
            flashMethod={fw.flashMethod} setFlashMethod={fw.setFlashMethod}
            currentFlashMethods={fw.currentFlashMethods}
            serialSupported={fw.serialSupported} usbSupported={fw.usbSupported}
            dfuDevices={fw.dfuDevices}
          />
          <NavRow
            onBack={() => setStep("connect")} backLabel={t("back")}
            onNext={() => setStep("confirm")} nextDisabled={!fwSelected} nextLabel={t("next")}
          />
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === "confirm" && (
        <div className="space-y-4">
          <PreFlashChecklist items={fw.checklistItems} checked={fw.checked} setChecked={fw.setChecked} />
          {fw.flashMessage && (
            <div className="bg-bg-secondary border border-border-default p-3">
              <p className="text-[10px] text-text-tertiary font-mono">{fw.flashMessage}</p>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setStep("select")}
              className="flex items-center gap-1 px-3 py-2 text-xs border border-border-default text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            >
              <ChevronLeft size={14} /> {t("back")}
            </button>
            <FirmwareBackupRestore
              protocol={fw.drone?.protocol ?? null}
              selectedDroneId={fw.selectedDroneId}
              isFlashing={fw.isFlashing}
              allChecked={fw.allChecked}
              serialSupported={fw.serialSupported}
              usbSupported={fw.usbSupported}
              onFlash={fw.handleFlash}
              blockedReason={fw.flashBlockedReason}
              onMessage={fw.setFlashMessage}
              onParamBackupChecked={() => fw.setChecked("paramBackup", true)}
            />
          </div>
        </div>
      )}

      {/* Step 4: Flash */}
      {step === "flash" && (
        <div className="space-y-4">
          {fw.progress && (
            <FirmwareFlashProgress
              progress={fw.progress}
              isFlashing={fw.isFlashing}
              onAbort={fw.handleAbort}
              onSelectBootloader={fw.handleSelectBootloader}
            />
          )}
          {errored && fw.flashError && (
            <FirmwareErrorRemedy
              remedy={fw.flashError}
              message={fw.progress?.message ?? ""}
              onRetry={fw.handleFlash}
              onSelectBootloader={fw.handleSelectBootloader}
            />
          )}
          {done && (
            <div className="border border-status-success/40 bg-status-success/5 p-4 space-y-1">
              <p className="text-xs font-semibold text-status-success flex items-center gap-2">
                <Check size={14} /> {t("doneTitle")}
              </p>
              <p className="text-[10px] text-text-secondary">{t("doneHint")}</p>
            </div>
          )}
          <FirmwareDebugPanel isFlashing={fw.isFlashing} defaultOpen={fw.isFlashing || errored} />
          {!fw.isFlashing && (
            <button
              onClick={() => setStep("connect")}
              className="flex items-center gap-1 px-3 py-2 text-xs border border-border-default text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            >
              <RotateCcw size={14} /> {t("startOver")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NavRow({
  onBack, backLabel, onNext, nextDisabled, nextLabel,
}: {
  onBack?: () => void;
  backLabel?: string;
  onNext: () => void;
  nextDisabled?: boolean;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {onBack ? (
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-3 py-2 text-xs border border-border-default text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
        >
          <ChevronLeft size={14} /> {backLabel}
        </button>
      ) : (
        <span />
      )}
      <button
        onClick={onNext}
        disabled={nextDisabled}
        className="flex items-center gap-1 px-4 py-2 text-xs font-semibold bg-accent-primary text-accent-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-primary/80 cursor-pointer transition-colors"
      >
        {nextLabel} <ChevronRight size={14} />
      </button>
    </div>
  );
}
