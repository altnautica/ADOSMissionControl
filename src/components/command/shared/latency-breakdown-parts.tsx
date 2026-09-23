"use client";

/**
 * @module latency-breakdown-parts
 * @description Row, section and per-hop building blocks for the video
 * latency popover ({@link VideoLatencyBreakdown}).
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import { useVideoLatencyBudget } from "@/hooks/use-video-latency-budget";
import type {
  LatencyHop,
  LatencyProvenance,
} from "@/lib/video/latency-budget";

/** Remediation shown wherever SEI latency is off on the agent. */
export const SEI_OFF_REMEDIATION =
  "Set video.wfb.sei_latency to true (PUT /api/config, or in /etc/ados/config.yaml) and restart ados-video.";

export function Section({
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
export type RowBadge = "live" | LatencyProvenance;

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

export function Row({
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
export function MeasuredHops() {
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

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[10px] uppercase tracking-widest text-text-tertiary">
        {label}
      </span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] text-text-tertiary leading-relaxed">
      {children}
    </div>
  );
}
