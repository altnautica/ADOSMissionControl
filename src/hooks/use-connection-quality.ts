import { useTelemetryStore } from "@/stores/telemetry-store";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";

type SignalQuality = "excellent" | "good" | "fair" | "poor" | "lost" | "unknown";

interface ConnectionQualityResult {
  /** Estimated latency in ms */
  latencyMs: number;
  /** Packet loss percentage (0-100) */
  packetLoss: number;
  /** RSSI value (0-255) */
  rssi: number;
  /** Remote RSSI */
  remoteRssi: number;
  /** TX buffer usage % */
  txBuf: number;
  /** Noise floor */
  noise: number;
  /**
   * Overall signal quality rating. "unknown" when no RADIO_STATUS has ever
   * arrived; "lost" when the last one is older than the telemetry staleness
   * window — a radio that stopped reporting is not a strong link.
   */
  quality: SignalQuality;
  /** True when a RADIO_STATUS was heard but has gone stale. */
  stale: boolean;
  /** Signal strength as percentage (0-100) */
  signalStrength: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function deriveQuality(strength: number, hasData: boolean): SignalQuality {
  if (!hasData) return "unknown";
  if (strength > 80) return "excellent";
  if (strength > 60) return "good";
  if (strength > 40) return "fair";
  if (strength > 20) return "poor";
  return "lost";
}

const NO_READING = {
  latencyMs: 0,
  packetLoss: 0,
  rssi: 0,
  remoteRssi: 0,
  txBuf: 0,
  noise: 0,
  signalStrength: 0,
};

export function useConnectionQuality(): ConnectionQualityResult {
  // Fresh sample or undefined; re-renders on new telemetry and on the shared
  // 1 Hz clock, so a dead link decays instead of freezing its last bars.
  const latest = useFreshTelemetry("radio");

  if (!latest) {
    const heard = useTelemetryStore.getState().radio.latest() !== undefined;
    return heard
      ? { ...NO_READING, quality: "lost", stale: true }
      : { ...NO_READING, quality: "unknown", stale: false };
  }

  const rssi = latest.rssi;
  const noise = latest.noise;
  const remoteRssi = latest.remrssi;
  const txBuf = latest.txbuf;
  const rxerrors = latest.rxerrors;

  // Signal strength: SNR-based percentage
  const snr = rssi - noise;
  const signalStrength = clamp((snr / 60) * 100, 0, 100);

  // Rough packet loss from rxerrors (normalized, capped)
  const packetLoss = clamp(rxerrors / 10, 0, 100);

  // Estimate latency from txbuf usage (higher buffer = more latency)
  const latencyMs = Math.round(clamp((100 - txBuf) * 2, 0, 500));

  const quality = deriveQuality(signalStrength, true);

  return {
    latencyMs,
    packetLoss,
    rssi,
    remoteRssi,
    txBuf,
    noise,
    quality,
    stale: false,
    signalStrength,
  };
}
