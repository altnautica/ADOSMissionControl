"use client";

/**
 * @module EthernetConfigModal
 * @description Phase 4 Wave 2 form for Ethernet static-IP configuration.
 * Posts to the not-yet-shipped agent endpoint; a 404 surfaces as a clear
 * "backend pending" message instead of a generic error toast.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { EthernetConfig } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

interface EthernetConfigModalProps {
  open: boolean;
  onClose: () => void;
  initial?: EthernetConfig | null;
}

// IPv4 dotted-quad. Each octet 0-255. No leading zeros enforced for simplicity.
const IPV4_REGEX = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function isValidIp(value: string): boolean {
  return IPV4_REGEX.test(value.trim());
}

function isValidCidr(value: string): boolean {
  const trimmed = value.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2) return false;
  if (!isValidIp(parts[0])) return false;
  const prefix = Number(parts[1]);
  if (!Number.isInteger(prefix)) return false;
  return prefix >= 0 && prefix <= 32;
}

export function EthernetConfigModal({ open, onClose, initial }: EthernetConfigModalProps) {
  const t = useTranslations("hardware.ethernet");
  const { toast } = useToast();
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const applyEthernetConfig = useGroundStationStore((s) => s.applyEthernetConfig);

  const [mode, setMode] = useState<"dhcp" | "static">("dhcp");
  const [ipCidr, setIpCidr] = useState("");
  const [gateway, setGateway] = useState("");
  const [dns1, setDns1] = useState("");
  const [dns2, setDns2] = useState("");
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Seed defaults whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setMode(initial?.mode ?? "dhcp");
    setIpCidr(initial?.ip ?? "");
    setGateway(initial?.gateway ?? "");
    const dns = initial?.dns ?? [];
    setDns1(dns[0] ?? "");
    setDns2(dns[1] ?? "");
    setInlineError(null);
  }, [open, initial]);

  const ipError =
    mode === "static" && ipCidr.trim().length > 0 && !isValidCidr(ipCidr)
      ? t("invalidCidr")
      : null;
  const gatewayError =
    mode === "static" && gateway.trim().length > 0 && !isValidIp(gateway)
      ? t("invalidIp")
      : null;
  const dns1Error =
    mode === "static" && dns1.trim().length > 0 && !isValidIp(dns1)
      ? t("invalidIp")
      : null;
  const dns2Error =
    mode === "static" && dns2.trim().length > 0 && !isValidIp(dns2)
      ? t("invalidIp")
      : null;

  const staticIncomplete =
    mode === "static" &&
    (ipCidr.trim().length === 0 || gateway.trim().length === 0);

  const hasFieldErrors =
    Boolean(ipError) || Boolean(gatewayError) || Boolean(dns1Error) || Boolean(dns2Error);

  const canSave = !saving && !hasFieldErrors && !staticIncomplete;

  const handleSave = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;

    setInlineError(null);
    setSaving(true);

    let update: { mode: "dhcp" | "static"; ip?: string; gateway?: string; dns?: string[] };
    if (mode === "dhcp") {
      update = { mode: "dhcp" };
    } else {
      const dnsList = [dns1.trim(), dns2.trim()].filter((s) => s.length > 0);
      update = {
        mode: "static",
        ip: ipCidr.trim(),
        gateway: gateway.trim(),
        dns: dnsList,
      };
    }

    const res = await applyEthernetConfig(client, update);
    setSaving(false);

    if (res.config) {
      toast(t("savedToast"), "success");
      onClose();
      return;
    }

    if (res.backendPending) {
      setInlineError(t("backendPending"));
      return;
    }

    setInlineError(res.error ?? t("genericError"));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modalTitle")}
      className="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!canSave}>
            {t("save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs uppercase tracking-wide text-text-secondary">
            {t("mode")}
          </legend>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="ethernet-mode"
                value="dhcp"
                checked={mode === "dhcp"}
                onChange={() => setMode("dhcp")}
                disabled={saving}
              />
              {t("dhcp")}
            </label>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="radio"
                name="ethernet-mode"
                value="static"
                checked={mode === "static"}
                onChange={() => setMode("static")}
                disabled={saving}
              />
              {t("static")}
            </label>
          </div>
        </fieldset>

        {mode === "static" ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Input
                label={t("ipAddress")}
                value={ipCidr}
                onChange={(e) => setIpCidr(e.target.value)}
                placeholder="192.168.1.42/24"
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
              />
              {ipError ? (
                <span className="text-xs text-status-error">{ipError}</span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <Input
                label={t("gateway")}
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                placeholder="192.168.1.1"
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
              />
              {gatewayError ? (
                <span className="text-xs text-status-error">{gatewayError}</span>
              ) : null}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">{t("dns")}</span>
              <Input
                value={dns1}
                onChange={(e) => setDns1(e.target.value)}
                placeholder="8.8.8.8"
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
              />
              {dns1Error ? (
                <span className="text-xs text-status-error">{dns1Error}</span>
              ) : null}
              <Input
                value={dns2}
                onChange={(e) => setDns2(e.target.value)}
                placeholder="1.1.1.1"
                spellCheck={false}
                autoComplete="off"
                disabled={saving}
              />
              {dns2Error ? (
                <span className="text-xs text-status-error">{dns2Error}</span>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-xs text-text-tertiary">{t("dhcpHint")}</p>
        )}

        {inlineError ? (
          <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
            {inlineError}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
