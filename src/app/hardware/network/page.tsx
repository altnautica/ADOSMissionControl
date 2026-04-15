"use client";

/**
 * @module HardwareNetworkPage
 * @description Phase 1 Network sub-view. AP live card, WiFi Client placeholder,
 * 4G Modem placeholder, and a pair CTA.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { PairModal } from "@/components/hardware/PairModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

const POLL_INTERVAL_MS = 500; // 2 Hz for connected clients count
const CHANNEL_OPTIONS: number[] = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161];
const EMPTY = "…";

export default function HardwareNetworkPage() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const ap = useGroundStationStore((s) => s.ap);
  const network = useGroundStationStore((s) => s.network);
  const lastError = useGroundStationStore((s) => s.lastError);
  const loadNetwork = useGroundStationStore((s) => s.loadNetwork);
  const applyAp = useGroundStationStore((s) => s.applyAp);

  const [ssid, setSsid] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [channel, setChannel] = useState<number>(6);
  const [enabled, setEnabled] = useState<boolean>(true);
  const [revealPass, setRevealPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  // Initial load + 2 Hz refresh for connected clients count.
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

  // Sync local form state from store on first load, but don't clobber user edits.
  useEffect(() => {
    if (!ap || dirty) return;
    setSsid(ap.ssid);
    setPassphrase(ap.passphrase);
    setChannel(ap.channel);
    setEnabled(ap.enabled);
  }, [ap, dirty]);

  const handleSave = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client || !ap) return;
    setSaving(true);
    const update: {
      enabled?: boolean;
      ssid?: string;
      passphrase?: string;
      channel?: number;
    } = {};
    if (enabled !== ap.enabled) update.enabled = enabled;
    if (ssid !== ap.ssid) update.ssid = ssid;
    if (passphrase !== ap.passphrase) update.passphrase = passphrase;
    if (channel !== ap.channel) update.channel = channel;
    await applyAp(client, update);
    setSaving(false);
    setDirty(false);
  };

  const hasAgent = Boolean(agentUrl);
  const clients = network?.ap.connected_clients ?? null;

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
            {/* AP card */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-medium text-text-primary">Access Point</h2>
                <span className="text-xs text-text-secondary">
                  Clients: {clients == null ? EMPTY : String(clients)}
                </span>
              </div>

              {!ap ? (
                <div className="py-4 text-sm text-text-secondary">Loading access point state{EMPTY}</div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Input
                    label="SSID"
                    value={ssid}
                    onChange={(e) => { setSsid(e.target.value); setDirty(true); }}
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
                        onChange={(e) => { setPassphrase(e.target.value); setDirty(true); }}
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
                      onChange={(e) => { setChannel(Number(e.target.value)); setDirty(true); }}
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
                    onChange={(v) => { setEnabled(v); setDirty(true); }}
                  />

                  {lastError ? (
                    <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                      {lastError}
                    </div>
                  ) : null}

                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      onClick={handleSave}
                      disabled={!dirty}
                      loading={saving}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* WiFi Client placeholder */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <h2 className="mb-2 text-lg font-medium text-text-primary">WiFi Client</h2>
              <p className="text-sm text-text-secondary">Not available yet.</p>
            </section>

            {/* 4G Modem placeholder */}
            <section className="rounded-lg border border-border-primary bg-surface-secondary p-5">
              <h2 className="mb-2 text-lg font-medium text-text-primary">4G Modem</h2>
              <p className="text-sm text-text-secondary">Not available yet.</p>
            </section>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPairOpen(true)}>
                Pair with drone
              </Button>
            </div>
          </div>
        ) : null}

        <PairModal open={pairOpen} onClose={() => setPairOpen(false)} />
      </div>
    </div>
  );
}
