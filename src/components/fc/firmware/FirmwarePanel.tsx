"use client";

import { Zap } from "lucide-react";
import { useFirmwareState } from "./useFirmwareState";
import { FirmwareFlashProgress } from "./FirmwareFlashProgress";
import { FirmwareBoardInfo } from "./FirmwareBoardInfo";
import { FirmwareBackupRestore } from "./FirmwareBackupRestore";
import { FirmwareArduPilotSection } from "./FirmwareArduPilotSection";
import { FirmwareBetaflightSection } from "./FirmwareBetaflightSection";
import { FirmwarePx4Section } from "./FirmwarePx4Section";
import {
  DfuStatusBanner, FirmwareStackSelector, FlashMethodSelector,
  PreFlashChecklist, FirmwareSourceToggle,
} from "./FirmwareCommonSections";

export function FirmwarePanel() {
  const fw = useFirmwareState();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Zap size={20} className="text-accent-primary" />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Flash Tool</h1>
            <p className="text-xs text-text-tertiary">Flash firmware via USB DFU or serial bootloader</p>
          </div>
        </div>

        <FirmwareStackSelector
          firmwareStack={fw.firmwareStack} setFirmwareStack={fw.setFirmwareStack}
          isFlashing={fw.isFlashing} setUseCustom={fw.setUseCustom}
          droneType={fw.drone?.vehicleInfo.firmwareType}
        />

        <DfuStatusBanner
          dfuDevices={fw.dfuDevices} selectedDroneId={fw.selectedDroneId}
          usbSupported={fw.usbSupported} isFlashing={fw.isFlashing}
          onDetectDfu={fw.handleDetectDfu}
        />

        {/* DFU info collapsible */}
        <details className="bg-bg-secondary border border-border-default">
          <summary className="px-4 py-2.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
            What is DFU flashing?
          </summary>
          <div className="px-4 pb-3 space-y-2 text-[10px] text-text-tertiary">
            <p><strong className="text-text-secondary">DFU (Device Firmware Upgrade)</strong> is a USB protocol that talks directly to the STM32 bootloader. It bypasses the serial bootloader entirely.</p>
            <p><strong className="text-text-secondary">Serial bootloader</strong> uses the FC&apos;s UART to flash firmware. This is the most common method and works with most boards.</p>
            <p><strong className="text-text-secondary">When to use DFU:</strong> Some H7-based boards (like Matek H743) work better with DFU. It&apos;s also useful when serial flashing fails or when you need to recover a bricked board.</p>
            <p>To enter DFU mode, hold the BOOT button on your FC while plugging in the USB cable. The board will appear as a DFU device instead of a serial port.</p>
          </div>
        </details>

        {/* Manual bootloader entry guide */}
        <details className="bg-bg-secondary border border-border-default">
          <summary className="px-4 py-2.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
            Bootloader not detected? Manual entry guide
          </summary>
          <div className="px-4 pb-3 space-y-2 text-[10px] text-text-tertiary">
            <p>If the flash tool cannot automatically enter bootloader mode, try these steps:</p>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li><strong className="text-text-secondary">Unplug</strong> the FC from USB completely</li>
              <li><strong className="text-text-secondary">Hold the BOOT button</strong> on the FC (small button near the USB port, sometimes labeled &quot;BT&quot; or &quot;BOOT&quot;)</li>
              <li><strong className="text-text-secondary">While holding BOOT, plug in USB</strong></li>
              <li><strong className="text-text-secondary">Release BOOT</strong> after 1-2 seconds</li>
              <li>Click <strong className="text-text-secondary">Scan for DFU</strong> above, or click <strong className="text-text-secondary">Flash Firmware</strong> and select the port when prompted</li>
            </ol>
            <p className="mt-2"><strong className="text-text-secondary">Recovering a bricked board:</strong> If your FC is unresponsive (no serial port, no MAVLink), the BOOT button method above is the standard recovery path. It forces the STM32 into its built-in ROM bootloader, which is independent of any flashed firmware.</p>
            <p><strong className="text-text-secondary">NuttShell / NSH prompt:</strong> If you see shell-like output instead of MAVLink data, the FC booted into maintenance mode (common on Pixhawk boards). Unplug, use the BOOT button method, and reflash.</p>
          </div>
        </details>

        {/* No-drone hint */}
        {!fw.drone && fw.dfuDevices.length === 0 && (
          <div className="bg-bg-secondary border border-border-default p-3">
            <p className="text-[10px] text-text-tertiary">No drone connected. Select your board and firmware manually, or connect a drone for automatic detection.</p>
          </div>
        )}

        {/* Browser support warnings */}
        {!fw.serialSupported && !fw.usbSupported && (
          <div className="bg-status-danger/10 border border-status-danger/30 p-4">
            <p className="text-xs text-status-danger font-semibold">Browser Not Supported</p>
            <p className="text-[10px] text-text-tertiary mt-1">Firmware flashing requires Web Serial or WebUSB APIs. Use Chrome or Edge.</p>
          </div>
        )}

        {/* Current board info */}
        {fw.drone && (
          <FirmwareBoardInfo
            firmwareVersionString={fw.drone.vehicleInfo.firmwareVersionString || ""}
            vehicleClass={fw.drone.vehicleInfo.vehicleClass || ""}
            systemId={fw.drone.vehicleInfo.systemId}
          />
        )}

        {/* ArduPilot Selection */}
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

        {/* Betaflight Selection */}
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

        {/* PX4 Selection */}
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

        <PreFlashChecklist checklist={fw.checklist} setChecklist={fw.setChecklist} />

        {/* Flash progress */}
        {fw.progress && (
          <FirmwareFlashProgress progress={fw.progress} isFlashing={fw.isFlashing} onAbort={fw.handleAbort} />
        )}

        {/* Status message */}
        {fw.flashMessage && !fw.progress && (
          <div className="bg-bg-secondary border border-border-default p-3">
            <p className="text-[10px] text-text-tertiary font-mono">{fw.flashMessage}</p>
          </div>
        )}

        {/* Error display */}
        {fw.currentError && (
          <div className="bg-status-danger/10 border border-status-danger/30 p-3">
            <p className="text-[10px] text-status-danger">{fw.currentError}</p>
          </div>
        )}

        {/* Action buttons */}
        <FirmwareBackupRestore
          protocol={fw.drone?.protocol ?? null}
          selectedDroneId={fw.selectedDroneId}
          isFlashing={fw.isFlashing}
          allChecked={fw.allChecked}
          serialSupported={fw.serialSupported}
          usbSupported={fw.usbSupported}
          onFlash={fw.handleFlash}
          onMessage={fw.setFlashMessage}
          onParamBackupChecked={() => fw.setChecklist((prev) => ({ ...prev, paramBackup: true }))}
        />
      </div>
    </div>
  );
}
