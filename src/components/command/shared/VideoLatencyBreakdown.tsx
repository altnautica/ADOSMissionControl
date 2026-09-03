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
import { Info, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useVideoStore } from "@/stores/video-store";
import { Tooltip } from "@/components/ui/tooltip";
import { useVideoLatencyBudget } from "@/hooks/use-video-latency-budget";
import type {
  LatencyHop,
  LatencyProvenance,
} from "@/lib/video/latency-budget";

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
    typeof window !== "undefined" &&
    typeof (window as unknown as { RTCRtpScriptTransform?: unknown })
      .RTCRtpScriptTransform !== "undefined";

  const seiEnabled = latency.airSource === "sei";
  const hasG2G = latency.trueG2GMs !== null;
  // True when the GCS is reaching the drone via cloud relay rather than
  // LAN-direct. The /api/video/latency and /api/time pollers hit the
  // agent's LAN URL, which is unreachable when the browser is on a
  // different network — they fail silently and leave airSource as null.
  // Surface a distinct message so the operator doesn't chase a phantom
  // "SEI is off" hint.
  const cloudTransport =
    transport === "cloud-whep" || transport === "cloud-mse";
  const lanPollUnreachable = latency.airSource === null && cloudTransport;
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
                {/* True glass-to-glass (Phase B) */}
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
                        : lanPollUnreachable
                          ? "Not measured over cloud relay — AIR / G2G metrics need a LAN-direct connection to the agent. Switch transport to LAN to see them."
                          : latency.airSource === "unavailable"
                            ? "Not measured — SEI is off on the agent. Set wfb.sei_latency: true in /etc/ados/config.yaml and restart ados-supervisor."
                            : !seiEnabled
                              ? "Measuring… waiting for the first SEI sample to land."
                              : "Measuring… waiting for the first SEI sample to land."}
                    </Note>
                  )}
                </Section>

                {/* Air side */}
                <Section
                  title="Air side"
                  subtitle="camera → drone LCD tap"
                >
                  {lanPollUnreachable ? (
                    <Note>
                      Unreachable over cloud relay. The agent emits these
                      metrics on its LAN interface; connect to the drone
                      on the same network to see them.
                    </Note>
                  ) : latency.airSource === "unavailable" ? (
                    <Note>
                      SEI is off on the agent. Enable
                      wfb.sei_latency: true in /etc/ados/config.yaml
                      and restart ados-supervisor.
                    </Note>
                  ) : (
                    <>
                      <Row
                        label="SEI EWMA"
                        value={fmtMs(latency.airLatencyMs)}
                        tooltip="Drone-side stamp-to-readback: the time between the encoder emitting a frame (where the SEI timestamp is injected, after encode) and that frame being read back off the drone's own RTSP feed. Covers muxing, the mediamtx publish and the drone-side buffering — not camera capture or encode."
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-text-primary">
          {title}
        </span>
        {subtitle ? (
          <span className="text-[9px] text-text-tertiary">{subtitle}</span>
        ) : null}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

/**
 * How a number was obtained. Every latency row carries one, because a
 * plausible-looking figure an operator cannot trace is worse than no figure:
 * a subtraction of two other rows and a direct timestamp difference look
 * identical on screen and are not equally trustworthy.
 */
type RowBadge = "live" | LatencyProvenance;

const BADGE_LABEL: Record<RowBadge, string> = {
  live: "live",
  measured: "measured",
  "rtcp-synchronised": "rtcp-sync",
  derived: "inferred",
  "ua-estimated": "ua est",
};

/**
 * Green for a number read straight off the clock, amber for anything the
 * browser inferred, predicted, or synchronised its way to.
 */
const BADGE_TONE: Record<RowBadge, string> = {
  live: "text-status-success/70",
  measured: "text-status-success/70",
  "rtcp-synchronised": "text-status-warning/70",
  derived: "text-status-warning/70",
  "ua-estimated": "text-status-warning/70",
};

function Row({
  label,
  value,
  tooltip,
  badge,
}: {
  label: string;
  value: string;
  tooltip: string;
  badge?: RowBadge | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1 text-text-secondary">
        {label}
        <Tooltip content={tooltip} position="top" multiline>
          <Info className="w-3 h-3 text-text-tertiary" />
        </Tooltip>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-text-primary tabular-nums">{value}</span>
        {badge ? (
          <span className={cn("text-[9px] uppercase", BADGE_TONE[badge])}>
            {BADGE_LABEL[badge]}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The per-hop receive budget, measured from `requestVideoFrameCallback`
 * frame metadata.
 *
 * A separate component so the subscription only exists while the panel is
 * open: samples arrive per rendered frame, and the trigger chip is mounted
 * on every video surface whether anyone is reading it or not.
 */
function MeasuredHops() {
  const { budget, jitterTargetMs } = useVideoLatencyBudget();

  if (!budget.hops) {
    return (
      <Section title="Per-hop (measured)" subtitle="receive path">
        <Note>
          Not measured — this needs `requestVideoFrameCallback` with WebRTC
          capture timestamps. Absent on a non-WebRTC source, and on a browser
          that does not implement the callback.
        </Note>
      </Section>
    );
  }

  const { hops } = budget;
  const span = (hop: LatencyHop) =>
    `${hop.p50Ms} / ${hop.p95Ms} ms`;

  return (
    <Section
      title="Per-hop (measured)"
      subtitle={`P50 / P95 over ${budget.samples} frames`}
    >
      <Row
        label="Capture → receive"
        value={span(hops.captureToReceive)}
        badge={hops.captureToReceive.provenance}
        tooltip="Encode plus network, from rVFC captureTime to receiveTime. captureTime for a remote source is the user agent's estimate from RTCP sender reports plus clock synchronisation, so it is real but only as good as that sync — and unusable for the first second of a session. Reference for a healthy LAN with a hardware-encoded publisher: about 180 ms P50 / 240 ms P95 end to end. That is a reference, not a measurement of this link."
      />
      <Row
        label="Receive → present"
        value={span(hops.receiveToPresent)}
        badge={hops.receiveToPresent.provenance}
        tooltip="Jitter buffer plus decode plus composite. Both endpoints are timestamps the user agent reports directly on the performance.now() clock."
      />
      <Row
        label="· decode"
        value={span(hops.decode)}
        badge={hops.decode.provenance}
        tooltip="rVFC processingDuration: the summed decode time for the frame, reported by the decoder."
      />
      <Row
        label="· buffer + composite"
        value={span(hops.bufferAndComposite)}
        badge={hops.bufferAndComposite.provenance}
        tooltip="Receive-to-present minus decode. A subtraction of the two rows above, not an observation — nothing reports this hop directly."
      />
      <Row
        label="Present → display"
        value={span(hops.presentToDisplay)}
        badge={hops.presentToDisplay.provenance}
        tooltip="The v-sync tax, from presentationTime to expectedDisplayTime. expectedDisplayTime is the user agent's PREDICTION of when the frame becomes visible, not a report that it did."
      />
      <Row
        label="End to end"
        value={span(hops.endToEnd)}
        badge={hops.endToEnd.provenance}
        tooltip="Capture to presented frame. Anchored on captureTime, so it carries the same RTCP-synchronisation caveat as the first hop. This is the honest end-to-end figure the receive path achieves; it is not the same quantity as round-trip time, which contains no capture or encode leg at all."
      />
      <Row
        label="Buffer target"
        value={`${jitterTargetMs} ms`}
        badge="live"
        tooltip="What the control loop currently asks the receiver's jitter buffer for, chosen from measured freezes, RTP jitter and loss with a 2 s minimum dwell. It replaced a hardcoded 50 ms that no measurement produced. Zero means either the loop found no reason to add buffer, or this browser implements neither receiver knob — with frames arriving and a non-trivial buffer+composite hop above, it is the browser's own depth and nothing here set it."
      />
      <Note>
        Not measurable from a browser:{" "}
        {budget.unavailable.join(", ")}. The media server&apos;s own queueing
        sits inside the capture→receive hop and cannot be separated from
        encode and network by a receiver; the camera→encoder leg is upstream
        of every timestamp the browser has, which is what the agent&apos;s SEI
        probe above measures.
      </Note>
    </Section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
        {label}
      </span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] text-text-tertiary leading-relaxed">
      {children}
    </div>
  );
}
