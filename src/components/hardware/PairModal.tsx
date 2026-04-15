"use client";

/**
 * @module PairModal
 * @description Phase 1 pair-with-drone modal. Collects a 32-char pair key and
 * an optional drone device id, calls the agent, handles 409/400 errors with
 * explicit retry or unpair actions.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";

interface PairModalProps {
  open: boolean;
  onClose: () => void;
}

export function PairModal({ open, onClose }: PairModalProps) {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const pair = useGroundStationStore((s) => s.pair);
  const startPair = useGroundStationStore((s) => s.startPair);
  const unpair = useGroundStationStore((s) => s.unpair);
  const clearPair = useGroundStationStore((s) => s.clearPair);

  const [pairKey, setPairKey] = useState("");
  const [droneId, setDroneId] = useState("");

  useEffect(() => {
    if (!open) {
      setPairKey("");
      setDroneId("");
    }
  }, [open]);

  const handleClose = () => {
    clearPair();
    onClose();
  };

  const handleSubmit = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    await startPair(client, pairKey.trim(), droneId.trim() || undefined);
  };

  const handleUnpairAndRetry = async () => {
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    await unpair(client);
    await startPair(client, pairKey.trim(), droneId.trim() || undefined);
  };

  const hasClient = Boolean(agentUrl);
  const isAlreadyPaired = pair.errorStatus === 409;
  const canSubmit = pairKey.trim().length > 0 && !pair.loading && hasClient;

  const footer = pair.result ? (
    <Button variant="primary" onClick={handleClose}>
      Done
    </Button>
  ) : (
    <>
      <Button variant="secondary" onClick={handleClose} disabled={pair.loading}>
        Cancel
      </Button>
      {isAlreadyPaired ? (
        <Button variant="primary" onClick={handleUnpairAndRetry} loading={pair.loading}>
          Unpair and retry
        </Button>
      ) : (
        <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={pair.loading}>
          Pair
        </Button>
      )}
    </>
  );

  return (
    <Modal open={open} onClose={handleClose} title="Pair with drone" footer={footer} className="max-w-md">
      {pair.result ? (
        <div className="space-y-3">
          <div className="rounded border border-status-success/40 bg-status-success/10 px-3 py-2 text-sm text-status-success">
            Paired successfully.
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary">Drone ID</span>
            <span className="font-mono text-sm text-text-primary break-all">
              {pair.result.paired_drone_id}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary">Fingerprint</span>
            <span className="font-mono text-xs text-text-primary break-all">
              {pair.result.key_fingerprint}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="pair-key" className="text-xs text-text-secondary">
              Pair key
            </label>
            <input
              id="pair-key"
              type="text"
              value={pairKey}
              onChange={(e) => setPairKey(e.target.value)}
              placeholder="32-character pair key"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="w-full h-9 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="drone-id" className="text-xs text-text-secondary">
              Drone device ID (optional)
            </label>
            <input
              id="drone-id"
              type="text"
              value={droneId}
              onChange={(e) => setDroneId(e.target.value)}
              placeholder="Leave blank to auto-detect"
              spellCheck={false}
              autoComplete="off"
              className="w-full h-8 px-2 bg-bg-tertiary border border-border-default text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors"
            />
          </div>
          {pair.error ? (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-xs text-status-error">
              {isAlreadyPaired ? "Already paired to another drone. Unpair and retry." : pair.error}
            </div>
          ) : null}
          {!hasClient ? (
            <div className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
              No ground station connected.
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
