"use client";

/**
 * @module NetworkTab
 * @description Command-tab home for the ground-station uplink
 * configuration. Composes per-uplink sections (WiFi AP + client,
 * Ethernet, 4G modem) and the uplink priority + share-uplink
 * panel. Polls /network at 2 Hz. The Overview tab owns the uplink
 * WS subscription. Renders the networking surface for a ground-station node.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { PageIntro } from "@/components/hardware/PageIntro";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useGroundStationPoll } from "./use-gs-poll";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { WifiSection } from "@/components/hardware/network/WifiSection";
import { EthernetSection } from "@/components/hardware/network/EthernetSection";
import { CellularSection } from "@/components/hardware/network/CellularSection";
import { UplinkPriorityPanel } from "@/components/hardware/network/UplinkPriorityPanel";
import { AdapterStabilityCard } from "@/components/hardware/network/AdapterStabilityCard";
import { WifiPowersaveCard } from "@/components/hardware/network/WifiPowersaveCard";
import { NetworkPageModals } from "@/components/hardware/network/NetworkPageModals";

const POLL_INTERVAL_MS = 500;

export function NetworkTab() {
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
  const [leaveWifiConfirmOpen, setLeaveWifiConfirmOpen] = useState(false);
  const [shareUplinkConfirmOpen, setShareUplinkConfirmOpen] = useState(false);

  // Modem form state
  const [apnDraft, setApnDraft] = useState("");
  const [capGbDraft, setCapGbDraft] = useState(5);
  const [modemEnabledDraft, setModemEnabledDraft] = useState(true);
  const [savingModem, setSavingModem] = useState(false);


  // One in-flight request at a time, backing off when the agent stops
  // answering. A fixed 500 ms interval queued overlapping requests onto an
  // already-slow agent, which is the load that made it slow, and hammered an
  // unreachable one at full cadence for as long as the tab was open.
  useGroundStationPoll(agentUrl, apiKey, POLL_INTERVAL_MS, loadNetwork);

  // Load modem and priority once on mount (they change infrequently).
  useEffect(() => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    void loadModem(client);
    void loadPriority(client);
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
    const capMb = modem.cap_mb ?? 0;
    setCapGbDraft(capMb > 0 ? Math.max(1, Math.round(capMb / 1024)) : 5);
    setModemEnabledDraft(modem.enabled);
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

  const handleConfirmLeaveWifi = async () => {
    setLeaveWifiConfirmOpen(false);
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

  const applyShareUplink = async (next: boolean) => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    const res = await toggleShareUplink(client, next);
    if (res == null) toast("Failed to update share setting.", "error");
  };

  const handleShareToggle = (next: boolean) => {
    if (next) {
      setShareUplinkConfirmOpen(true);
      return;
    }
    void applyShareUplink(false);
  };

  const handleConfirmShareUplink = () => {
    setShareUplinkConfirmOpen(false);
    void applyShareUplink(true);
  };

  const hasAgent = Boolean(agentUrl);
  const clients = network?.ap.connected_clients ?? null;
  const wifiClient = network?.wifi_client;
  const ethernet = network?.ethernet;
  const shareEnabled = Boolean(network?.share_uplink);

  if (!hasAgent) {
    return (
      <div className="flex flex-col">
        <PageIntro
          title="Network"
          description="Manage every uplink path: WiFi access point, WiFi client, Ethernet, and 4G modem. The active uplink decides which network the agent uses for cloud relay."
        />
        <CloudModeLimitedNotice feature="network" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageIntro
        title="Network"
        description="Manage every uplink path: WiFi access point, WiFi client, Ethernet, and 4G modem. The active uplink decides which network the agent uses for cloud relay."
      />
      <div className="flex flex-col gap-4">
        <WifiSection
          ap={ap}
          wifiClient={wifiClient}
          clients={clients}
          lastError={lastError}
          form={{ ssid, passphrase, channel, enabled, revealPass, saving, dirty }}
          setSsid={(v) => { setSsid(v); setDirty(true); }}
          setPassphrase={(v) => { setPassphrase(v); setDirty(true); }}
          setChannel={(v) => { setChannel(v); setDirty(true); }}
          setEnabled={(v) => { setEnabled(v); setDirty(true); }}
          setRevealPass={setRevealPass}
          onSave={handleSave}
          onScan={() => setScanOpen(true)}
          onLeave={() => setLeaveWifiConfirmOpen(true)}
        />

        <EthernetSection
          ethernet={ethernet}
          ethernetConfig={ethernetConfig}
          onConfigure={() => setEthernetOpen(true)}
        />

        <CellularSection
          modem={modem}
          onConfigure={() => setModemOpen(true)}
        />

        <UplinkPriorityPanel
          uplink={uplink}
          shareEnabled={shareEnabled}
          onPriorityChange={handlePriorityChange}
          onShareToggle={handleShareToggle}
        />

        <AdapterStabilityCard />

        <WifiPowersaveCard />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setPairOpen(true)}>
            Pair with drone
          </Button>
        </div>

        <NetworkPageModals
          pairOpen={pairOpen}
          setPairOpen={setPairOpen}
          scanOpen={scanOpen}
          setScanOpen={setScanOpen}
          ethernetOpen={ethernetOpen}
          setEthernetOpen={setEthernetOpen}
          ethernetConfig={ethernetConfig}
          leaveWifiConfirmOpen={leaveWifiConfirmOpen}
          setLeaveWifiConfirmOpen={setLeaveWifiConfirmOpen}
          onConfirmLeaveWifi={handleConfirmLeaveWifi}
          shareUplinkConfirmOpen={shareUplinkConfirmOpen}
          setShareUplinkConfirmOpen={setShareUplinkConfirmOpen}
          onConfirmShareUplink={handleConfirmShareUplink}
          modemOpen={modemOpen}
          setModemOpen={setModemOpen}
          apnDraft={apnDraft}
          capGbDraft={capGbDraft}
          modemEnabledDraft={modemEnabledDraft}
          savingModem={savingModem}
          setApnDraft={setApnDraft}
          setCapGbDraft={setCapGbDraft}
          setModemEnabledDraft={setModemEnabledDraft}
          onApplyModem={handleApplyModem}
        />
      </div>
    </div>
  );
}
