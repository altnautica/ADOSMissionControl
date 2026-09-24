"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useVideoStore } from "@/stores/video-store";
import {
  Field,
  MeasuredHops,
  Note,
  Row,
  SEI_OFF_REMEDIATION,
  Section,
} from "./latency-breakdown-parts";

interface VideoLatencyBreakdownProps {
  children: ReactNode;
  className?: string;
}

const HOVER_OPEN_DELAY_MS = 200;
const HOVER_CLOSE_DELAY_MS = 120;

const fmtMs = (v: number | null | undefined, suffix = "ms"): string => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Math.round(v)} ${suffix}`;
};

/**
 * Hover-with-click-to-pin popover that explains every measurable
 * contribution to end-to-end video latency. Reuses the existing
 * Zustand video store; the parent component only has to wrap the
 * latency chip with this trigger.
 */
export function VideoLatencyBreakdown({
  children,
  className,
}: VideoLatencyBreakdownProps) {
  const latency = useVideoStore((s) => s.latency);
  const codec = useVideoStore((s) => s.codec);
  const bitrateKbps = useVideoStore((s) => s.bitrateKbps);
  const transport = useVideoStore((s) => s.transport);
  const packetsLost = useVideoStore((s) => s.packetsLost);

  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  // Anchor position. Recomputed on open + on scroll/resize so the panel
  // stays glued to the chip even when the parent layout shifts.
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );

  const updateAnchor = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Position the panel above the chip. The final translate happens
    // in the rendered style so the panel can mirror to below if it
    // would clip the top of the viewport.
    setAnchor({ top: rect.top, left: rect.left });
  }, []);

  const open = pinned || hovered;

  useEffect(() => {
    if (!open) return;
    updateAnchor();
    const onScroll = () => updateAnchor();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, updateAnchor]);

  // Click-outside closes a pinned panel.
  useEffect(() => {
    if (!pinned) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      const panel = document.getElementById("video-latency-breakdown");
      if (panel?.contains(target)) return;
      setPinned(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [pinned]);

  const handleEnter = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      setHovered(true);
      openTimerRef.current = null;
    }, HOVER_OPEN_DELAY_MS);
  }, []);

  const handleLeave = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = window.setTimeout(() => {
      setHovered(false);
      closeTimerRef.current = null;
    }, HOVER_CLOSE_DELAY_MS);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setPinned((p) => !p);
    },
    [],
  );

  // Render-only state derivations. Kept inline so the popover stays
  // a single self-contained component.
  const supportsScriptTransform =
    typeof window !== "undefined" && "RTCRtpScriptTransform" in window;

  const hasG2G = latency.trueG2GMs !== null;
  // There is no cloud-transport branch here any more. It read
  // `transport === "cloud-whep" || transport === "cloud-mse"` — two values
  // nothing could ever set — so `lanPollUnreachable` was permanently false
  // and both of the notes it guarded were unreachable text. The honest
  // "AIR / G2G not measured" reasons are the ones below: no script
  // transform, SEI off on the agent, or still waiting for the first sample.
  const bitrateLabel =
    bitrateKbps > 0
      ? bitrateKbps >= 1000
        ? `${(bitrateKbps / 1000).toFixed(1)} Mbps`
        : `${bitrateKbps} kbps`
      : "—";

  // Compute the position style. Panel is 320px wide; mirror to the
  // right of the trigger when there is room, mirror below if clipping
  // the top.
  const panelStyle: CSSProperties = {};
  if (anchor) {
    const PANEL_WIDTH = 320;
    const PANEL_HEIGHT_ESTIMATE = 400;
    const margin = 8;
    let left = anchor.left;
    if (left + PANEL_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - PANEL_WIDTH - margin);
    }
    let top = anchor.top - PANEL_HEIGHT_ESTIMATE - margin;
    if (top < margin) {
      top = anchor.top + 24; // mirror below the chip
    }
    panelStyle.left = left;
    panelStyle.top = top;
  }

  return (
    <>
      <span
        ref={triggerRef}
        className={cn("cursor-pointer", className)}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {children}
      </span>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              id="video-latency-breakdown"
              role="dialog"
              aria-label="Video latency breakdown"
              onMouseEnter={handleEnter}
              onMouseLeave={handleLeave}
              style={panelStyle}
              className={cn(
                "fixed z-[2000] w-[320px]",
                "rounded-md border border-border-default bg-bg-tertiary",
                "shadow-lg backdrop-blur-sm",
                "text-[11px] font-mono text-text-primary",
              )}
            >
              <header className="flex items-center justify-between px-3 py-2 border-b border-border-default">
                <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
                  End-to-end latency
                </span>
                {pinned && (
                  <button
                    type="button"
                    onClick={() => setPinned(false)}
                    aria-label="Close pinned panel"
                    className="text-text-tertiary hover:text-text-primary"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </header>

              <div className="px-3 py-2 space-y-3">
                {/* True glass-to-glass */}
                <Section
                  title="True glass-to-glass"
                  subtitle="camera → your monitor"
                >
                  {hasG2G ? (
                    <Row
                      label="Sample EWMA"
                      value={
                        latency.trueG2GStdDevMs != null
                          ? `${Math.round(latency.trueG2GMs ?? 0)} ms ± ${Math.round(latency.trueG2GStdDevMs)}`
                          : fmtMs(latency.trueG2GMs)
                      }
                      tooltip="Time from camera capture on the drone to the frame being presented on your screen. Uses SEI timestamps in the H.264 bitstream + WebRTC presentationTime + a drone↔browser clock offset estimate."
                    />
                  ) : (
                    <Note>
                      {!supportsScriptTransform
                        ? "Not measured — this browser does not expose RTCRtpScriptTransform. Use a recent Chromium-based browser to enable true glass-to-glass."
                        : latency.airSource === "unavailable"
                          ? `Not measured — SEI is off on the agent. ${SEI_OFF_REMEDIATION}`
                          : "Measuring… waiting for the first SEI sample to land."}
                    </Note>
                  )}
                </Section>

                {/* Air side */}
                {/* NOT "camera → tap": the SEI stamp is injected AFTER
                    encode, and the readback is off the drone's own RTSP
                    feed, so this figure excludes capture, encode, the
                    radio, the ground ingest and the browser. Calling it
                    anything wider is the difference between a 74 ms
                    publish-side number and a glass-to-glass number that
                    has never been measured. */}
                <Section
                  title="Drone publish side"
                  subtitle="encoder output → drone RTSP readback"
                >
                  {latency.airSource === "unavailable" ? (
                    <Note>
                      SEI is off on the agent. {SEI_OFF_REMEDIATION}
                    </Note>
                  ) : (
                    <>
                      <Row
                        label="Stamp-to-readback EWMA"
                        value={fmtMs(latency.airLatencyMs)}
                        tooltip="Drone-side stamp-to-readback: the time between the encoder emitting a frame (where the SEI timestamp is injected, after encode) and that frame being read back off the drone's own RTSP feed. Covers the publish mux, the RTSP publish and the drone-side buffering. It EXCLUDES camera capture, encode, the radio link, the ground ingest and the browser — it is not a glass-to-glass figure."
                      />
                      <Row
                        label="Samples (1s)"
                        value={
                          latency.airSamples != null
                            ? String(latency.airSamples)
                            : "—"
                        }
                        tooltip="Number of SEI samples read by the drone's local tap in the last second. Roughly equal to the encode framerate when SEI is healthy."
                      />
                    </>
                  )}
                </Section>

                {/* Per-hop receive budget, measured from frame metadata.
                    Placed above the link section because it is the only
                    thing here that splits the receive path; the rows below
                    are single counters, and round-trip time in particular is
                    not a latency term at all. Only mounted while the panel
                    is open, so its per-frame subscription costs nothing on a
                    surface nobody is inspecting. */}
                <MeasuredHops />

                {/* Link */}
                <Section
                  title="Link"
                  subtitle="network + receiver path"
                >
                  <Row
                    label="Round-trip"
                    value={fmtMs(latency.rttMs)}
                    badge="live"
                    tooltip="WebRTC ICE candidate-pair currentRoundTripTime. Same number Chrome shows in chrome://webrtc-internals."
                  />
                  <Row
                    label="RTP jitter"
                    value={fmtMs(latency.rtpJitterMs)}
                    badge="live"
                    tooltip="inbound-rtp.jitter. Variance in packet arrival timing — high values mean the network is delivering frames at uneven cadence."
                  />
                  <Row
                    label="Playout buffer"
                    value={fmtMs(latency.jitterBufferMs)}
                    badge="live"
                    tooltip="Chrome's decoder jitter buffer: how long each frame waits between arriving and being decoded. Grows when the network is jittery; shrinks when the link is smooth."
                  />
                  <Row
                    label="Packets lost"
                    value={String(packetsLost)}
                    badge="live"
                    tooltip="Cumulative RTP packets the receiver detected as lost. Climbing values mean either link quality or FEC budget is insufficient."
                  />
                </Section>

                {/* GCS receive */}
                <Section title="GCS receive" subtitle="browser-side">
                  <Row
                    label="Frames decoded"
                    value={latency.framesDecoded.toLocaleString()}
                    badge="live"
                    tooltip="Total video frames Chrome has decoded since this session started."
                  />
                  <Row
                    label="Frames dropped"
                    value={latency.framesDropped.toLocaleString()}
                    badge="live"
                    tooltip="Frames Chrome decoded but couldn't render in time (compositor pressure, tab in the background)."
                  />
                  {latency.clockOffsetMs !== null && (
                    <Row
                      label="Clock offset"
                      value={
                        latency.clockOffsetUncertaintyMs != null
                          ? `${latency.clockOffsetMs > 0 ? "+" : ""}${Math.round(latency.clockOffsetMs)} ms ± ${Math.round(latency.clockOffsetUncertaintyMs)}`
                          : fmtMs(latency.clockOffsetMs)
                      }
                      tooltip="Estimated drone↔browser wall-clock offset, derived from /api/time round-trips (Cristian's algorithm). Positive means the drone clock is ahead."
                    />
                  )}
                </Section>

                <div className="border-t border-border-default pt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-text-secondary">
                  <Field label="Codec" value={codec || "—"} />
                  <Field label="Bitrate" value={bitrateLabel} />
                  <Field
                    label="Transport"
                    value={transport.toUpperCase().replace("-", " ")}
                  />
                  <Field
                    label="SEI"
                    value={
                      latency.airSource
                        ? latency.airSource === "sei"
                          ? "ENABLED"
                          : latency.airSource.toUpperCase()
                        : "—"
                    }
                  />
                </div>

                <p className="text-[10px] text-text-tertiary leading-relaxed">
                  ⓘ Two independent estimators. True G2G needs the agent to
                  embed SEI timestamps and the browser to support
                  RTCRtpScriptTransform (Chrome 117+); it is the only one that
                  can see the camera→encoder leg. The per-hop budget needs
                  only requestVideoFrameCallback and splits the receive path,
                  so it works where the SEI probe does not. Every row says how
                  its number was obtained; nothing here is modelled.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
