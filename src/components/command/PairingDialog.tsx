"use client";

/**
 * @module PairingDialog
 * @description Modal dialog for pairing a new ADOS Drone Agent.
 * Single-code flow: generate code → show to user → wait for drone.
 * @license GPL-3.0-only
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
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
  | "setup"    // generating code
  | "waiting"  // code generated, waiting for drone
  | "success"  // paired
  | "error"    // failed
  | "expired"; // code TTL reached

const INSTALL_URL =
  "https://raw.githubusercontent.com/altnautica/ADOSDroneAgent/main/scripts/install.sh";
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function PairingDialog({
  open,
  onClose,
  onPaired,
}: PairingDialogProps) {
  const t = useTranslations("command");
  const [state, setState] = useState<PairingState>("setup");
  const [preGenCode, setPreGenCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(CODE_TTL_MS / 1000);
  const [pairedInfo, setPairedInfo] = useState<{
    deviceId: string;
    name: string;
    apiKey: string;
    mdnsHost: string;
  } | null>(null);
  const [initialDroneCount, setInitialDroneCount] = useState(0);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeGeneratedAt = useRef<number>(0);

  const convexAvailable = useConvexAvailable();
  // convexAvailable is stable (env-var derived, never changes between renders)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const claimCode = convexAvailable
    ? useMutation(cmdPairingApi.claimPairingCode)
    : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const preGenerate = convexAvailable
    ? useMutation(cmdPairingApi.preGenerateCode)
    : null;

  const discoveredAgents = usePairingStore((s) => s.discoveredAgents);
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const setPairingInProgress = usePairingStore(
    (s) => s.setPairingInProgress
  );
  const setPairingError = usePairingStore((s) => s.setPairingError);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    stopCountdown();
    codeGeneratedAt.current = Date.now();
    setSecondsLeft(CODE_TTL_MS / 1000);

    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - codeGeneratedAt.current;
      const remaining = Math.max(
        0,
        Math.ceil((CODE_TTL_MS - elapsed) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setState((prev) => (prev === "waiting" ? "expired" : prev));
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    }, 1000);
  }, [stopCountdown]);

  const generateCode = useCallback(async () => {
    setState("setup");
    setPreGenCode(null);
    setErrorMessage("");
    setPairedInfo(null);
    setCopiedCode(false);
    setCopiedInstall(false);

    const fallback = () =>
      Array.from(
        { length: 6 },
        () =>
          "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]
      ).join("");

    let generated: string;
    if (preGenerate) {
      try {
        const result = await preGenerate({});
        generated = result.code;
      } catch {
        generated = fallback();
      }
    } else {
      generated = fallback();
    }

    setPreGenCode(generated);
    setState("waiting");
    startCountdown();
  }, [preGenerate, startCountdown]);

  // Auto-generate code when dialog opens
  useEffect(() => {
    if (!open) return;
    setInitialDroneCount(pairedDrones.length);
    generateCode();
    return () => stopCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Watch for new drones appearing (zero-touch flow)
  useEffect(() => {
    if (state !== "waiting") return;
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
        stopCountdown();

        setTimeout(() => {
          const host = newDrone.mdnsHost || newDrone.lastIp;
          if (host) {
            onPaired?.(
              newDrone.deviceId,
              newDrone.apiKey,
              `http://${host}:8080`
            );
          }
        }, 1500);
      }
    }
  }, [
    pairedDrones.length,
    initialDroneCount,
    state,
    pairedDrones,
    onPaired,
    setPairingInProgress,
    stopCountdown,
  ]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  function getInstallCommand(code: string) {
    return `curl -sSL ${INSTALL_URL} | sudo bash -s -- --pair ${code}`;
  }

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handleCopyCode() {
    if (!preGenCode) return;
    navigator.clipboard.writeText(preGenCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  }

  function handleCopyInstall() {
    if (!preGenCode) return;
    navigator.clipboard.writeText(getInstallCommand(preGenCode)).then(() => {
      setCopiedInstall(true);
      setTimeout(() => setCopiedInstall(false), 2000);
    });
  }

  async function handleDiscoveredPair(agent: DiscoveredAgent) {
    setPairingInProgress(true);
    setPairingError(null);

    try {
      if (!claimCode) {
        throw new Error(
          "Convex not available. Cannot pair in local-only mode."
        );
      }

      const result = await claimCode({ code: agent.pairingCode });
      const info = {
        deviceId: result.deviceId || `ados-${agent.pairingCode.toLowerCase()}`,
        name: result.name || "ADOS Agent",
        apiKey: result.apiKey || "",
        mdnsHost:
          result.mdnsHost || `ados-${agent.pairingCode.toLowerCase()}.local`,
      };
      setPairedInfo(info);
      setState("success");
      setPairingInProgress(false);
      stopCountdown();

      setTimeout(() => {
        const host = info.mdnsHost || result.localIp;
        if (host) {
          onPaired?.(info.deviceId, info.apiKey, `http://${host}:8080`);
        }
      }, 1500);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Pairing failed";
      const msg = raw.includes("expired")
        ? "Pairing code expired. Ask the agent to generate a new one."
        : raw.includes("already claimed")
          ? "This code was already used by another account."
          : raw.includes("Invalid")
            ? "Could not find that pairing code. Make sure the agent is running and connected to the internet."
            : raw;
      setErrorMessage(msg);
      setState("error");
      setPairingInProgress(false);
      setPairingError(msg);
    }
  }

  function handleRetry() {
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
            {t("pairNewDrone")}
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
              <Loader2
                size={24}
                className="animate-spin text-accent-primary"
              />
              <p className="text-xs text-text-secondary">
                {t("generatingCode")}
              </p>
            </div>
          )}

          {/* Waiting — code generated, show code + install command */}
          {state === "waiting" && preGenCode && (
            <>
              {/* Hero code */}
              <div className="text-center space-y-2">
                <div className="flex items-center justify-center gap-1">
                  {preGenCode.split("").map((char, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center justify-center w-10 h-12 bg-bg-primary border border-border-default rounded text-xl font-mono font-bold text-text-primary"
                    >
                      {char}
                    </span>
                  ))}
                  <button
                    onClick={handleCopyCode}
                    className="ml-2 p-2 text-text-tertiary hover:text-text-primary transition-colors"
                    title={t("copyCode")}
                  >
                    {copiedCode ? (
                      <Check size={14} className="text-status-success" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-tertiary">
                  {t("expiresIn")}{" "}
                  <span
                    className={
                      secondsLeft < 60
                        ? "text-status-warning font-medium"
                        : "font-medium text-text-secondary"
                    }
                  >
                    {formatTime(secondsLeft)}
                  </span>
                </p>
              </div>

              {/* Install command */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Terminal size={14} className="text-accent-primary" />
                  <p className="text-xs font-medium text-text-primary">
                    {t("firstTime")}
                  </p>
                </div>

                <div className="flex items-start gap-2 p-3 bg-bg-primary border border-border-default rounded-lg">
                  <code className="flex-1 text-[11px] font-mono text-text-secondary leading-relaxed break-all select-all">
                    {getInstallCommand(preGenCode)}
                  </code>
                  <button
                    onClick={handleCopyInstall}
                    className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                    title={t("copyInstallCommand")}
                  >
                    {copiedInstall ? (
                      <Check size={14} className="text-status-success" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>

                <p className="text-[10px] text-text-tertiary">
                  {t("alreadyInstalled")}{" "}
                  <code className="font-mono text-text-secondary">
                    sudo ados pair {preGenCode}
                  </code>
                </p>
              </div>

              {/* Waiting indicator */}
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2
                  size={14}
                  className="animate-spin text-text-tertiary"
                />
                <p className="text-xs text-text-tertiary">
                  {t("waitingForDrone")}
                </p>
              </div>

              {/* Discovered agents */}
              {discoveredAgents.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                    {t("discoveredOnNetwork")}
                  </p>
                  <div className="space-y-2">
                    {discoveredAgents.map((agent) => (
                      <button
                        key={agent.deviceId}
                        onClick={() => handleDiscoveredPair(agent)}
                        className="w-full flex items-center gap-3 p-3 bg-bg-primary border border-border-default rounded hover:border-accent-primary/50 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                          <Cpu
                            size={14}
                            className="text-accent-primary"
                          />
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
                            <Wifi
                              size={10}
                              className="text-status-success"
                            />
                            <span className="text-[10px] text-text-tertiary font-mono">
                              {agent.pairingCode}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-medium text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity">
                          {t("pair")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Success */}
          {state === "success" && pairedInfo && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-10 h-10 rounded-full bg-status-success/15 flex items-center justify-center">
                <Check size={20} className="text-status-success" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  {t("paired")}
                </p>
                <p className="text-xs text-text-secondary">
                  {pairedInfo.name}
                </p>
                <p className="text-[10px] text-text-tertiary font-mono">
                  {pairedInfo.mdnsHost}
                </p>
              </div>
              <p className="text-[11px] text-text-tertiary">
                {t("connectingAutomatically")}
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
                  {t("pairingFailed")}
                </p>
                <p className="text-xs text-status-error">{errorMessage}</p>
              </div>
              <button
                onClick={handleRetry}
                className="px-4 py-1.5 text-xs font-medium bg-bg-tertiary border border-border-default rounded hover:bg-bg-primary transition-colors text-text-primary"
              >
                {t("tryAgain")}
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
                  {t("codeExpired")}
                </p>
                <p className="text-xs text-text-secondary">
                  {t("codeExpiredMessage")}
                </p>
              </div>
              <button
                onClick={handleRetry}
                className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:bg-accent-primary/90 transition-colors"
              >
                {t("generateNewCode")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline pairing code input for embedding in other pages.
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
    const cleaned = value
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 6);
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
