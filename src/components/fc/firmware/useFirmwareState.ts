"use client";

import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedDrone } from "@/stores/drone-manager";
import { useArmedLock } from "@/hooks/use-armed-lock";
import type {
  FlashProgress, FirmwareStack, ParsedFirmware,
} from "@/lib/protocol/firmware/types";
import { useFlashLogStore, type FlashLogSource } from "@/stores/flash-log-store";
import { categorize, mapError } from "./flash-error-map";
import { isAdosStack } from "./firmware-constants";
import { FlashManager } from "@/lib/protocol/firmware/flash-manager";
import { parseApjFile } from "@/lib/protocol/firmware/apj-parser";
import { parseHexFile } from "@/lib/protocol/firmware/hex-parser";
import { parsePx4File } from "@/lib/protocol/firmware/px4-parser";
import {
  AP_FLASH_METHODS, BF_FLASH_METHODS, PX4_FLASH_METHODS,
} from "./firmware-constants";
import { apManifest, bfManifest, px4Manifest } from "./firmware-state/manifests";
import { useArduPilotFirmware } from "./firmware-state/use-ardupilot-firmware";
import { useBetaflightFirmware } from "./firmware-state/use-betaflight-firmware";
import { usePx4Firmware } from "./firmware-state/use-px4-firmware";
import { useAdosAgentFirmware } from "./firmware-state/use-ados-agent-firmware";
import { useFlashCore } from "./firmware-state/use-flash-core";

/**
 * Composes the per-stack firmware hooks (ArduPilot / Betaflight / PX4 /
 * ADOS agent) and the shared flash core into the single flat state
 * object the firmware panel consumes. The aggregator owns the truly
 * cross-stack concerns: the active stack selector, the auto-detect from
 * the connected drone, the per-stack load dispatch on a stack change,
 * and the flash orchestration that reads the selected firmware out of
 * whichever stack is active.
 */
export function useFirmwareState() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const drone = useDroneManager(selectSelectedDrone);
  const { toast } = useToast();
  // Flashing reboots the FC into its bootloader: never on an armed vehicle,
  // whatever the checklist says.
  const { isHardBlocked, hardBlockMessage } = useArmedLock();

  const [firmwareStack, setFirmwareStack] = useState<FirmwareStack>("ardupilot");

  const ap = useArduPilotFirmware(firmwareStack, drone);
  const bf = useBetaflightFirmware(firmwareStack, toast);
  const px4 = usePx4Firmware();
  const ados = useAdosAgentFirmware(firmwareStack);
  const core = useFlashCore(firmwareStack);

  // Auto-detect firmware stack from connected drone
  useEffect(() => {
    if (drone && !core.hasAutoDetected.current) {
      core.hasAutoDetected.current = true;
      const ft = drone.vehicleInfo.firmwareType;
      if (ft.startsWith("ardupilot")) setFirmwareStack("ardupilot");
      else if (ft === "betaflight") setFirmwareStack("betaflight");
      else if (ft === "px4") setFirmwareStack("px4");
    }
  }, [drone, core.hasAutoDetected]);

  // Load data when firmware stack changes
  useEffect(() => {
    if (firmwareStack === "ardupilot" && ap.apBoards.length === 0) ap.loadApManifest();
    else if (firmwareStack === "betaflight" && bf.bfTargets.length === 0) bf.loadBfTargets();
    else if (firmwareStack === "px4" && px4.px4Releases.length === 0) px4.loadPx4Releases();
    else if (isAdosStack(firmwareStack) && ados.adosBoards.length === 0) ados.loadAdosManifest();
    core.setFlashMethod("auto");
  }, [firmwareStack]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flash handler
  const handleFlash = useCallback(async () => {
    if (isHardBlocked) {
      toast(hardBlockMessage, "error");
      return;
    }
    core.setIsFlashing(true); core.setProgress(null); core.setFlashMessage(""); core.setFlashError(null);
    core.lastMsgRef.current = ""; core.lastPhaseRef.current = "idle";
    const flashLog = useFlashLogStore.getState();
    try {
      let firmware: ParsedFirmware;
      if (core.useCustom && core.customFile) {
        const content = await core.customFile.text();
        const name = core.customFile.name.toLowerCase();
        if (name.endsWith(".hex")) firmware = parseHexFile(content);
        else if (name.endsWith(".apj")) firmware = parseApjFile(content);
        else if (name.endsWith(".px4")) firmware = parsePx4File(content);
        else { const buffer = await core.customFile.arrayBuffer(); firmware = { blocks: [{ address: 0x08000000, data: new Uint8Array(buffer) }], totalBytes: buffer.byteLength }; }
      } else if (firmwareStack === "ardupilot") {
        core.setProgress({ phase: "idle", percent: 0, message: "Downloading firmware..." });
        const url = await apManifest.getFirmwareUrl(ap.selectedApBoard, ap.selectedVehicleType, ap.selectedApVersion);
        if (!url) throw new Error(`No firmware found for ${ap.selectedApBoard} / ${ap.selectedVehicleType} / ${ap.selectedApVersion}`);
        const useDfu = core.flashMethod === "dfu" || (core.flashMethod === "auto" && core.dfuDevices.length > 0);
        firmware = await apManifest.downloadFirmware(url, { forDfu: useDfu });
      } else if (firmwareStack === "betaflight") {
        core.setProgress({ phase: "idle", percent: 0, message: "Downloading firmware..." });
        if (bf.bfCustomBuild) {
          if (!bf.bfBuildStatus || bf.bfBuildStatus.status !== "success" || !bf.bfBuildStatus.url) throw new Error("Custom build not ready. Build firmware first, then flash.");
          firmware = await bfManifest.downloadFirmware(bf.bfBuildStatus.url);
        } else {
          const info = await bfManifest.getBuildInfo(bf.selectedBfTarget, bf.selectedBfRelease);
          firmware = await bfManifest.downloadFirmware(info.url);
        }
      } else {
        core.setProgress({ phase: "idle", percent: 0, message: "Downloading firmware..." });
        const url = await px4Manifest.getFirmwareUrl(px4.selectedPx4Release, px4.selectedPx4Board);
        if (!url) throw new Error(`No firmware found for ${px4.selectedPx4Release} / ${px4.selectedPx4Board}`);
        firmware = await px4Manifest.downloadFirmware(url);
      }
      core.setFlashMessage(`Firmware: ${(firmware.totalBytes / 1024).toFixed(1)} KB` + (firmware.boardId ? ` (board ID: ${firmware.boardId})` : ""));
      const protocol = drone?.protocol ?? null;
      const transport = drone?.transport ?? null;
      const fm = new FlashManager(protocol, transport);
      core.flashManagerRef.current = fm;
      let method = core.flashMethod;
      if (firmwareStack === "px4" && method === "auto") method = "px4-serial";

      // Open a fresh log session and surface the full event + protocol trace.
      const board = firmwareStack === "ardupilot" ? ap.selectedApBoard
        : firmwareStack === "betaflight" ? bf.selectedBfTarget
        : firmwareStack === "px4" ? px4.selectedPx4Board : "";
      const fwLabel = firmwareStack === "ardupilot" ? [ap.selectedApBoard, ap.selectedVehicleType, ap.selectedApVersion].filter(Boolean).join(" ")
        : firmwareStack === "betaflight" ? bf.selectedBfRelease
        : firmwareStack === "px4" ? px4.selectedPx4Release : "";
      flashLog.startSession({ board: board || undefined, firmware: fwLabel || undefined, method });
      // Tag protocol-level logs with the transport actually selected. For "auto"
      // the manager tries DFU first when a DFU device is present (same heuristic
      // as the firmware-format decision above), so reflect that in the tag
      // rather than defaulting every "auto" flash to [serial].
      const resolvedMethod = method === "auto" && core.dfuDevices.length > 0 ? "dfu" : method;
      const logSource: FlashLogSource = resolvedMethod === "px4-serial" ? "px4" : resolvedMethod === "dfu" ? "dfu" : "serial";

      const onProgressCb = (p: FlashProgress) => {
        core.setProgress(p);
        core.lastPhaseRef.current = p.phase;
        if (p.message && p.message !== core.lastMsgRef.current) {
          const lvl = p.phase === "done" ? "success" : p.phase === "error" ? "error" : p.phase === "bootloader_wait" ? "warning" : "info";
          flashLog.log(lvl, "manager", p.message, { phase: p.phase });
          core.lastMsgRef.current = p.message;
        }
      };
      const onLogCb = (lvl: "debug" | "info" | "warning" | "error", msg: string, raw?: string) => {
        flashLog.log(lvl, logSource, msg, { rawHex: raw, phase: core.lastPhaseRef.current });
      };

      await fm.flash(firmware, { method, backupParams: core.checked.paramBackup === true, verify: true }, onProgressCb, onLogCb);
    } catch (err) {
      let userMessage = err instanceof Error ? err.message : "Unknown error";
      if (err instanceof DOMException) {
        if (err.name === "NotFoundError") userMessage = "No DFU device selected. Ensure the FC is in DFU mode (hold BOOT button + plug USB), then try again.";
        else if (err.name === "SecurityError") userMessage = "WebUSB blocked. Serve Command over HTTPS or localhost.";
        else if (err.name === "NetworkError") userMessage = "USB device disconnected during operation. Reconnect and retry.";
      }
      const category = categorize(err);
      flashLog.log("error", "manager", userMessage, { category });
      if (!userMessage.includes("aborted")) {
        core.setProgress({ phase: "error", percent: 0, message: userMessage });
        core.setFlashError(mapError(category));
        toast("Firmware flash failed", "error");
      }
    } finally { core.setIsFlashing(false); core.flashManagerRef.current = null; }
  }, [core, ap.selectedApBoard, ap.selectedVehicleType, ap.selectedApVersion,
      bf.selectedBfTarget, bf.selectedBfRelease, bf.bfCustomBuild, bf.bfBuildStatus,
      px4.selectedPx4Release, px4.selectedPx4Board, firmwareStack, drone, toast,
      isHardBlocked, hardBlockMessage]);

  const currentFlashMethods = firmwareStack === "px4" ? PX4_FLASH_METHODS : firmwareStack === "betaflight" ? BF_FLASH_METHODS : AP_FLASH_METHODS;
  const isLoading = firmwareStack === "ardupilot" ? ap.apLoading : firmwareStack === "betaflight" ? bf.bfLoading : px4.px4Loading;
  const currentError = firmwareStack === "ardupilot" ? ap.apError : firmwareStack === "betaflight" ? bf.bfError : px4.px4Error;
  const customFileAccept = firmwareStack === "px4" ? ".px4,.bin" : firmwareStack === "betaflight" ? ".hex,.bin" : ".apj,.bin,.hex";

  return {
    drone, selectedDroneId, firmwareStack, setFirmwareStack,
    // AP
    apBoards: ap.apBoards, apLoading: ap.apLoading, apError: ap.apError, apVersions: ap.apVersions,
    selectedApBoard: ap.selectedApBoard, setSelectedApBoard: ap.setSelectedApBoard,
    selectedVehicleType: ap.selectedVehicleType, setSelectedVehicleType: ap.setSelectedVehicleType,
    selectedApVersion: ap.selectedApVersion, setSelectedApVersion: ap.setSelectedApVersion,
    loadApManifest: ap.loadApManifestRetry,
    // BF
    bfTargets: bf.bfTargets, bfReleases: bf.bfReleases, bfLoading: bf.bfLoading, bfError: bf.bfError,
    selectedBfTarget: bf.selectedBfTarget, setSelectedBfTarget: bf.setSelectedBfTarget,
    selectedBfRelease: bf.selectedBfRelease, setSelectedBfRelease: bf.setSelectedBfRelease,
    bfCustomBuild: bf.bfCustomBuild, setBfCustomBuild: bf.setBfCustomBuild,
    bfBuildOptions: bf.bfBuildOptions, bfSelectedOptions: bf.bfSelectedOptions,
    bfBuildStatus: bf.bfBuildStatus, bfBuildPolling: bf.bfBuildPolling,
    handleBfCloudBuild: bf.handleBfCloudBuild, toggleBfOption: bf.toggleBfOption,
    loadBfTargetsRetry: bf.loadBfTargetsRetry,
    // PX4
    px4Releases: px4.px4Releases, px4Loading: px4.px4Loading, px4Error: px4.px4Error,
    selectedPx4Release: px4.selectedPx4Release, setSelectedPx4Release: px4.setSelectedPx4Release,
    selectedPx4Board: px4.selectedPx4Board, setSelectedPx4Board: px4.setSelectedPx4Board,
    px4Boards: px4.px4Boards,
    loadPx4ReleasesRetry: px4.loadPx4ReleasesRetry,
    // ADOS
    adosBoards: ados.adosBoards, adosLoading: ados.adosLoading, adosError: ados.adosError,
    adosAgentVersion: ados.adosAgentVersion,
    adosManifestSource: ados.adosManifestSource,
    selectedAdosBoardId: ados.selectedAdosBoardId, setSelectedAdosBoardId: ados.setSelectedAdosBoardId,
    adosInstallMethod: ados.adosInstallMethod,
    loadAdosManifestRetry: ados.loadAdosManifestRetry,
    // Common
    flashMethod: core.flashMethod, setFlashMethod: core.setFlashMethod,
    dfuDevices: core.dfuDevices, customFile: core.customFile, useCustom: core.useCustom, setUseCustom: core.setUseCustom,
    progress: core.progress, isFlashing: core.isFlashing, flashMessage: core.flashMessage, setFlashMessage: core.setFlashMessage,
    flashError: core.flashError,
    checked: core.checked, setChecked: core.setChecked, checklistItems: core.checklistItems, allChecked: core.allChecked,
    serialSupported: core.serialSupported, usbSupported: core.usbSupported,
    currentFlashMethods, isLoading, currentError, customFileAccept,
    handleFlash, flashBlockedReason: isHardBlocked ? hardBlockMessage : null,
    handleAbort: core.handleAbort, handleCustomFile: core.handleCustomFile,
    handleDetectDfu: core.handleDetectDfu, handleSelectBootloader: core.handleSelectBootloader,
  };
}
