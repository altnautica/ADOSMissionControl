"use client";

import type { FlashMethod, FirmwareStack } from "@/lib/protocol/firmware/types";
import { AlertTriangle, Zap, Usb } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UsbDeviceInfo } from "@/lib/usb-device-manager";
import { FIRMWARE_STACKS } from "./firmware-constants";

// ── DFU Status Banner ──────────────────────────────────

export function DfuStatusBanner({
  dfuDevices, selectedDroneId, usbSupported, isFlashing, onDetectDfu,
}: {
  dfuDevices: UsbDeviceInfo[];
  selectedDroneId: string | null;
  usbSupported: boolean;
  isFlashing: boolean;
  onDetectDfu: () => void;
}) {
  if (dfuDevices.length > 0) {
    return (
      <div className="border border-status-success/40 bg-status-success/5 p-4 space-y-2">
        <p className="text-xs text-status-success font-semibold">DFU Device Connected</p>
        <p className="text-[10px] text-text-secondary">{dfuDevices.map((d) => d.label).join(", ")} — ready to flash.</p>
      </div>
    );
  }
  if (selectedDroneId) {
    return (
      <div className="border border-status-warning/40 bg-status-warning/5 p-4 space-y-2">
        <p className="text-xs text-status-warning font-semibold">FC Connected via MAVLink</p>
        <p className="text-[10px] text-text-secondary">
          Your FC is connected via MAVLink. For DFU flashing, disconnect and reconnect while holding the BOOT button.
        </p>
        {usbSupported && (
          <button onClick={onDetectDfu} disabled={isFlashing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
            <Usb size={12} /> Scan for DFU
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-2">
      <p className="text-xs text-text-secondary font-semibold">No Connection</p>
      <p className="text-[10px] text-text-tertiary">
        Connect your FC in DFU mode: hold BOOT while plugging in USB, then click Scan.
      </p>
      {usbSupported && (
        <button onClick={onDetectDfu} disabled={isFlashing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-tertiary disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
          <Usb size={12} /> Scan for DFU
        </button>
      )}
    </div>
  );
}

// ── Firmware Stack Selector ────────────────────────────

export function FirmwareStackSelector({
  firmwareStack, setFirmwareStack, isFlashing, setUseCustom, droneType,
}: {
  firmwareStack: FirmwareStack;
  setFirmwareStack: (s: FirmwareStack) => void;
  isFlashing: boolean;
  setUseCustom: (v: boolean) => void;
  droneType?: string;
}) {
  const t = useTranslations("flashTool.ados");
  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
      <h2 className="text-xs font-semibold text-text-primary">Firmware Stack</h2>
      <div
        role="radiogroup"
        aria-label={t("a11y.stackGroupLabel")}
        className="flex gap-2"
      >
        {FIRMWARE_STACKS.map(({ id, label, labelKey }) => {
          const isActive = firmwareStack === id;
          return (
            <button key={id}
              role="radio"
              aria-checked={isActive}
              onClick={() => { setFirmwareStack(id); setUseCustom(false); }}
              disabled={isFlashing}
              className={`flex-1 px-3 py-2 text-xs font-semibold border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
                isActive ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-default text-text-secondary hover:text-text-primary"
              }`}>
              {labelKey ? t(labelKey) : label}
            </button>
          );
        })}
      </div>
      {droneType && <p className="text-[10px] text-text-tertiary">Auto-detected from connected drone: {droneType}</p>}
    </div>
  );
}

// ── Flash Method Selector ──────────────────────────────

export function FlashMethodSelector({
  flashMethod, setFlashMethod, currentFlashMethods, serialSupported, usbSupported, dfuDevices,
}: {
  flashMethod: FlashMethod;
  setFlashMethod: (m: FlashMethod) => void;
  currentFlashMethods: { id: FlashMethod; label: string; icon: typeof Usb; desc: string }[];
  serialSupported: boolean;
  usbSupported: boolean;
  dfuDevices: UsbDeviceInfo[];
}) {
  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
      <h2 className="text-xs font-semibold text-text-primary">Flash Method</h2>
      <div className="flex gap-3">
        {currentFlashMethods.map(({ id, label, icon: Icon, desc }) => {
          const disabled = ((id === "st-rom-serial" || id === "px4-serial") && !serialSupported) || (id === "dfu" && !usbSupported);
          return (
            <button key={id} onClick={() => !disabled && setFlashMethod(id)} disabled={disabled}
              className={`flex-1 px-3 py-2 text-left border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                flashMethod === id ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-default text-text-secondary"
              }`}>
              <div className="flex items-center gap-1.5">
                <Icon size={12} />
                <span className="text-xs font-semibold">{label}</span>
              </div>
              <p className="text-[10px] text-text-tertiary mt-0.5">{desc}</p>
            </button>
          );
        })}
      </div>
      {(flashMethod === "dfu" || flashMethod === "auto") && usbSupported && (
        <div className="mt-2">
          {dfuDevices.length > 0
            ? <p className="text-[10px] text-status-success">{dfuDevices.length} DFU device{dfuDevices.length > 1 ? "s" : ""} ready: {dfuDevices.map((d) => d.label).join(", ")}</p>
            : <p className="text-[10px] text-text-tertiary">No DFU devices detected. Use the Scan button above to find one.</p>
          }
        </div>
      )}
    </div>
  );
}

// ── Pre-Flash Checklist ────────────────────────────────

export interface ChecklistItem {
  key: string;
  label: string;
  labelKey?: string;
}

export function PreFlashChecklist({
  items, checked, setChecked, intro,
}: {
  items: readonly ChecklistItem[];
  checked: Record<string, boolean>;
  setChecked: (key: string, value: boolean) => void;
  intro?: string;
}) {
  const t = useTranslations("flashTool.ados");
  return (
    <div className="bg-bg-secondary border border-status-warning/30 p-4 space-y-3">
      <h2 className="text-xs font-semibold text-status-warning flex items-center gap-2">
        <AlertTriangle size={14} />
        Pre-Flash Safety Checklist
      </h2>
      <p className="text-[10px] text-text-tertiary">
        {intro ?? "Flashing new firmware will erase all current settings. Complete all checks before proceeding."}
      </p>
      <div className="space-y-2">
        {items.map(({ key, label, labelKey }) => (
          <label key={key} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={checked[key] ?? false}
              onChange={(e) => setChecked(key, e.target.checked)}
              className="accent-accent-primary"
            />
            {labelKey ? t(labelKey) : label}
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Firmware Source Toggle ──────────────────────────────

export function FirmwareSourceToggle({
  firmwareStack, useCustom, setUseCustom, customFileAccept, customFile, onCustomFile,
}: {
  firmwareStack: FirmwareStack;
  useCustom: boolean;
  setUseCustom: (v: boolean) => void;
  customFileAccept: string;
  customFile: File | null;
  onCustomFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const label = firmwareStack === "ardupilot" ? "ArduPilot" : firmwareStack === "betaflight" ? "Betaflight" : "PX4";
  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
      <h2 className="text-xs font-semibold text-text-primary flex items-center gap-2">
        <Zap size={14} />
        Firmware Source
      </h2>
      <div className="flex gap-3">
        <button onClick={() => setUseCustom(false)}
          className={`flex-1 px-3 py-2 text-xs border cursor-pointer ${!useCustom ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-default text-text-secondary"}`}>
          {label} Official
        </button>
        <button onClick={() => setUseCustom(true)}
          className={`flex-1 px-3 py-2 text-xs border cursor-pointer ${useCustom ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-default text-text-secondary"}`}>
          Custom File
        </button>
      </div>
      {useCustom && (
        <div>
          <label className="text-[10px] text-text-tertiary uppercase block mb-1">Firmware File ({customFileAccept})</label>
          <input type="file" accept={customFileAccept} onChange={onCustomFile}
            className="w-full text-xs text-text-secondary file:bg-bg-tertiary file:text-text-primary file:border file:border-border-default file:px-3 file:py-1.5 file:text-xs file:mr-3 file:cursor-pointer" />
          {customFile && <p className="text-[10px] text-text-tertiary mt-1 font-mono">{customFile.name} ({(customFile.size / 1024).toFixed(1)} KB)</p>}
        </div>
      )}
    </div>
  );
}
