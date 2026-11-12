"use client";

/**
 * @module drone-scripts/ScrConfigCard
 * @description The SCR_* scripting-engine config card for the ArduPilot Scripts
 * tab: enable the Lua VM, size its heap + per-loop instruction budget, and set
 * the debug/diagnostic bitmask. Enabling scripting (or changing the heap) needs
 * a reboot, so the card surfaces a "Reboot FC" action. Reuses the standard FC
 * panel machinery (usePanelParams + PanelHeader + armed guard).
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Cpu, Save, HardDrive, RotateCw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { BitmaskEditor } from "@/components/ui/bitmask-editor";
import { useToast } from "@/components/ui/toast";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "@/components/fc/shared/PanelHeader";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import {
  SCR_PARAM_NAMES,
  SCR_OPTIONAL_PARAM_NAMES,
  SCR_ENABLE_VALUES,
  SCR_DEBUG_OPTS_BITS,
} from "./scripts-constants";
import { SaveBarLabel } from "@/components/fc/shared/SaveBarLabel";
import { RebootFcButton } from "@/components/fc/shared/RebootFcButton";

const ENABLE_OPTIONS: SelectOption[] = [...SCR_ENABLE_VALUES.entries()].map(
  ([code, label]) => ({ value: String(code), label: `${code}: ${label}` }),
);

// usePanelParams memoizes on the array reference — keep these module-level.
const PARAM_NAMES = [...SCR_PARAM_NAMES];
const OPTIONAL_NAMES = [...SCR_OPTIONAL_PARAM_NAMES];

export function ScrConfigCard() {
  const tk = useTranslations("dashboard.scrConfigCard");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const [debugOpen, setDebugOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  const panelParams = usePanelParams({
    paramNames: PARAM_NAMES,
    optionalParams: OPTIONAL_NAMES,
    panelId: "scr-config",
    autoLoad: true,
  });
  const {
    params,
    loading,
    error,
    dirtyParams,
    hasRamWrites,
    loadProgress,
    hasLoaded,
    missingOptional,
    refresh,
    setLocalValue,
  } = panelParams;
  const { saving, save: handleSave, flashing, flash: handleFlash } =
    useParamPanelActions(panelParams);
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;
  const p = (name: string, fallback = 0) => params.get(name) ?? fallback;

  const debugValue = p("SCR_DEBUG_OPTS");
  const scriptingOn = p("SCR_ENABLE") >= 1;

  async function handleReboot() {
    const protocol = selectedProtocol;
    if (!protocol) return;
    setRebooting(true);
    try {
      const result = await protocol.reboot();
      if (result.success) {
        toast(tk("rebootCommandSentToThe"), "info");
      } else {
        toast(result.message || tk("rebootRefused"), "error");
      }
    } catch {
      toast(tk("failedToSendRebootCommand"), "error");
    } finally {
      setRebooting(false);
    }
  }

  return (
    <ArmedWarningBanner>
      <div className="border border-border-default bg-bg-secondary p-4 space-y-4">
        <PanelHeader
          title={tk("scriptingEngine")}
          subtitle={tk("enableTheOnboardLuaVM")}
          icon={<Cpu size={16} />}
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          missingOptional={missingOptional}
          onRead={refresh}
          connected={connected}
          error={error}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label={tk("scripting")}
            options={ENABLE_OPTIONS}
            value={String(p("SCR_ENABLE"))}
            onChange={(v) => setLocalValue("SCR_ENABLE", Number(v) || 0)}
          />
          <div className="flex items-end">
            <Button
              variant="secondary"
              size="md"
              icon={<SlidersHorizontal size={13} />}
              onClick={() => setDebugOpen(true)}
              className="w-full"
            >
              Debug Options ({debugValue})
            </Button>
          </div>
          <Input
            label={tk("heapSize")}
            type="number"
            step="1024"
            min="0"
            unit="bytes"
            value={String(p("SCR_HEAP_SIZE"))}
            onChange={(e) => setLocalValue("SCR_HEAP_SIZE", Number(e.target.value) || 0)}
          />
          <Input
            label={tk("vmInstructionCount")}
            type="number"
            step="1000"
            min="0"
            value={String(p("SCR_VM_I_COUNT"))}
            onChange={(e) => setLocalValue("SCR_VM_I_COUNT", Number(e.target.value) || 0)}
          />
        </div>

        <p className="text-[10px] text-text-tertiary">
          Enabling scripting or changing the heap size takes effect after a
          reboot. The instruction count caps how much work a script may do per
          loop before it is stopped — raise it for heavy scripts, lower it to
          protect the flight loop.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            variant="primary"
            size="md"
            icon={<Save size={14} />}
            disabled={!hasDirty || !connected}
            loading={saving}
            onClick={handleSave}
          >
            <SaveBarLabel k="saveToFc" />
          </Button>
          {hasRamWrites && (
            <Button
              variant="secondary"
              size="md"
              icon={<HardDrive size={14} />}
              loading={flashing} onClick={handleFlash}
            >
              <SaveBarLabel k="writeToFlash" />
            </Button>
          )}
          <RebootFcButton
            variant="secondary"
            size="md"
            icon={<RotateCw size={14} />}
            disabled={!connected}
            loading={rebooting}
            onReboot={handleReboot}
            label={tk("rebootFC")}
          />
          {hasDirty && connected && (
            <span className="text-[10px] text-status-warning"><SaveBarLabel k="unsavedChanges" /></span>
          )}
          {!scriptingOn && connected && hasLoaded && (
            <span className="text-[10px] text-status-warning">
              Scripting is disabled — set it to &ldquo;Lua scripts&rdquo; and reboot to run scripts.
            </span>
          )}
        </div>

        <BitmaskEditor
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
          title="SCR_DEBUG_OPTS"
          bitmask={SCR_DEBUG_OPTS_BITS}
          value={debugValue}
          onApply={(next) => {
            setLocalValue("SCR_DEBUG_OPTS", next);
            setDebugOpen(false);
          }}
        />
      </div>
    </ArmedWarningBanner>
  );
}
