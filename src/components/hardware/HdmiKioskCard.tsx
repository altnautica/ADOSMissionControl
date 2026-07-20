"use client";

/**
 * @module HdmiKioskCard
 * @description HDMI cockpit / kiosk configuration for the ground-station
 * Display surface. It surfaces the resolved local-display path and the
 * HDMI + touch status, lets the operator edit the reconciled kiosk target
 * URL (`ground_station.kiosk.target_url`, via the agent config write path),
 * and drives the on-panel touch-calibration wizard over the display
 * calibrate routes with live step progress. The crosshairs render on the
 * HDMI panel itself — touch calibration is physical — so the card arms the
 * wizard remotely and polls the live step counter while the operator taps.
 * Renders beside LocalDisplayCard on the ground-station Display tab.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MonitorPlay } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TouchCalibrationStatus } from "@/lib/agent/agent-client/setup";

/** Dot-path the kiosk target URL lives at in the agent config. The write goes
 * through the standard `PUT /api/config` path (`setConfigValue`), which coerces
 * the string to the underlying field type at the agent's config boundary. */
const KIOSK_URL_CONFIG_KEY = "ground_station.kiosk.target_url";
const CALIBRATE_POLL_MS = 1000;
/** Stop auto-polling a calibration the operator abandoned so the loop can't run
 * forever if nobody ever taps the panel. */
const CALIBRATE_DEADLINE_MS = 180_000;
/** Fall back to a 3x3 grid if the agent's start response omits the count. */
const DEFAULT_TARGET_COUNT = 9;

/** Read `ground_station.kiosk.target_url` out of the raw agent config blob,
 * degrading to "" for any missing / non-string node. */
function readKioskUrl(config: Record<string, unknown> | null): string {
  if (config === null) return "";
  const gs = config["ground_station"];
  if (gs === null || typeof gs !== "object") return "";
  const kiosk = (gs as Record<string, unknown>)["kiosk"];
  if (kiosk === null || typeof kiosk !== "object") return "";
  const url = (kiosk as Record<string, unknown>)["target_url"];
  return typeof url === "string" ? url : "";
}

export function HdmiKioskCard() {
  const displayType = useAgentCapabilitiesStore((s) => s.displayType);
  const display = useAgentCapabilitiesStore((s) => s.display);
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);
  const client = useAgentConnectionStore((s) => s.client);
  const t = useTranslations("hardware.hdmiKiosk");
  const { toast } = useToast();

  // Kiosk target URL editor state.
  const [urlValue, setUrlValue] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [urlLoaded, setUrlLoaded] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);

  // Touch-calibration flow state.
  const [calibStatus, setCalibStatus] = useState<TouchCalibrationStatus | null>(
    null,
  );
  const [calibrating, setCalibrating] = useState(false);
  const [calibTotal, setCalibTotal] = useState(DEFAULT_TARGET_COUNT);

  // Load the persisted kiosk URL once (config changes are infrequent and we
  // re-read after a save to reflect the reconciled value).
  const refreshUrl = useCallback(async () => {
    if (!client) return;
    try {
      const config = await client.getConfig();
      const url = readKioskUrl(config);
      setSavedUrl(url);
      setUrlValue(url);
    } catch {
      // A read failure leaves the field blank; the operator can still write.
    } finally {
      setUrlLoaded(true);
    }
  }, [client]);

  useEffect(() => {
    void refreshUrl();
  }, [refreshUrl]);

  // Seed the calibration pill with the on-disk state so it reads accurately
  // before the operator ever runs the wizard.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .getTouchCalibrationStatus()
      .then((s) => {
        if (!cancelled) setCalibStatus(s);
      })
      .catch(() => {
        /* leave the pill on its heartbeat fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // While a calibration is in flight, poll the live status so the step counter
  // advances as the operator taps each crosshair on the panel. The wizard is
  // terminal once `in_progress` drops back to false after having been true.
  const sawInProgressRef = useRef(false);
  useEffect(() => {
    if (!calibrating || !client) return;
    let cancelled = false;
    const startedAt = Date.now();
    let failures = 0;

    const tick = async () => {
      if (cancelled) return;
      try {
        const status = await client.getTouchCalibrationStatus();
        if (cancelled) return;
        failures = 0;
        setCalibStatus(status);
        if (status.in_progress) {
          sawInProgressRef.current = true;
        } else if (sawInProgressRef.current) {
          // Terminal: the on-panel wizard finished (or the fit was rejected).
          setCalibrating(false);
          if (status.calibrated) {
            const rms = status.rms_residual_px;
            toast(
              rms != null
                ? t("calibrateCompleteResidual", { residual: rms.toFixed(1) })
                : t("calibrateComplete"),
              "success",
            );
          } else {
            toast(t("calibrateRejected"), "warning");
          }
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= 3) {
          setCalibrating(false);
          toast(t("calibrateLostContact"), "error");
        }
      }
      if (!cancelled && Date.now() - startedAt > CALIBRATE_DEADLINE_MS) {
        setCalibrating(false);
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), CALIBRATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [calibrating, client, t, toast]);

  if (!loaded) return null;

  const dirty = urlLoaded && urlValue !== savedUrl;

  const onSaveUrl = async () => {
    if (!client || savingUrl) return;
    const next = urlValue.trim();
    setSavingUrl(true);
    try {
      const res = await client.setConfigValue(KIOSK_URL_CONFIG_KEY, next);
      if (res && typeof res.error === "string") {
        throw new Error(res.error);
      }
      toast(t("urlSaved"), "success");
      // Re-read so the field reflects the reconciled value the agent stored.
      await refreshUrl();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("urlError");
      toast(msg, "error");
    } finally {
      setSavingUrl(false);
    }
  };

  const onStartCalibrate = async () => {
    if (!client || calibrating) return;
    sawInProgressRef.current = false;
    setCalibrating(true);
    try {
      const started = await client.startTouchCalibration();
      setCalibTotal(
        typeof started.target_count === "number" && started.target_count > 0
          ? started.target_count
          : DEFAULT_TARGET_COUNT,
      );
      toast(t("calibrateStarted"), "info");
    } catch (err) {
      setCalibrating(false);
      const msg = err instanceof Error ? err.message : t("calibrateError");
      toast(msg, "error");
    }
  };

  // Resolved local-display path pill.
  const pathLabel = (() => {
    switch (displayType) {
      case "hdmi":
        return t("pathHdmi");
      case "lcd":
        return t("pathLcd");
      case "none":
        return t("pathNone");
      case "auto":
        return t("pathAuto");
      default:
        return t("pathUnknown");
    }
  })();
  const pathIsHdmi = displayType === "hdmi";

  // Touch-panel presence, sourced from the enumerated display peripheral.
  const touchLabel =
    display?.hasTouch === true
      ? t("touchDetected")
      : display?.hasTouch === false
        ? t("touchNotDetected")
        : t("touchUnknown");

  // Calibration state: prefer the live status, fall back to the heartbeat flag.
  const isCalibrated =
    calibStatus?.calibrated ?? display?.touchCalibrated ?? undefined;
  const calibLabel = calibrating
    ? t("calibrating")
    : isCalibrated === true
      ? t("calibrated")
      : isCalibrated === false
        ? t("notCalibrated")
        : t("calibrationUnknown");

  const currentStep = calibStatus?.current_step ?? 0;

  return (
    <section className="mb-4 rounded border border-border-default bg-bg-secondary">
      <header className="flex items-center justify-between gap-2 border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <MonitorPlay size={16} className="text-accent-primary" />
          <h2 className="text-sm font-display font-semibold text-text-primary">
            {t("title")}
          </h2>
        </div>
        <span
          className={
            pathIsHdmi
              ? "rounded bg-status-success/15 px-2 py-0.5 text-[11px] font-medium text-status-success"
              : "rounded bg-bg-tertiary px-2 py-0.5 text-[11px] font-medium text-text-secondary"
          }
        >
          {pathLabel}
        </span>
      </header>

      <p className="px-4 pt-3 text-[11px] text-text-tertiary">
        {t("description")}
      </p>

      {/* Reconciled kiosk target URL. */}
      <div className="border-b border-border-default px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label={t("urlLabel")}
              value={urlValue}
              placeholder={t("urlPlaceholder")}
              disabled={!client || !urlLoaded || savingUrl}
              onChange={(e) => setUrlValue(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onSaveUrl()}
            disabled={!client || !dirty || savingUrl}
            loading={savingUrl}
          >
            {t("urlSave")}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-text-tertiary">{t("urlNote")}</p>
      </div>

      {/* HDMI + touch status. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-xs text-text-secondary sm:grid-cols-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
            {t("displayPath")}
          </dt>
          <dd className="mt-0.5 text-text-primary">{pathLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
            {t("touchPanel")}
          </dt>
          <dd className="mt-0.5 text-text-primary">{touchLabel}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">
            {t("calibration")}
          </dt>
          <dd className="mt-0.5 text-text-primary">{calibLabel}</dd>
        </div>
      </dl>

      <footer className="flex flex-col gap-2 border-t border-border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[11px] text-text-tertiary">
          {calibrating
            ? t("calibrateProgress", { current: currentStep, total: calibTotal })
            : t("calibrateHint")}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void onStartCalibrate()}
          disabled={!client || calibrating}
          loading={calibrating}
        >
          {t("calibrateButton")}
        </Button>
      </footer>
    </section>
  );
}
