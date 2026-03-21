"use client";

/**
 * @module AgentDisconnectedPage
 * @description Pairing-first page shown when no agent is connected.
 * Shows a pre-generated pairing code with countdown, install command,
 * and consumer-facing feature cards.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpRight,
  Radio,
  Video,
  Signal,
  Wifi,
  Sparkles,
  Layers,
  Terminal,
  Code2,
  AlertTriangle,
  Cpu,
  Copy,
  Check,
  Loader2,
} from "lucide-react";
import { useMutation } from "convex/react";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdPairingApi } from "@/lib/community-api-drones";
import { usePairingStore } from "@/stores/pairing-store";

const features = [
  {
    icon: Radio,
    title: "MAVLink Proxy",
    description:
      "Full bidirectional flight controller access over WebSocket, TCP, and UDP. Configure, monitor, and control your drone from anywhere.",
  },
  {
    icon: Video,
    title: "HD Video Streaming",
    description:
      "Live HD video from your drone to any browser. Low-latency streaming powered by WFB-ng and OpenHD with RTL8812-series WiFi adapters.",
  },
  {
    icon: Signal,
    title: "4G/5G Telemetry",
    description:
      "Fly beyond visual line of sight. Real-time telemetry and control over cellular networks. No range limits.",
  },
  {
    icon: Wifi,
    title: "Extended Range Datalinks",
    description:
      "Push your control range to 50km+ using RTL8812AU/EU WiFi adapters in monitor mode. Purpose-built for long-range drone operations.",
  },
  {
    icon: Cpu,
    title: "Plug & Play Hardware",
    description:
      "Automatic hardware detection and setup. The agent recognizes your flight controller, sensors, and peripherals on first boot. No manual configuration needed.",
  },
  {
    icon: Sparkles,
    title: "AI-Ready",
    description:
      "Built for autonomous operations. Python SDK, scripting engine, and REST API let you build intelligent flight behaviors and integrate ML models.",
  },
  {
    icon: Layers,
    title: "Software-Defined Drone",
    description:
      "Turn any ArduPilot or PX4 drone into a smart drone. One companion computer. Full software control over every system.",
  },
  {
    icon: Terminal,
    title: "SSH & Terminal Access",
    description:
      "Full TUI dashboard over SSH. Five screens for telemetry, MAVLink inspection, config editing, and logs. No browser needed.",
  },
  {
    icon: Code2,
    title: "Developer Tools",
    description:
      "REST API at :8080, Python SDK, YAML missions, CLI tools, and five scripting tiers from simple text commands to full autonomy.",
  },
];

const INSTALL_URL =
  "https://raw.githubusercontent.com/altnautica/ADOSDroneAgent/main/scripts/install.sh";
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface AgentDisconnectedPageProps {
  onOpenPairing?: () => void;
}

export function AgentDisconnectedPage({
  onOpenPairing,
}: AgentDisconnectedPageProps) {
  const [code, setCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(CODE_TTL_MS / 1000);
  const [expired, setExpired] = useState(false);

  const expiryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const codeGeneratedAt = useRef<number>(0);

  const convexAvailable = useConvexAvailable();
  // convexAvailable is stable (env-var derived, never changes between renders)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const preGenerate = convexAvailable
    ? useMutation(cmdPairingApi.preGenerateCode)
    : null;

  const discoveredAgents = usePairingStore((s) => s.discoveredAgents);

  const generateCode = useCallback(async () => {
    setExpired(false);
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

    setCode(generated);
    codeGeneratedAt.current = Date.now();
    setSecondsLeft(CODE_TTL_MS / 1000);

    // Start countdown
    if (expiryRef.current) clearInterval(expiryRef.current);
    expiryRef.current = setInterval(() => {
      const elapsed = Date.now() - codeGeneratedAt.current;
      const remaining = Math.max(
        0,
        Math.ceil((CODE_TTL_MS - elapsed) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        setExpired(true);
        if (expiryRef.current) clearInterval(expiryRef.current);
      }
    }, 1000);
  }, [preGenerate]);

  // Generate code on mount
  useEffect(() => {
    generateCode();
    return () => {
      if (expiryRef.current) clearInterval(expiryRef.current);
    };
  }, [generateCode]);

  function getInstallCommand(c: string) {
    return `curl -sSL ${INSTALL_URL} | sudo bash -s -- --pair ${c}`;
  }

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function handleCopyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  }

  function handleCopyInstall() {
    if (!code) return;
    navigator.clipboard.writeText(getInstallCommand(code)).then(() => {
      setCopiedInstall(true);
      setTimeout(() => setCopiedInstall(false), 2000);
    });
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 rounded-full">
            <AlertTriangle size={12} />
            ALPHA
          </div>
          <h1 className="text-3xl font-display font-bold text-text-primary">
            Pair Your Drone
          </h1>
          <p className="text-text-secondary text-base max-w-lg mx-auto">
            Install the agent, enter this code, and you&apos;re connected.
          </p>
        </div>

        {/* Pairing code hero */}
        <div className="max-w-md mx-auto">
          {!code ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2
                size={24}
                className="animate-spin text-accent-primary"
              />
              <p className="text-xs text-text-secondary">
                Generating pairing code...
              </p>
            </div>
          ) : expired ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <p className="text-sm text-text-secondary">
                Code expired.
              </p>
              <button
                onClick={generateCode}
                className="px-4 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:bg-accent-primary/90 transition-colors"
              >
                Generate New Code
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Big code display */}
              <div className="p-5 bg-bg-secondary border border-border-default rounded-lg text-center space-y-2">
                <div className="flex items-center justify-center gap-2">
                  {code.split("").map((char, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center justify-center w-12 h-14 bg-bg-primary border border-border-default rounded text-2xl font-mono font-bold text-text-primary"
                    >
                      {char}
                    </span>
                  ))}
                  <button
                    onClick={handleCopyCode}
                    className="ml-2 p-2 text-text-tertiary hover:text-text-primary transition-colors"
                    title="Copy code"
                  >
                    {copiedCode ? (
                      <Check size={16} className="text-status-success" />
                    ) : (
                      <Copy size={16} />
                    )}
                  </button>
                </div>
                <p className="text-sm text-text-tertiary">
                  Expires in{" "}
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
                <p className="text-sm text-text-secondary">
                  First time? Run this on your drone:
                </p>
                <div className="flex items-start gap-2 p-3 bg-bg-secondary border border-border-default rounded-lg">
                  <code className="flex-1 text-xs font-mono text-text-secondary leading-relaxed break-all select-all">
                    {getInstallCommand(code)}
                  </code>
                  <button
                    onClick={handleCopyInstall}
                    className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                    title="Copy install command"
                  >
                    {copiedInstall ? (
                      <Check size={14} className="text-status-success" />
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-tertiary">
                  Already installed? Run:{" "}
                  <code className="font-mono text-text-secondary">
                    sudo ados pair {code}
                  </code>
                </p>
              </div>

              {/* Waiting indicator */}
              <div className="flex items-center justify-center gap-2 py-2">
                <Loader2
                  size={14}
                  className="animate-spin text-text-tertiary"
                />
                <p className="text-sm text-text-tertiary">
                  Waiting for your drone to connect...
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Discovered agents */}
        {discoveredAgents.length > 0 && (
          <div className="max-w-2xl mx-auto space-y-3">
            <h2 className="text-xs font-medium text-text-primary flex items-center gap-2">
              <Wifi size={12} className="text-status-success" />
              Discovered on your network
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {discoveredAgents.map((agent) => (
                <button
                  key={agent.deviceId}
                  onClick={onOpenPairing}
                  className="flex items-center gap-3 p-3 bg-bg-secondary border border-border-default rounded hover:border-accent-primary/40 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                    <Cpu size={14} className="text-accent-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-text-primary">
                      {agent.name}
                    </p>
                    <p className="text-[10px] text-text-tertiary">
                      {agent.board} &middot;{" "}
                      <span className="font-mono">{agent.pairingCode}</span>
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feature cards */}
        <div>
          <h2 className="text-lg font-medium text-text-primary mb-4">
            Turn any drone into a smart drone
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="p-5 bg-bg-secondary border border-border-default rounded space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Icon size={18} className="text-accent-primary" />
                  <span className="text-sm font-medium text-text-primary">
                    {title}
                  </span>
                </div>
                <p className="text-xs text-text-tertiary leading-relaxed">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Alpha Disclaimer */}
        <div className="flex items-start gap-3 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded">
          <AlertTriangle
            size={16}
            className="text-yellow-400 shrink-0 mt-0.5"
          />
          <p className="text-sm text-yellow-200/80 leading-relaxed">
            This is alpha software. Expect bugs, breaking changes, and
            incomplete features. The Command tab provides direct control over
            drone agent services and configuration. Use at your own risk.
          </p>
        </div>

        {/* Requirements */}
        <div className="text-center space-y-3">
          <h2 className="text-base font-medium text-text-primary">
            Requirements
          </h2>
          <div className="inline-flex items-center gap-4 text-sm text-text-tertiary">
            <span className="flex items-center gap-1.5">
              <Cpu size={12} />
              Python 3.11+
            </span>
            <span className="text-border-default">|</span>
            <span>Linux (Raspberry Pi OS recommended)</span>
            <span className="text-border-default">|</span>
            <span>ArduPilot or PX4 flight controller</span>
          </div>
        </div>

        {/* GitHub link */}
        <div className="text-center pb-6">
          <a
            href="https://github.com/altnautica/ADOSDroneAgent"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-text-primary bg-bg-tertiary border border-border-default rounded hover:bg-bg-secondary transition-colors"
          >
            View on GitHub
            <ArrowUpRight size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}
