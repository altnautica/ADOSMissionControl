"use client";

/**
 * @module WifiSection
 * @description Two cards on the network page: the access-point editor
 * (SSID, passphrase, channel, enabled toggle) and the WiFi client status
 * card (scan, leave, signal/IP/gateway readout).
 * @license GPL-3.0-only
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type { ApStatus, WifiClientStatus } from "@/lib/api/ground-station/types";
import { StatRow } from "./StatRow";

const EMPTY = "…";
const CHANNEL_OPTIONS: number[] = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161];

interface ApFormState {
  ssid: string;
  passphrase: string;
  channel: number;
  enabled: boolean;
  revealPass: boolean;
  saving: boolean;
  dirty: boolean;
}

interface Props {
  ap: ApStatus | null;
  wifiClient: WifiClientStatus | undefined;
  clients: number | null;
  lastError: string | null;
  form: ApFormState;
  setSsid: (v: string) => void;
  setPassphrase: (v: string) => void;
  setChannel: (v: number) => void;
  setEnabled: (v: boolean) => void;
  setRevealPass: (fn: (prev: boolean) => boolean) => void;
  onSave: () => void;
  onScan: () => void;
  onLeave: () => void;
}

export function WifiSection({
  ap,
  wifiClient,
  clients,
  lastError,
  form,
  setSsid,
  setPassphrase,
  setChannel,
  setEnabled,
  setRevealPass,
  onSave,
  onScan,
  onLeave,
}: Props) {
  return (
    <>
      {/* AP card (live) */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
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
              value={form.ssid}
              onChange={(e) => setSsid(e.target.value)}
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
                  type={form.revealPass ? "text" : "password"}
                  value={form.passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
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
                  {form.revealPass ? "Hide" : "Show"}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Select
                label="Channel"
                value={String(form.channel)}
                onChange={(v) => setChannel(Number(v))}
                options={CHANNEL_OPTIONS.map((ch) => ({
                  value: String(ch),
                  label: `CH ${ch}`,
                }))}
              />
            </div>

            <Toggle
              label="Enabled"
              checked={form.enabled}
              onChange={setEnabled}
            />

            {lastError ? (
              <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                {lastError}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button variant="primary" onClick={onSave} disabled={!form.dirty} loading={form.saving}>
                Save
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* WiFi Client card (live) */}
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium text-text-primary">WiFi Client</h2>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onScan}>
              Scan networks
            </Button>
            {wifiClient?.connected ? (
              <Button variant="ghost" size="sm" onClick={onLeave}>
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
    </>
  );
}
