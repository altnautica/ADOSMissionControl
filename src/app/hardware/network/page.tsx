"use client";

/**
 * @module HardwareNetworkPage
 * @description Phase 3 Network sub-view. Live cards for AP, WiFi Client,
 * Ethernet, and 4G Modem, plus an uplink priority reorder list, recent
 * failover timeline, and share-uplink toggle. Polls /network at 2 Hz. The
 * Overview page owns the uplink WS subscription.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { PairModal } from "@/components/hardware/PairModal";
import { WifiScanModal } from "@/components/hardware/WifiScanModal";
import { EthernetConfigModal } from "@/components/hardware/EthernetConfigModal";
import { UplinkPriorityList } from "@/components/hardware/UplinkPriorityList";
import { DataUsageBar } from "@/components/hardware/DataUsageBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

const POLL_INTERVAL_MS = 500;
const CHANNEL_OPTIONS: number[] = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161];
const EMPTY = "…";

function formatRelative(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return secs + "s ago";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

function ifaceLabel(iface: string | null): string {
  if (!iface) return "None";
  switch (iface) {
    case "ethernet":
      return "Ethernet";
    case "wifi_client":
      return "WiFi Client";
    case "modem_4g":
      return "4G Modem";
    case "ap":
      return "Access Point";
    default:
      return iface;
  }
}

export default function HardwareNetworkPage() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const ap = useGroundStationStore((s) => s.ap);
  const network = useGroundStationStore((s) => s.network);
  const modem = useGroundStationStore((s) => s.modem);
  const uplink = useGroundStationStore((s) => s.uplink);
  const ethernetConfig = useGroundStationStore((s) => s.ethernetConfig);
  const loadEthernetConfig = useGroundStationStore((s) => s.loadEthernetConfig);
  const lastError = useGroundStationStore((s) => s.lastError);
  const loadNetwork = useGroundStationStore((s) => s.loadNetwork);
  const applyAp = useGroundStationStore((s) => s.applyAp);
  const leaveWifi = useGroundStationStore((s) => s.leaveWifi);
  const loadModem = useGroundStationStore((s) => s.loadModem);
  const applyModem = useGroundStationStore((s) => s.applyModem);
  const loadPriority = useGroundStationStore((s) => s.loadPriority);
  const applyPriority = useGroundStationStore((s) => s.applyPriority);
  const toggleShareUplink = useGroundStationStore((s) => s.toggleShareUplink);

  const { toast } = useToast();

  // AP form state
  const [ssid, setSsid] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [channel, setChannel] = useState<number>(6);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [revealPass, setRevealPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Modals / dialogs
  const [pairOpen, setPairOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [modemOpen, setModemOpen] = useState(false);
  const [ethernetOpen, setEthernetOpen] = useState(false);

  // Modem form state
  const [apnDraft, setApnDraft] = useState("");
  const [capGbDraft, setCapGbDraft] = useState(5);
  const [modemEnabledDraft, setModemEnabledDraft] = useState(true);
  const [savingModem, setSavingModem] = useState(false);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  // Poll /network at 2 Hz for connected clients and live stats.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const client = groundStationApiFromAgent(agentUrlRef.current, apiKeyRef.current);
      if (!client) return;
      if (cancelled) return;
      await loadNetwork(client);
    };

    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [loadNetwork]);

  // Load modem and priority once on mount (they change infrequently).
  useEffect(() => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    void loadModem(client);
    void loadPriority(client);
    // Wave 2: best-effort fetch of ethernet config. Returns null when
    // the Wave 3 backend is not yet shipped (404 swallowed by the store).
    void loadEthernetConfig(client);
  }, [agentUrl, apiKey, loadModem, loadPriority, loadEthernetConfig]);

  // Sync AP form from store on first load.
  useEffect(() => {
    if (!ap || dirty) return;
    setSsid(ap.ssid);
    setPassphrase(ap.passphrase);
    setChannel(ap.channel);
    setEnabled(ap.enabled);
  }, [ap, dirty]);

  // Sync modem modal defaults when opened.
  useEffect(() => {
    if (!modemOpen || !modem) return;
    setApnDraft(modem.apn ?? "");
    const capMb = modem.data_cap?.cap_mb ?? 0;
    setCapGbDraft(capMb > 0 ? Math.max(1, Math.round(capMb / 1024)) : 5);
    setModemEnabledDraft(modem.enabled ?? true);
  }, [modemOpen, modem]);

  const handleSave = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client || !ap) return;
    setSaving(true);
    const update: { enabled?: boolean; ssid?: string; passphrase?: string; channel?: number } = {};
    if (enabled !== ap.enabled) update.enabled = enabled;
    if (ssid !== ap.ssid) update.ssid = ssid;
    if (passphrase !== ap.passphrase) update.passphrase = passphrase;
    if (channel !== ap.channel) update.channel = channel;
    await applyAp(client, update);
    setSaving(false);
    setDirty(false);
  };

  const handleLeaveWifi = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const ok = await leaveWifi(client);
    if (ok) toast("Disconnected from WiFi network.", "info");
  };

  const handleApplyModem = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    setSavingModem(true);
    const res = await applyModem(client, {
      apn: apnDraft.trim() || undefined,
      cap_gb: capGbDraft,
      enabled: modemEnabledDraft,
    });
    setSavingModem(false);
    if (res) {
      toast("Modem configuration saved.", "success");
      setModemOpen(false);
    } else {
      toast("Failed to save modem configuration.", "error");
    }
  };

  const handlePriorityChange = async (next: string[]) => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const res = await applyPriority(client, next);
    if (res == null) {
      toast("Failed to update uplink priority.", "error");
    }
  };

  const handleShareToggle = async (next: boolean) => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const res = await toggleShareUplink(client, next);
    if (res == null) toast("Failed to update share setting.", "error");
  };

  const hasAgent = Boolean(agentUrl);
  const clients = network?.ap.connected_clients ?? null;
  const wifiClient = network?.wifi_client;
  const ethernet = network?.ethernet;
  const shareEnabled = Boolean(network?.share_uplink);

  const recentFailovers = uplink.failover_log.slice(0, 5);

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <Link href="/hardware" className="hover:text-text-primary transition-colors">
            Hardware
          </Link>
          <span>/</span>
          <span>Network</span>
        </div>
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">Network</h1>

        <HardwareTabs />

        {!hasAgent ? (
          <div className="rounded-lg border border-border-primary bg-surface-secondary p-8 text-center text-sm text-text-secondary">
            No ground station connected.
          </div>
        ) : null}

        {hasAgent ? (
          <div className="flex flex-col gap-5">
            {/* AP card (live) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">Access Point</h2>
                <span className="text-xs text-text-secondary">
                  Clients: {clients == null ? EMPTY : String(clients)}
                </span>
              </div>

              {!ap ? (
                <div className="py-4 text-sm text-text-secondary">
                  Loading access point state{EMPTY}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Input
                    label="SSID"
                    value={ssid}
                    onChange={(e) => {
                      setSsid(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="ADOS-GS"
                    spellCheck={false}
                    autoComplete="off"
                  />

                  <div className="flex flex-col gap-1">
                    <label htmlFor="ap-pass" className="text-xs text-text-secondary">
                      Passphrase
                    </label>
                    <div className="flex items-stretch gap-2">
                      <input
                        id="ap-pass"
                        type={revealPass ? "text" : "password"}
                        value={passphrase}
                        onChange={(e) => {
                          setPassphrase(e.target.value);
                          setDirty(true);
                        }}
                        placeholder="8+ characters"
                        spellCheck={false}
                        autoComplete="off"
                        className="flex-1 h-8 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
                      />
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => setRevealPass((v) => !v)}
                      >
                        {revealPass ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label htmlFor="ap-channel" className="text-xs text-text-secondary">
                      Channel
                    </label>
                    <select
                      id="ap-channel"
                      value={channel}
                      onChange={(e) => {
                        setChannel(Number(e.target.value));
                        setDirty(true);
                      }}
                      className="h-8 px-2 bg-bg-tertiary border border-border-default text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                    >
                      {CHANNEL_OPTIONS.map((ch) => (
                        <option key={ch} value={ch}>
                          CH {ch}
                        </option>
                      ))}
                    </select>
                  </div>

                  <Toggle
                    label="Enabled"
                    checked={enabled}
                    onChange={(v) => {
                      setEnabled(v);
                      setDirty(true);
                    }}
                  />

                  {lastError ? (
                    <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                      {lastError}
                    </div>
                  ) : null}

                  <div className="flex justify-end">
                    <Button variant="primary" onClick={handleSave} disabled={!dirty} loading={saving}>
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* WiFi Client card (live) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">WiFi Client</h2>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setScanOpen(true)}>
                    Scan networks
                  </Button>
                  {wifiClient?.connected ? (
                    <Button variant="ghost" size="sm" onClick={handleLeaveWifi}>
                      Leave
                    </Button>
                  ) : null}
                </div>
              </div>

              {!wifiClient?.available ? (
                <div className="text-sm text-text-secondary">WiFi client not available on this hardware.</div>
              ) : wifiClient?.connected ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <StatRow label="SSID" value={wifiClient.ssid ?? EMPTY} />
                  <StatRow
                    label="Signal"
                    value={
                      wifiClient.signal != null
                        ? wifiClient.signal + " dBm"
                        : wifiClient.rssi_dbm != null
                          ? wifiClient.rssi_dbm + " dBm"
                          : EMPTY
                    }
                  />
                  <StatRow label="IP" value={wifiClient.ip ?? EMPTY} />
                  <StatRow label="Gateway" value={wifiClient.gateway ?? EMPTY} />
                </dl>
              ) : (
                <div className="text-sm text-text-secondary">Not connected to any network.</div>
              )}
            </section>

            {/* Ethernet card (live) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">Ethernet</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEthernetOpen(true)}
                  disabled={!ethernet?.available}
                >
                  Configure
                </Button>
              </div>
              {!ethernet?.available ? (
                <div className="text-sm text-text-secondary">Ethernet not available on this hardware.</div>
              ) : (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <StatRow
                    label="Link"
                    value={ethernet.link ? "Up" : "Down"}
                    valueClass={ethernet.link ? "text-status-success" : "text-text-tertiary"}
                  />
                  <StatRow
                    label="Speed"
                    value={ethernet.speed_mbps != null ? ethernet.speed_mbps + " Mbps" : EMPTY}
                  />
                  <StatRow label="IP" value={ethernet.ip ?? EMPTY} />
                  <StatRow label="Gateway" value={ethernet.gateway ?? EMPTY} />
                  <StatRow label="Mode" value={ethernetConfig?.mode ?? EMPTY} />
                </dl>
              )}
            </section>

            {/* 4G Modem card (live) */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">4G Modem</h2>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setModemOpen(true)}
                  disabled={!modem?.available}
                >
                  Configure
                </Button>
              </div>

              {!modem?.available ? (
                <div className="text-sm text-text-secondary">No modem detected.</div>
              ) : (
                <div className="flex flex-col gap-3">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    <StatRow label="State" value={modem.state ?? EMPTY} />
                    <StatRow
                      label="Signal"
                      value={
                        modem.signal_bars != null
                          ? modem.signal_bars + " / 5"
                          : modem.signal_dbm != null
                            ? modem.signal_dbm + " dBm"
                            : EMPTY
                      }
                    />
                    <StatRow label="Operator" value={modem.operator ?? modem.carrier ?? EMPTY} />
                    <StatRow label="APN" value={modem.apn ?? EMPTY} />
                    <StatRow label="Interface" value={modem.iface ?? EMPTY} />
                    <StatRow label="IP" value={modem.ip ?? EMPTY} />
                  </dl>

                  {modem.data_cap && modem.data_cap.cap_mb > 0 ? (
                    <div className="mt-1">
                      <div className="mb-1 text-xs uppercase tracking-wide text-text-secondary">
                        Data usage
                      </div>
                      <DataUsageBar
                        usedMb={modem.data_cap.used_mb}
                        capMb={modem.data_cap.cap_mb}
                        state={modem.data_cap.state}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {/* Uplink priority */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">Uplink priority</h2>
                <span className="text-xs text-text-secondary">
                  Active: {ifaceLabel(uplink.active)}
                </span>
              </div>
              <p className="mb-3 text-[11px] text-text-tertiary">
                Drag to reorder. The first healthy uplink takes traffic.
              </p>
              <UplinkPriorityList
                priority={uplink.priority}
                active={uplink.active}
                onChange={handlePriorityChange}
              />

              <div className="mt-4">
                <div className="mb-2 text-xs uppercase tracking-wide text-text-secondary">
                  Last 5 failovers
                </div>
                {recentFailovers.length === 0 ? (
                  <div className="text-xs text-text-tertiary">No failovers recorded this session.</div>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {recentFailovers.map((entry, idx) => (
                      <li
                        key={entry.timestamp + "-" + idx}
                        className="flex items-center justify-between rounded border border-border-primary/30 px-2 py-1.5 text-xs"
                      >
                        <span className="text-text-primary">
                          {ifaceLabel(entry.from)} to {ifaceLabel(entry.to)}
                        </span>
                        <span className="text-text-tertiary">
                          {entry.reason} ({formatRelative(entry.timestamp)})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Share uplink advanced toggle */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-medium text-text-primary">Share uplink with AP clients</h2>
                  <p className="mt-1 text-xs text-text-secondary">
                    Routes active uplink traffic out the ground station Access Point. Advanced option.
                  </p>
                </div>
                <Toggle
                  label={shareEnabled ? "Enabled" : "Disabled"}
                  checked={shareEnabled}
                  onChange={(v) => void handleShareToggle(v)}
                />
              </div>
            </section>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPairOpen(true)}>
                Pair with drone
              </Button>
            </div>
          </div>
        ) : null}

        <PairModal open={pairOpen} onClose={() => setPairOpen(false)} />
        <WifiScanModal open={scanOpen} onClose={() => setScanOpen(false)} />
        <EthernetConfigModal
          open={ethernetOpen}
          onClose={() => setEthernetOpen(false)}
          initial={ethernetConfig}
        />

        <Modal
          open={modemOpen}
          onClose={() => setModemOpen(false)}
          title="Configure 4G Modem"
          className="max-w-md"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModemOpen(false)} disabled={savingModem}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleApplyModem} loading={savingModem}>
                Save
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Input
              label="APN"
              value={apnDraft}
              onChange={(e) => setApnDraft(e.target.value)}
              placeholder="internet"
              spellCheck={false}
              autoComplete="off"
            />

            <div className="flex flex-col gap-1">
              <label htmlFor="modem-cap" className="text-xs text-text-secondary">
                Monthly data cap: {capGbDraft} GB
              </label>
              <input
                id="modem-cap"
                type="range"
                min={1}
                max={20}
                step={1}
                value={capGbDraft}
                onChange={(e) => setCapGbDraft(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-text-tertiary">
                <span>1 GB</span>
                <span>20 GB</span>
              </div>
            </div>

            <Toggle
              label="Modem enabled"
              checked={modemEnabledDraft}
              onChange={setModemEnabledDraft}
            />
          </div>
        </Modal>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-primary/40 py-1.5">
      <dt className="text-xs uppercase tracking-wide text-text-secondary">{label}</dt>
      <dd className={"font-mono text-sm " + (valueClass ?? "text-text-primary")}>{value}</dd>
    </div>
  );
}
