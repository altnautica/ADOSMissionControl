/**
 * @module fc/firmware/firmware-state/use-flash-core
 * @description Stack-agnostic flash plumbing shared by every firmware
 * stack: browser-capability detection, the DFU hotplug listener, the
 * pre-flight checklist, the custom-file picker, the live progress /
 * message / error state, the FlashManager handle, and the manual
 * bootloader + abort + DFU-detect handlers. The stack-specific flash
 * orchestration (which firmware to download) lives in the aggregator
 * and drives this core through the exposed refs + setters.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FlashProgress,
  FlashPhase,
  FlashMethod,
  FirmwareStack,
} from "@/lib/protocol/firmware/types";
import type { FlashRemedy } from "../flash-error-map";
import { FlashManager } from "@/lib/protocol/firmware/flash-manager";
import { STM32DfuFlasher } from "@/lib/protocol/firmware/stm32-dfu";
import { usbDeviceManager, type UsbDeviceInfo } from "@/lib/usb-device-manager";
import {
  CHECKLIST_ITEMS_BY_STACK, FC_CHECKLIST_ITEMS,
} from "../firmware-constants";

const FLASH_LEAVE_WARNING =
  "A firmware flash is running. Leaving this page now can leave the flight controller half-written in its bootloader. Leave anyway?";

export function useFlashCore(firmwareStack: FirmwareStack) {
  const [flashMethod, setFlashMethod] = useState<FlashMethod>("auto");
  const [dfuDevices, setDfuDevices] = useState<UsbDeviceInfo[]>([]);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [progress, setProgress] = useState<FlashProgress | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashError, setFlashError] = useState<FlashRemedy | null>(null);
  const flashManagerRef = useRef<FlashManager | null>(null);
  const hasAutoDetected = useRef(false);
  const lastPhaseRef = useRef<FlashPhase>("idle");
  const lastMsgRef = useRef<string>("");
  const [flashMessage, setFlashMessage] = useState("");
  const [checked, setCheckedState] = useState<Record<string, boolean>>({});
  const setChecked = useCallback((key: string, value: boolean) => {
    setCheckedState((prev) => ({ ...prev, [key]: value }));
  }, []);
  const checklistItems = useMemo(() => CHECKLIST_ITEMS_BY_STACK[firmwareStack] ?? FC_CHECKLIST_ITEMS, [firmwareStack]);
  const allChecked = checklistItems.every((item) => checked[item.key] === true);
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

  // A reload, tab close or in-app navigation mid-erase or mid-write leaves
  // the FC half-written in its bootloader. Warn before any of them while a
  // flash runs: beforeunload covers the tab, a capture-phase click guard
  // covers in-app links (it runs before the router's own click handler).
  useEffect(() => {
    if (!isFlashing) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target;
      const link = target instanceof Element ? target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      if (new URL(link.href, window.location.href).origin !== window.location.origin) return;
      if (window.confirm(FLASH_LEAVE_WARNING)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [isFlashing]);

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

  const handleAbort = useCallback(() => { flashManagerRef.current?.abort(); }, []);

  // Resolve a pending "select device" action from a real user click. The
  // browser requires the device picker to run inside the click gesture.
  const handleSelectBootloader = useCallback(async () => {
    const fm = flashManagerRef.current;
    const action = progress?.action;
    if (!fm || !action) return;
    try {
      await fm.selectBootloaderManually(action);
    } catch {
      // User dismissed the picker — leave the action visible to retry.
    }
  }, [progress]);

  const handleCustomFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setCustomFile(file); setUseCustom(true); }
  };

  return {
    flashMethod, setFlashMethod,
    dfuDevices,
    customFile, useCustom, setUseCustom,
    progress, setProgress,
    isFlashing, setIsFlashing,
    flashError, setFlashError,
    flashMessage, setFlashMessage,
    flashManagerRef, hasAutoDetected, lastPhaseRef, lastMsgRef,
    checked, setChecked, checklistItems, allChecked,
    serialSupported, usbSupported,
    handleDetectDfu, handleAbort, handleSelectBootloader, handleCustomFile,
  };
}
