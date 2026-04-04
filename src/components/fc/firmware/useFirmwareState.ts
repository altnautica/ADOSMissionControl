"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import type {
  FlashProgress, FlashMethod, FirmwareStack, ManifestBoard, ParsedFirmware,
  BetaflightTarget, BetaflightRelease, BetaflightBuildOptions, BetaflightBuildStatus,
  PX4Release,
} from "@/lib/protocol/firmware/types";
import { ArduPilotManifest } from "@/lib/protocol/firmware/manifest";
import { BetaflightManifest } from "@/lib/protocol/firmware/betaflight-manifest";
import { PX4Manifest } from "@/lib/protocol/firmware/px4-manifest";
import { FlashManager } from "@/lib/protocol/firmware/flash-manager";
import { parseApjFile } from "@/lib/protocol/firmware/apj-parser";
import { parseHexFile } from "@/lib/protocol/firmware/hex-parser";
import { parsePx4File } from "@/lib/protocol/firmware/px4-parser";
import { STM32DfuFlasher } from "@/lib/protocol/firmware/stm32-dfu";
import { usbDeviceManager, type UsbDeviceInfo } from "@/lib/usb-device-manager";
import { AP_FLASH_METHODS, BF_FLASH_METHODS, PX4_FLASH_METHODS } from "./firmware-constants";

const apManifest = new ArduPilotManifest();
const bfManifest = new BetaflightManifest();
const px4Manifest = new PX4Manifest();

export function useFirmwareState() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const getSelectedDrone = useDroneManager((s) => s.getSelectedDrone);
  const { toast } = useToast();
  const drone = getSelectedDrone();

  const [firmwareStack, setFirmwareStack] = useState<FirmwareStack>("ardupilot");

  // ArduPilot state
  const [apBoards, setApBoards] = useState<ManifestBoard[]>([]);
  const [apLoading, setApLoading] = useState(false);
  const [apError, setApError] = useState("");
  const [apVersions, setApVersions] = useState<string[]>([]);
  const [selectedApBoard, setSelectedApBoard] = useState("");
  const [selectedVehicleType, setSelectedVehicleType] = useState("Copter");
  const [selectedApVersion, setSelectedApVersion] = useState("");

  // Betaflight state
  const [bfTargets, setBfTargets] = useState<BetaflightTarget[]>([]);
  const [bfReleases, setBfReleases] = useState<BetaflightRelease[]>([]);
  const [bfLoading, setBfLoading] = useState(false);
  const [bfError, setBfError] = useState("");
  const [selectedBfTarget, setSelectedBfTarget] = useState("");
  const [selectedBfRelease, setSelectedBfRelease] = useState("");
  const [bfCustomBuild, setBfCustomBuild] = useState(false);
  const [bfBuildOptions, setBfBuildOptions] = useState<BetaflightBuildOptions | null>(null);
  const [bfSelectedOptions, setBfSelectedOptions] = useState<string[]>([]);
  const [bfBuildStatus, setBfBuildStatus] = useState<BetaflightBuildStatus | null>(null);
  const [bfBuildPolling, setBfBuildPolling] = useState(false);

  // PX4 state
  const [px4Releases, setPx4Releases] = useState<PX4Release[]>([]);
  const [px4Loading, setPx4Loading] = useState(false);
  const [px4Error, setPx4Error] = useState("");
  const [selectedPx4Release, setSelectedPx4Release] = useState("");
  const [selectedPx4Board, setSelectedPx4Board] = useState("");

  // Common state
  const [flashMethod, setFlashMethod] = useState<FlashMethod>("auto");
  const [dfuDevices, setDfuDevices] = useState<UsbDeviceInfo[]>([]);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const flashManagerRef = useRef<FlashManager | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoDetected = useRef(false);
  const [flashMessage, setFlashMessage] = useState("");
  const [checklist, setChecklist] = useState({ paramBackup: false, propsRemoved: false, batteryOff: false });
  const allChecked = checklist.paramBackup && checklist.propsRemoved && checklist.batteryOff;
  const [serialSupported, setSerialSupported] = useState(false);
  const [usbSupported, setUsbSupported] = useState(false);

  // Browser support check + USB hotplug listener
  useEffect(() => {
    setSerialSupported("serial" in navigator);
    setUsbSupported(STM32DfuFlasher.isSupported());
    if (STM32DfuFlasher.isSupported()) {
      STM32DfuFlasher.getKnownDevices().then(setDfuDevices).catch(() => {});
      // Initialize hotplug detection so DFU devices are detected
      // automatically during bootloader wait (no picker needed)
      usbDeviceManager.init();
      const unsubConnect = usbDeviceManager.onConnect((info) => {
        if (info.isDfu) {
          setDfuDevices((prev) => [...prev.filter((d) => d.label !== info.label), info]);
        }
      });
      const unsubDisconnect = usbDeviceManager.onDisconnect((info) => {
        if (info.isDfu) {
          setDfuDevices((prev) => prev.filter((d) => d.label !== info.label));
        }
      });
      return () => { unsubConnect(); unsubDisconnect(); };
    }
  }, []);

  useEffect(() => { return () => { if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current); }; }, []);

  // Auto-detect firmware stack from connected drone
  useEffect(() => {
    if (drone && !hasAutoDetected.current) {
      hasAutoDetected.current = true;
      const ft = drone.vehicleInfo.firmwareType;
      if (ft.startsWith("ardupilot")) setFirmwareStack("ardupilot");
      else if (ft === "betaflight") setFirmwareStack("betaflight");
      else if (ft === "px4") setFirmwareStack("px4");
    }
  }, [drone]);

  // Load data when firmware stack changes
  useEffect(() => {
    if (firmwareStack === "ardupilot" && apBoards.length === 0) loadApManifest();
    else if (firmwareStack === "betaflight" && bfTargets.length === 0) loadBfTargets();
    else if (firmwareStack === "px4" && px4Releases.length === 0) loadPx4Releases();
    setFlashMethod("auto");
  }, [firmwareStack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (firmwareStack === "ardupilot" && selectedApBoard && selectedVehicleType) {
      setSelectedApVersion("");
      loadApVersions(selectedApBoard, selectedVehicleType);
    }
  }, [selectedApBoard, selectedVehicleType, firmwareStack]);

  useEffect(() => {
    if (firmwareStack === "betaflight" && selectedBfTarget) loadBfReleases(selectedBfTarget);
  }, [selectedBfTarget, firmwareStack]);

  useEffect(() => {
    if (firmwareStack === "betaflight" && bfCustomBuild && selectedBfRelease) loadBfBuildOptions(selectedBfRelease);
  }, [selectedBfRelease, bfCustomBuild, firmwareStack]);

  useEffect(() => {
    if (drone && apBoards.length > 0 && !selectedApBoard && firmwareStack === "ardupilot") {
      const info = drone.vehicleInfo;
      const firmwareStr = info.firmwareVersionString?.toLowerCase() ?? "";
      const match = apBoards.find((b) => firmwareStr.includes(b.name.toLowerCase()));
      if (match) setSelectedApBoard(match.name);
      const classMap: Record<string, string> = { copter: "Copter", plane: "Plane", rover: "Rover", sub: "Sub" };
      const vc = info.vehicleClass;
      if (vc && classMap[vc]) setSelectedVehicleType(classMap[vc]);
    }
  }, [drone, apBoards, selectedApBoard, firmwareStack]);

  // Manifest loaders
  async function loadApManifest() {
    setApLoading(true); setApError("");
    try {
      await apManifest.getManifest();
      const boardList = await apManifest.getBoards();
      setApBoards(boardList);
      if (boardList.length > 0 && !selectedApBoard) setSelectedApBoard(boardList[0].name);
    } catch (err) { setApError(err instanceof Error ? err.message : "Failed to load ArduPilot manifest"); }
    finally { setApLoading(false); }
  }

  async function loadApVersions(board: string, vehicleType: string) {
    try {
      const v = await apManifest.getVersions(board, vehicleType);
      setApVersions(v);
      if (v.length > 0) {
        const stable = v.find((x) => x.toLowerCase().startsWith("stable") || x === "OFFICIAL") ?? v[0];
        setSelectedApVersion(stable);
      }
    } catch { setApVersions([]); }
  }

  async function loadBfTargets() {
    setBfLoading(true); setBfError("");
    try {
      const targets = await bfManifest.getTargets();
      setBfTargets(targets);
      if (targets.length > 0 && !selectedBfTarget) setSelectedBfTarget(targets[0].target);
    } catch (err) { setBfError(err instanceof Error ? err.message : "Failed to load Betaflight targets"); }
    finally { setBfLoading(false); }
  }

  async function loadBfReleases(target: string) {
    try {
      const releases = await bfManifest.getReleasesForTarget(target);
      setBfReleases(releases);
      if (releases.length > 0) setSelectedBfRelease(releases[0].release);
    } catch { setBfReleases([]); }
  }

  async function loadBfBuildOptions(release: string) {
    try { const opts = await bfManifest.getBuildOptions(release); setBfBuildOptions(opts); }
    catch { setBfBuildOptions(null); }
  }

  async function loadPx4Releases() {
    setPx4Loading(true); setPx4Error("");
    try {
      const releases = await px4Manifest.getReleases();
      setPx4Releases(releases);
      const stable = releases.find((r) => !r.prerelease);
      if (stable) setSelectedPx4Release(stable.tag);
      else if (releases.length > 0) setSelectedPx4Release(releases[0].tag);
    } catch (err) { setPx4Error(err instanceof Error ? err.message : "Failed to load PX4 releases"); }
    finally { setPx4Loading(false); }
  }

  // BF cloud build
  async function handleBfCloudBuild() {
    if (!selectedBfTarget || !selectedBfRelease) return;
    setBfBuildPolling(true); setBfBuildStatus(null);
    try {
      const status = await bfManifest.requestBuild({ target: selectedBfTarget, release: selectedBfRelease, options: bfSelectedOptions });
      setBfBuildStatus(status);
      if (status.status !== "success" && status.status !== "error") pollBfBuild(status.key);
    } catch (err) { setBfBuildPolling(false); toast(err instanceof Error ? err.message : "Cloud build failed", "error"); }
  }

  function pollBfBuild(key: string, attempt = 0) {
    if (attempt > 60) { setBfBuildPolling(false); setBfBuildStatus((prev) => prev ? { ...prev, status: "error" } : null); return; }
    pollTimeoutRef.current = setTimeout(async () => {
      try {
        const status = await bfManifest.pollBuildStatus(key);
        setBfBuildStatus(status);
        if (status.status === "success" || status.status === "error") { setBfBuildPolling(false); return; }
        pollBfBuild(key, attempt + 1);
      } catch { setBfBuildPolling(false); }
    }, 5000);
  }

  function toggleBfOption(option: string) {
    setBfSelectedOptions((prev) => prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]);
  }

  // DFU detect
  async function handleDetectDfu() {
    try {
      const device = await STM32DfuFlasher.requestDevice();
      setFlashMessage(`DFU device detected: ${device.productName || "DFU Device"} (${device.vendorId.toString(16).padStart(4, "0")}:${device.productId.toString(16).padStart(4, "0")})`);
      STM32DfuFlasher.getKnownDevices().then(setDfuDevices).catch(() => {});
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") setFlashMessage("No DFU device selected. Ensure the FC is in DFU mode (hold BOOT button + plug USB), then try again.");
      else if (err instanceof DOMException && err.name === "SecurityError") setFlashMessage("WebUSB blocked. Serve Command over HTTPS or localhost.");
      else { const msg = err instanceof Error ? err.message : "Unknown error"; if (!msg.includes("cancelled") && !msg.includes("aborted")) setFlashMessage(`DFU detection failed: ${msg}`); }
    }
  }

  // Flash handler
  const handleFlash = useCallback(async () => {
    setIsFlashing(true); setProgress(null); setFlashMessage("");
    try {
      let firmware: ParsedFirmware;
      if (useCustom && customFile) {
        const content = await customFile.text();
        const name = customFile.name.toLowerCase();
        if (name.endsWith(".hex")) firmware = parseHexFile(content);
        else if (name.endsWith(".apj")) firmware = parseApjFile(content);
        else if (name.endsWith(".px4")) firmware = parsePx4File(content);
        else { const buffer = await customFile.arrayBuffer(); firmware = { blocks: [{ address: 0x08000000, data: new Uint8Array(buffer) }], totalBytes: buffer.byteLength }; }
      } else if (firmwareStack === "ardupilot") {
        setProgress({ phase: "idle", percent: 0, message: "Downloading firmware..." });
        const url = await apManifest.getFirmwareUrl(selectedApBoard, selectedVehicleType, selectedApVersion);
        if (!url) throw new Error(`No firmware found for ${selectedApBoard} / ${selectedVehicleType} / ${selectedApVersion}`);
        const useDfu = flashMethod === "dfu" || (flashMethod === "auto" && dfuDevices.length > 0);
        firmware = await apManifest.downloadFirmware(url, { forDfu: useDfu });
      } else if (firmwareStack === "betaflight") {
        setProgress({ phase: "idle", percent: 0, message: "Downloading firmware..." });
        if (bfCustomBuild) {
          if (!bfBuildStatus || bfBuildStatus.status !== "success" || !bfBuildStatus.url) throw new Error("Custom build not ready. Build firmware first, then flash.");
          firmware = await bfManifest.downloadFirmware(bfBuildStatus.url);
        } else {
          const info = await bfManifest.getBuildInfo(selectedBfTarget, selectedBfRelease);
          firmware = await bfManifest.downloadFirmware(info.url);
        }
      } else {
        setProgress({ phase: "idle", percent: 0, message: "Downloading firmware..." });
        const url = await px4Manifest.getFirmwareUrl(selectedPx4Release, selectedPx4Board);
        if (!url) throw new Error(`No firmware found for ${selectedPx4Release} / ${selectedPx4Board}`);
        firmware = await px4Manifest.downloadFirmware(url);
      }
      setFlashMessage(`Firmware: ${(firmware.totalBytes / 1024).toFixed(1)} KB` + (firmware.boardId ? ` (board ID: ${firmware.boardId})` : ""));
      const protocol = drone?.protocol ?? null;
      const transport = drone?.transport ?? null;
      const fm = new FlashManager(protocol, transport);
      flashManagerRef.current = fm;
      let method = flashMethod;
      if (firmwareStack === "px4" && method === "auto") method = "px4-serial";
      await fm.flash(firmware, { method, backupParams: checklist.paramBackup, verify: true }, (p) => setProgress(p));
    } catch (err) {
      let userMessage = err instanceof Error ? err.message : "Unknown error";
      if (err instanceof DOMException) {
        if (err.name === "NotFoundError") userMessage = "No DFU device selected. Ensure the FC is in DFU mode (hold BOOT button + plug USB), then try again.";
        else if (err.name === "SecurityError") userMessage = "WebUSB blocked. Serve Command over HTTPS or localhost.";
        else if (err.name === "NetworkError") userMessage = "USB device disconnected during operation. Reconnect and retry.";
      }
      if (!userMessage.includes("aborted")) { setProgress({ phase: "error", percent: 0, message: userMessage }); toast("Firmware flash failed", "error"); }
    } finally { setIsFlashing(false); flashManagerRef.current = null; }
  }, [useCustom, customFile, firmwareStack, selectedApBoard, selectedVehicleType, selectedApVersion,
      selectedBfTarget, selectedBfRelease, bfCustomBuild, bfBuildStatus, selectedPx4Release, selectedPx4Board,
      flashMethod, drone, checklist.paramBackup, toast, dfuDevices.length]);

  const handleAbort = useCallback(() => { flashManagerRef.current?.abort(); }, []);

  const handleCustomFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setCustomFile(file); setUseCustom(true); }
  };

  const currentFlashMethods = firmwareStack === "px4" ? PX4_FLASH_METHODS : firmwareStack === "betaflight" ? BF_FLASH_METHODS : AP_FLASH_METHODS;
  const isLoading = firmwareStack === "ardupilot" ? apLoading : firmwareStack === "betaflight" ? bfLoading : px4Loading;
  const currentError = firmwareStack === "ardupilot" ? apError : firmwareStack === "betaflight" ? bfError : px4Error;
  const px4SelectedRelease = px4Releases.find((r) => r.tag === selectedPx4Release);
  const px4Boards = px4SelectedRelease?.boards ?? [];
  const customFileAccept = firmwareStack === "px4" ? ".px4,.bin" : firmwareStack === "betaflight" ? ".hex,.bin" : ".apj,.bin,.hex";

  return {
    drone, selectedDroneId, firmwareStack, setFirmwareStack,
    // AP
    apBoards, apLoading, apError, apVersions, selectedApBoard, setSelectedApBoard,
    selectedVehicleType, setSelectedVehicleType, selectedApVersion, setSelectedApVersion,
    loadApManifest: () => { apManifest.clearCache(); loadApManifest(); },
    // BF
    bfTargets, bfReleases, bfLoading, bfError, selectedBfTarget, setSelectedBfTarget,
    selectedBfRelease, setSelectedBfRelease, bfCustomBuild, setBfCustomBuild,
    bfBuildOptions, bfSelectedOptions, bfBuildStatus, bfBuildPolling,
    handleBfCloudBuild, toggleBfOption,
    loadBfTargetsRetry: () => { bfManifest.clearCache(); loadBfTargets(); },
    // PX4
    px4Releases, px4Loading, px4Error, selectedPx4Release, setSelectedPx4Release,
    selectedPx4Board, setSelectedPx4Board, px4Boards,
    loadPx4ReleasesRetry: () => { px4Manifest.clearCache(); loadPx4Releases(); },
    // Common
    flashMethod, setFlashMethod, dfuDevices, customFile, useCustom, setUseCustom,
    progress, isFlashing, flashMessage, setFlashMessage, checklist, setChecklist, allChecked,
    serialSupported, usbSupported, currentFlashMethods, isLoading, currentError, customFileAccept,
    handleFlash, handleAbort, handleCustomFile, handleDetectDfu,
  };
}
