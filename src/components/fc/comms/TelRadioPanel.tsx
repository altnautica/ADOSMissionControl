"use client";

import { useTranslations } from "next-intl";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { usePanelCommit } from "@/hooks/use-panel-commit";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { ParamEnumSelect, useParamEnums } from "../shared/ParamEnumSelect";

import { Radio, Save, Signal } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import {
  TELRADIO_PARAMS, OPTIONAL_TELRADIO_PARAMS,
  radioLevel, RssiBar, LiveStat,
} from "./telradio-helpers";
import { FcSection } from "@/components/fc/shared/FcSection";

import { PanelSaveBar } from "@/components/fc/shared/PanelSaveBar";

/** PX4 has no SERIALn_* or SYSID_* parameters (it uses MAV_n_* and MAV_SYS_ID). */
const NO_PARAMS: string[] = [];

export function TelRadioPanel() {
  const tr = useTranslations("fcPanels.telRadioPanel");
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { label: pl } = useParamLabel();
  const paramMeta = useParamMetadataMap();
  const { enumValues } = useParamEnums(paramMeta);
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={paramMeta} />;

  // Re-renders on each RADIO_STATUS and blanks once the stream goes stale.
  const latestRadio = useFreshTelemetry("radio");

  const { firmwareType } = useFirmwareCapabilities();
  const isPx4 = firmwareType === "px4";
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash, revertAll,
  } = usePanelParams({
    paramNames: isPx4 ? NO_PARAMS : TELRADIO_PARAMS,
    optionalParams: isPx4 ? NO_PARAMS : OPTIONAL_TELRADIO_PARAMS,
    panelId: "telradio",
    autoLoad: true,
  });
  useUnsavedGuard(dirtyParams.size > 0);
  const { saving, save: handleSave, flashing, flash: handleFlash } = usePanelCommit({ saveAllToRam, commitToFlash, revertAll });

  const connected = !!selectedProtocol;
  const hasDirty = dirtyParams.size > 0;

  const set = (name: string, v: string) => setLocalValue(name, Number(v) || 0);
  // A parameter that was not read is shown as such, never as a default.
  const unread = (label: string) => (
    <div>
      <span className="text-xs text-text-secondary">{lbl(label)}</span>
      <p className="text-xs font-mono text-text-tertiary">{hasLoaded ? tr("notPresent") : "—"}</p>
    </div>
  );
  const enumField = (name: string, label: string) => {
    const value = params.get(name);
    if (value === undefined) return unread(`${name} — ${label}`);
    return (
      <ParamEnumSelect
        label={lbl(`${name} — ${label}`)}
        values={enumValues(name)}
        value={value}
        onChange={(v) => setLocalValue(name, v)}
      />
    );
  };
  const idField = (name: string, label: string) => {
    const value = params.get(name);
    if (value === undefined) return unread(`${name} — ${label}`);
    return (
      <Input
        label={lbl(`${name} — ${label}`)}
        type="number"
        step="1"
        min="1"
        max="255"
        value={String(value)}
        onChange={(e) => set(name, e.target.value)}
      />
    );
  };

  return (
    <ArmedWarningBanner>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title={tr("telemetryRadio")}
            subtitle={tr("radioLinkStatusAndSerial")}
            icon={<Radio size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {/* Link Status */}
          <FcSection icon={<Signal size={14} />} title={tr("linkStatus")} description={tr("liveRADIOSTATUSTelemetry")}>
            {latestRadio ? (
              <div className="space-y-3">
                <RssiBar label={tr("localRSSI")} value={latestRadio.rssi} />
                <RssiBar label={tr("remoteRSSI")} value={latestRadio.remrssi} />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
                  <LiveStat label={tr("txBuffer")} value={`${latestRadio.txbuf}`} unit="%" />
                  <LiveStat label={tr("noiseDeviceScale")} value={radioLevel(latestRadio.noise)} unit="" />
                  <LiveStat label={tr("rxErrors")} value={`${latestRadio.rxerrors}`} unit="" />
                  <LiveStat label={tr("fixed")} value={`${latestRadio.fixed}`} unit="" />
                </div>
                <div className="text-[10px] text-text-tertiary">
                  Remote noise (device scale): {radioLevel(latestRadio.remnoise)}
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-text-tertiary">{tr("noRadioTelemetry")}</p>
            )}
          </FcSection>

          {isPx4 ? (
            <p className="text-[10px] text-text-tertiary">{tr("px4BaudUnderPorts")}</p>
          ) : (
            <>
              {/* Serial Port Config */}
              <FcSection icon={<Radio size={14} />} title={tr("serialPortConfiguration")} description={tr("protocolAndBaudRateFor")}>
                <div className="space-y-4">
                  <div>
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">SERIAL1 (TELEM1)</span>
                    <div className="mt-2 space-y-2">
                      {enumField("SERIAL1_PROTOCOL", tr("protocol"))}
                      {enumField("SERIAL1_BAUD", tr("baudRate"))}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">SERIAL2 (TELEM2)</span>
                    <div className="mt-2 space-y-2">
                      {enumField("SERIAL2_PROTOCOL", tr("protocol"))}
                      {enumField("SERIAL2_BAUD", tr("baudRate"))}
                    </div>
                  </div>
                </div>
              </FcSection>

              {/* System ID */}
              <FcSection icon={<Radio size={14} />} title={tr("systemIdentification")} description={tr("mavlinkSystemAndGCSIDs")}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {idField("SYSID_THISMAV", tr("vehicleSystemId"))}
                  {idField("SYSID_MYGCS", tr("gcsSystemId"))}
                </div>
                <p className="text-[10px] text-text-tertiary mt-1">{tr("uniqueSysidHint")}</p>
              </FcSection>
            </>
          )}

          {/* Save: PX4 has nothing to write here. */}
          {!isPx4 && (
            <PanelSaveBar
              onSave={handleSave}
              saving={saving}
              saveDisabled={!hasDirty || !connected}
              showFlash={hasRamWrites}
              onFlash={handleFlash}
              flashing={flashing}
              showConnectHint={!connected}
              showUnsavedHint={hasDirty && connected}
            />
          )}
        </div>
      </div>
    </ArmedWarningBanner>
  );
}
