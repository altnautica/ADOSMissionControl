"use client";

/**
 * @module command/settings/HotspotApFields
 * @description The ground station's access-point name, channel and passphrase.
 *
 * These are applied through the ground station's live AP route
 * (`PUT /api/v1/ground-station/network/ap`), which reconfigures the running
 * hostapd and answers with the AP's own view. Writing the same keys into the
 * config document does not reach the running AP (the network daemon keeps its
 * stored passphrase and its own channel), so the page never offers that path.
 * The SSID and channel shown after a write are the AP's read-back, not the
 * values typed. The passphrase is write-only and cleared once the AP has it.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { GroundStationApi } from "@/lib/api/ground-station-api";
import type { ApUpdate } from "@/lib/api/ground-station/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** WPA2-PSK passphrase rule: 8 to 63 printable ASCII characters. Returns
 * null when valid, else the reason key under `nodeSettings.network`. */
export function wpaPassphraseProblem(passphrase: string): string | null {
  if (passphrase.length < 8 || passphrase.length > 63) {
    return "hotspotPasswordLength";
  }
  if (!/^[\x20-\x7e]+$/.test(passphrase)) return "hotspotPasswordCharset";
  return null;
}

interface ApReadBack {
  ssid: string | null;
  channel: number | null;
}

export function HotspotApFields({
  api,
  liveSsid,
  readOnly,
}: {
  /** The ground-station client for THIS node, or null without a direct
   * connection to it. */
  api: GroundStationApi | null;
  /** The SSID the running AP reports in the live network view. */
  liveSsid: string | null;
  readOnly: boolean;
}) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const [ssid, setSsid] = useState("");
  const [channel, setChannel] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [readBack, setReadBack] = useState<ApReadBack | null>(null);

  if (!api) {
    return (
      <p className="text-[11px] text-text-tertiary">
        {t("network.hotspotApRequiresLan")}
      </p>
    );
  }

  const channelNum = channel.trim() === "" ? null : Number(channel.trim());
  const channelBad =
    channelNum !== null &&
    (!Number.isInteger(channelNum) || channelNum < 1 || channelNum > 13);
  const passProblem =
    passphrase.length > 0 ? wpaPassphraseProblem(passphrase) : null;
  const update: ApUpdate = {
    ...(ssid.trim() ? { ssid: ssid.trim() } : {}),
    ...(channelNum !== null && !channelBad ? { channel: channelNum } : {}),
    ...(passphrase.length > 0 && !passProblem ? { passphrase } : {}),
  };
  const canApply =
    !readOnly &&
    !saving &&
    !channelBad &&
    !passProblem &&
    Object.keys(update).length > 0;

  const onApply = async () => {
    if (!canApply) return;
    setSaving(true);
    try {
      const view = (await api.setAp(update)) as unknown as Record<
        string,
        unknown
      >;
      setPassphrase("");
      setSsid("");
      setChannel("");
      setReadBack({
        ssid: typeof view.ssid === "string" ? view.ssid : null,
        channel: typeof view.channel === "number" ? view.channel : null,
      });
      toast(
        view.persisted === false
          ? t("network.hotspotApAppliedNotPersisted")
          : t("applied"),
        view.persisted === false ? "warning" : "success",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : t("applyFailed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const shownSsid = readBack?.ssid ?? liveSsid;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-tertiary">
        {t("network.hotspotApCurrent", {
          ssid: shownSsid ?? t("network.stateNotReported"),
          channel:
            readBack?.channel != null
              ? String(readBack.channel)
              : t("network.stateNotReported"),
        })}
      </p>
      <Input
        id="hotspot-ap-ssid"
        label={t("network.hotspotSsidLabel")}
        value={ssid}
        onChange={(e) => setSsid(e.target.value)}
        placeholder={shownSsid ?? "ADOS-{device_id}"}
        disabled={readOnly || saving}
      />
      <Input
        id="hotspot-ap-channel"
        label={t("network.hotspotChannelLabel")}
        value={channel}
        inputMode="numeric"
        onChange={(e) => setChannel(e.target.value)}
        error={channelBad ? t("network.hotspotChannelRange") : undefined}
        disabled={readOnly || saving}
      />
      <Input
        id="hotspot-ap-passphrase"
        type="password"
        autoComplete="new-password"
        label={t("network.hotspotPasswordLabel")}
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        error={passProblem ? t(`network.${passProblem}`) : undefined}
        disabled={readOnly || saving}
      />
      <p className="text-[11px] text-text-tertiary">
        {t("network.hotspotApHint")}
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void onApply()}
        disabled={!canApply}
      >
        {saving ? t("saving") : t("apply")}
      </Button>
    </div>
  );
}
