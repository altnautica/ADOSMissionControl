"use client";

/**
 * @module PairingDialog
 * @description Modal dialog for pairing a new ADOS Drone Agent.
 * Default flow: auto-generate code → show install command → wait for drone.
 * Secondary: manual code entry with retry logic for timing issues.
 * @license GPL-3.0-only
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Loader2,
  Check,
  Copy,
  AlertCircle,
  Cpu,
  Wifi,
  Terminal,
  RotateCcw,
} from "lucide-react";
import { useMutation } from "convex/react";
import { cn } from "@/lib/utils";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdPairingApi } from "@/lib/community-api-drones";
import { usePairingStore, type DiscoveredAgent } from "@/stores/pairing-store";

interface PairingDialogProps {
  open: boolean;
  onClose: () => void;
  onPaired?: (deviceId: string, apiKey: string, url: string) => void;
}

type PairingState =
  | "setup"      // generating code
  | "waiting"    // code generated, waiting for drone
  | "manual"     // user wants to enter code manually
  | "searching"  // manual code submitted, retrying
  | "claiming"   // manual code matched, claiming
  | "success"    // paired
  | "error"      // failed after retries
  | "expired";   // code TTL reached

const INSTALL_URL = "https://raw.githubusercontent.com/altnautica/ADOSDroneAgent/main/scripts/install.sh";
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RETRY_INTERVAL_MS = 3000;
const MAX_RETRIES = 10; // 30 seconds of retrying

export function PairingDialog({ open, onClose, onPaired }: PairingDialogProps) {
  const [state, setState] = useState<PairingState>("setup");
  const [preGenCode, setPreGenCode] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [pairedInfo, setPairedInfo] = useState<{
    deviceId: string;
    name: string;
    apiKey: string;
    mdnsHost: string;
  } | null>(null);
  const [initialDroneCount, setInitialDroneCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const convexAvailable = useConvexAvailable();
  // convexAvailable is stable (env-var derived, never changes between renders)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const claimCode = convexAvailable ? useMutation(cmdPairingApi.claimPairingCode) : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const preGenerate = convexAvailable ? useMutation(cmdPairingApi.preGenerateCode) : null;

  const discoveredAgents = usePairingStore((s) => s.discoveredAgents);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const setPairingInProgress = usePairingStore((s) => s.setPairingInProgress);
  const setPairingError = usePairingStore((s) => s.setPairingError);

  // Auto-generate code when dialog opens
  useEffect(() => {
    if (!open) return;

    // Reset all state
    setState("setup");
    setPreGenCode(null);
    setManualCode("");
    setErrorMessage("");
    setPairedInfo(null);
    setCopied(false);
    setInitialDroneCount(pairedDrones.length);
    // Generate code immediately
    generateCode();

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Watch for new drones appearing (zero-touch flow)
  useEffect(() => {
    if (state !== "waiting" && state !== "searching") return;
    if (pairedDrones.length > initialDroneCount) {
      const newDrone = pairedDrones[pairedDrones.length - 1];
      if (newDrone) {
        setPairedInfo({
          deviceId: newDrone.deviceId,
          name: newDrone.name,
          apiKey: newDrone.apiKey,
          mdnsHost: newDrone.mdnsHost || `${newDrone.deviceId}.local`,
        });
        setState("success");
        setPairingInProgress(false);

        // Auto-connect after a brief pause
        setTimeout(() => {
          const host = newDrone.mdnsHost || newDrone.lastIp;
          if (host) {
            onPaired?.(newDrone.deviceId, newDrone.apiKey, `http://${host}:8080`);
          }
        }, 1500);
      }
    }
  }, [pairedDrones.length, initialDroneCount, state, pairedDrones, onPaired, setPairingInProgress]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  async function generateCode() {
    if (!preGenerate) {
      // Fallback for local-only mode
      const generated = Array.from({ length: 6 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]
      ).join("");
      setPreGenCode(generated);

      setState("waiting");
      startExpiryTimer();
      return;
    }
    try {
      const result = await preGenerate({});
      setPreGenCode(result.code);

      setState("waiting");
      startExpiryTimer();
    } catch {
      const generated = Array.from({ length: 6 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]
      ).join("");
      setPreGenCode(generated);

      setState("waiting");
      startExpiryTimer();
    }
  }

  function startExpiryTimer() {
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = setTimeout(() => {
      if (state === "waiting") {
        setState("expired");
      }
    }, CODE_TTL_MS);
  }

  function getInstallCommand(code: string) {
    return `curl -sSL ${INSTALL_URL} | sudo bash -s -- --pair ${code}`;
  }

  function handleCopy() {
    if (!preGenCode) return;
    navigator.clipboard.writeText(getInstallCommand(preGenCode)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function switchToManual() {
    setState("manual");
    setManualCode("");
    setErrorMessage("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function switchToAutomatic() {
    setState("waiting");
    setManualCode("");
    setErrorMessage("");
  }

  const handleManualCodeChange = useCallback((value: string) => {
    const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
    setManualCode(cleaned);
    setErrorMessage("");
  }, []);

  function handleManualSubmit() {
    if (manualCode.length === 6) {
      submitCodeWithRetry(manualCode, MAX_RETRIES);
    }
  }

  async function submitCodeWithRetry(pairingCode: string, retriesLeft: number) {
    if (retriesLeft === MAX_RETRIES) {
      setState("searching");
      setPairingInProgress(true);
      setPairingError(null);
    }

    try {
      if (!claimCode) {
        throw new Error("Convex not available. Cannot pair in local-only mode.");
      }

      const result = await claimCode({ code: pairingCode });
      const info = {
        deviceId: result.deviceId || `ados-${pairingCode.toLowerCase()}`,
        name: result.name || "ADOS Agent",
        apiKey: result.apiKey || "",
        mdnsHost: result.mdnsHost || `ados-${pairingCode.toLowerCase()}.local`,
      };
      setPairedInfo(info);
      setState("success");
      setPairingInProgress(false);

      setTimeout(() => {
        const host = info.mdnsHost || result.localIp;
        if (host) {
          onPaired?.(info.deviceId, info.apiKey, `http://${host}:8080`);
        }
      }, 1500);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Pairing failed";
      const isInvalid = raw.includes("Invalid");

      if (isInvalid && retriesLeft > 0) {
        // Agent might not have registered yet, retry
        retryTimerRef.current = setTimeout(() => {
          submitCodeWithRetry(pairingCode, retriesLeft - 1);
        }, RETRY_INTERVAL_MS);
        return;
      }

      // Retries exhausted or non-retryable error
      const msg = raw.includes("expired")
        ? "Pairing code expired. Ask the agent to generate a new one."
        : raw.includes("already claimed")
          ? "This code was already used by another account."
          : isInvalid
            ? "Could not find that pairing code. Make sure the agent is running and connected to the internet."
            : raw;
      setErrorMessage(msg);
      setState("error");
      setPairingInProgress(false);
      setPairingError(msg);
    }
  }

  function handleDiscoveredPair(agent: DiscoveredAgent) {
    setManualCode(agent.pairingCode);
    submitCodeWithRetry(agent.pairingCode, MAX_RETRIES);
  }

  function handleRetry() {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    setState("setup");
    setPreGenCode(null);
    setManualCode("");
    setErrorMessage("");
    setPairedInfo(null);
    generateCode();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-bg-secondary border border-border-default rounded-lg shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h2 className="text-sm font-semibold text-text-primary">
            Pair New Drone
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Setup — generating code */}
          {state === "setup" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 size={24} className="animate-spin text-accent-primary" />
              <p className="text-xs text-text-secondary">
                Generating pairing code...
              </p>
            </div>
          )}

          {/* Waiting — code generated, show install command */}
          {state === "waiting" && preGenCode && (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Terminal size={14} className="text-accent-primary" />
                  <p className="text-xs font-medium text-text-primary">
                    Run this on your drone
                  </p>
                </div>

                <div className="relative group">
                  <div className="flex items-start gap-2 p-3 bg-bg-primary border border-border-default rounded-lg">
                    <code className="flex-1 text-[11px] font-mono text-text-secondary leading-relaxed break-all select-all">
                      {getInstallCommand(preGenCode)}
                    </code>
                    <button
                      onClick={handleCopy}
                      className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors shrink-0 mt-[-2px]"
                      title="Copy to clipboard"
                    >
                      {copied ? (
                        <Check size={14} className="text-status-success" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2 py-3">
                  <Loader2 size={14} className="animate-spin text-text-tertiary" />
                  <p className="text-xs text-text-tertiary">
                    Waiting for your drone to connect...
                  </p>
                </div>
              </div>

              {/* Discovered agents */}
              {discoveredAgents.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                    Discovered on network
                  </p>
                  <div className="space-y-2">
                    {discoveredAgents.map((agent) => (
                      <button
                        key={agent.deviceId}
                        onClick={() => handleDiscoveredPair(agent)}
                        className="w-full flex items-center gap-3 p-3 bg-bg-primary border border-border-default rounded hover:border-accent-primary/50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                          <Cpu size={14} className="text-accent-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-primary truncate">
                              {agent.name}
                            </span>
                            <span className="text-[10px] text-text-tertiary">
                              {agent.board}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Wifi size={10} className="text-status-success" />
                            <span className="text-[10px] text-text-tertiary font-mono">
                              {agent.pairingCode}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-medium text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity">
                          Pair
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Switch to manual */}
              <div className="pt-2 border-t border-border-default">
                <button
                  onClick={switchToManual}
                  className="w-full text-center text-[11px] text-text-tertiary hover:text-accent-primary transition-colors py-1"
                >
                  Already have a code? Enter it manually
                </button>
              </div>
            </>
          )}

          {/* Manual code entry */}
          {state === "manual" && (
            <>
              <div className="text-center space-y-2">
                <p className="text-xs text-text-secondary">
                  Enter the 6-character pairing code from your agent terminal.
                </p>
              </div>

              <div className="flex justify-center">
                <div className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={manualCode}
                    onChange={(e) => handleManualCodeChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && manualCode.length === 6) {
                        handleManualSubmit();
                      }
                    }}
                    maxLength={6}
                    placeholder="------"
                    className="w-64 text-center text-2xl font-mono font-bold tracking-[0.5em] bg-bg-primary border border-border-default rounded-lg px-4 py-3 text-text-primary placeholder:text-text-tertiary/40 outline-none focus:border-accent-primary transition-colors uppercase"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="absolute -bottom-5 left-0 right-0 text-center">
                    <span className="text-[10px] text-text-tertiary">
                      {manualCode.length}/6 characters
                    </span>
                  </div>
                </div>
              </div>

              {manualCode.length === 6 && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleManualSubmit}
                    className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:bg-accent-primary/90 transition-colors"
                  >
                    Pair
                  </button>
                </div>
              )}

              {/* Switch back to automatic */}
              <div className="pt-2 border-t border-border-default">
                <button
                  onClick={switchToAutomatic}
                  className="w-full text-center text-[11px] text-text-tertiary hover:text-accent-primary transition-colors py-1"
                >
                  Back to install command
                </button>
              </div>
            </>
          )}

          {/* Searching — manual code submitted, retrying */}
          {state === "searching" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 size={24} className="animate-spin text-accent-primary" />
              <div className="text-center space-y-1">
                <p className="text-xs text-text-secondary">
                  Looking for your drone...
                </p>
                <p className="text-[10px] text-text-tertiary">
                  Code:{" "}
                  <span className="font-mono font-bold text-text-primary">
                    {manualCode}
                  </span>
                </p>
                <p className="text-[10px] text-text-tertiary">
                  This can take up to 30 seconds if the agent just started.
                </p>
              </div>
            </div>
          )}

          {/* Claiming — legacy, brief transition */}
          {state === "claiming" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 size={24} className="animate-spin text-accent-primary" />
              <p className="text-xs text-text-secondary">
                Pairing...
              </p>
            </div>
          )}

          {/* Success */}
          {state === "success" && pairedInfo && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-10 h-10 rounded-full bg-status-success/15 flex items-center justify-center">
                <Check size={20} className="text-status-success" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-text-primary">Paired!</p>
                <p className="text-xs text-text-secondary">
                  {pairedInfo.name}
                </p>
                <p className="text-[10px] text-text-tertiary font-mono">
                  {pairedInfo.mdnsHost}
                </p>
              </div>
              <p className="text-[11px] text-text-tertiary">
                Connecting automatically...
              </p>
            </div>
          )}

          {/* Error */}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-10 h-10 rounded-full bg-status-error/15 flex items-center justify-center">
                <AlertCircle size={20} className="text-status-error" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  Pairing Failed
                </p>
                <p className="text-xs text-status-error">{errorMessage}</p>
              </div>
              <button
                onClick={handleRetry}
                className="px-4 py-1.5 text-xs font-medium bg-bg-tertiary border border-border-default rounded hover:bg-bg-primary transition-colors text-text-primary"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Expired */}
          {state === "expired" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-10 h-10 rounded-full bg-status-warning/15 flex items-center justify-center">
                <RotateCcw size={20} className="text-status-warning" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  Code Expired
                </p>
                <p className="text-xs text-text-secondary">
                  The pairing code timed out after 15 minutes.
                </p>
              </div>
              <button
                onClick={handleRetry}
                className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:bg-accent-primary/90 transition-colors"
              >
                Generate New Code
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline pairing code input for embedding in other pages (e.g., AgentDisconnectedPage).
 * Same 6-char input logic without the modal wrapper.
 */
export function PairingCodeInput({
  onSubmit,
  disabled,
}: {
  onSubmit: (code: string) => void;
  disabled?: boolean;
}) {
  const [code, setCode] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(value: string) {
    const cleaned = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) {
      onSubmit(cleaned);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={code}
      onChange={(e) => handleChange(e.target.value)}
      maxLength={6}
      disabled={disabled}
      placeholder="------"
      className={cn(
        "w-52 text-center text-xl font-mono font-bold tracking-[0.4em] bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary placeholder:text-text-tertiary/40 outline-none focus:border-accent-primary transition-colors uppercase",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
