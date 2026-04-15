"use client";

/**
 * @module WifiScanModal
 * @description Phase 3 WiFi client scan and join modal. Triggers a 10 second
 * scan via the agent, lists results sorted by signal, prompts for a passphrase
 * if required, and handles the 409 needs_force case with a confirm dialog.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { Wifi, Lock } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import type { WifiScanResult } from "@/lib/api/ground-station-api";

const SCAN_DURATION_S = 10;

interface WifiScanModalProps {
  open: boolean;
  onClose: () => void;
}

function isOpenNetwork(security: string): boolean {
  const s = security.toLowerCase();
  return s === "" || s === "none" || s === "open";
}

export function WifiScanModal({ open, onClose }: WifiScanModalProps) {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const wifiScan = useGroundStationStore((s) => s.wifiScan);
  const scanWifiNetworks = useGroundStationStore((s) => s.scanWifiNetworks);
  const joinWifi = useGroundStationStore((s) => s.joinWifi);

  const { toast } = useToast();
  const [selected, setSelected] = useState<WifiScanResult | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [joining, setJoining] = useState(false);
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      setProgress(0);
      setSelected(null);
      setPassphrase("");
      setJoining(false);
      setForceDialogOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!wifiScan.scanning) {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }
  }, [wifiScan.scanning]);

  const handleScan = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    setSelected(null);
    setProgress(0);
    const start = Date.now();
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / (SCAN_DURATION_S * 1000)) * 100);
      setProgress(pct);
      if (pct >= 100 && progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
    }, 100);
    await scanWifiNetworks(client, SCAN_DURATION_S);
  };

  const attemptJoin = async (force: boolean) => {
    if (!selected) return;
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    setJoining(true);
    const pass = isOpenNetwork(selected.security) ? undefined : passphrase;
    const res = await joinWifi(client, selected.ssid, pass, force);
    setJoining(false);
    if (res.joined) {
      toast("Joined " + selected.ssid, "success");
      onClose();
      return;
    }
    if (res.needsForce && !force) {
      setForceDialogOpen(true);
      return;
    }
    toast(res.error || "Failed to join " + selected.ssid, "error");
  };

  const handleJoinClick = () => {
    void attemptJoin(false);
  };

  const handleConfirmForce = () => {
    setForceDialogOpen(false);
    void attemptJoin(true);
  };

  const hasAgent = Boolean(agentUrl);
  const requiresPass = selected ? !isOpenNetwork(selected.security) : false;
  const canJoin =
    selected != null &&
    !joining &&
    !wifiScan.scanning &&
    (requiresPass ? passphrase.length > 0 : true);

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={joining}>
        Close
      </Button>
      <Button
        variant="ghost"
        onClick={handleScan}
        disabled={!hasAgent || wifiScan.scanning || joining}
        loading={wifiScan.scanning}
      >
        {wifiScan.scanning ? "Scanning..." : "Scan"}
      </Button>
      {selected ? (
        <Button
          variant="primary"
          onClick={handleJoinClick}
          disabled={!canJoin}
          loading={joining}
        >
          Join
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="WiFi networks"
        footer={footer}
        className="max-w-md"
      >
        {!hasAgent ? (
          <div className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
            No ground station connected.
          </div>
        ) : (
          <div className="space-y-3">
            {wifiScan.scanning ? (
              <div className="flex flex-col gap-1">
                <div className="text-xs text-text-secondary">Scanning for networks...</div>
                <div className="h-1.5 w-full overflow-hidden rounded bg-bg-tertiary">
                  <div
                    className="h-full bg-accent-primary transition-all"
                    style={{ width: progress + "%" }}
                  />
                </div>
              </div>
            ) : null}

            {!wifiScan.scanning && wifiScan.results.length === 0 ? (
              <div className="py-6 text-center text-xs text-text-secondary">
                Tap Scan to look for nearby networks.
              </div>
            ) : null}

            {wifiScan.results.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="text-xs uppercase tracking-wide text-text-secondary">
                  Networks
                </div>
                <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {wifiScan.results.map((net) => {
                    const isSelected = selected?.bssid === net.bssid;
                    const secured = !isOpenNetwork(net.security);
                    return (
                      <li key={net.bssid || net.ssid}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(net);
                            setPassphrase("");
                          }}
                          className={
                            "flex w-full items-center justify-between rounded border px-3 py-2 text-left transition-colors " +
                            (isSelected
                              ? "border-accent-primary bg-accent-primary/10"
                              : "border-border-primary/40 hover:border-border-primary")
                          }
                        >
                          <div className="flex items-center gap-2">
                            <Wifi size={14} className="text-text-secondary" />
                            <div className="flex flex-col">
                              <span className="text-sm text-text-primary">
                                {net.ssid || "(hidden)"}
                              </span>
                              <span className="font-mono text-[10px] text-text-tertiary">
                                {net.bssid}
                                {net.in_use ? " (in use)" : ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-text-secondary">
                            {secured ? <Lock size={12} /> : null}
                            <span className="font-mono">{net.signal} dBm</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {selected && requiresPass ? (
              <div className="flex flex-col gap-1">
                <Input
                  label={"Passphrase for " + selected.ssid}
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="WPA/WPA2 passphrase"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            ) : null}

            {selected && !requiresPass ? (
              <div className="rounded border border-border-primary/40 px-3 py-2 text-xs text-text-secondary">
                Selected: {selected.ssid} (open network)
              </div>
            ) : null}

            {wifiScan.error ? (
              <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                {wifiScan.error}
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={forceDialogOpen}
        title="Stop the Access Point?"
        message={
          "Joining " +
          (selected?.ssid ?? "this network") +
          " will stop the Access Point. Connected clients will lose the ground station WiFi. Continue?"
        }
        confirmLabel="Stop AP and join"
        variant="danger"
        onCancel={() => setForceDialogOpen(false)}
        onConfirm={handleConfirmForce}
      />
    </>
  );
}
