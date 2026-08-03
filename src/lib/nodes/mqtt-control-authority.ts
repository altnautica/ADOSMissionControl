/**
 * Whether this browser may publish flight-controller frames and video
 * signaling offers for a node over the cloud relay's message broker.
 *
 * This is the broker-write half of "can I command this node", and it composes
 * with `describeNodeReach` rather than replacing it. The two answer different
 * lanes and neither subsumes the other:
 *
 *   `describeNodeReach`  the AGENT command lane — service restart, config,
 *                        update. Rides the cloud database or a LAN HTTP call,
 *                        never the broker, so the broker's write policy cannot
 *                        affect it.
 *   this module          the FC FRAME lane — arm, mode, parameter writes,
 *                        mission upload, and the video signaling offer. These
 *                        are broker publishes and nothing else.
 *
 * A surface that reports one as if it were the other will overstate or
 * understate the outage. Compose both; do not pick one.
 *
 * Why this is modelled as a capability rather than an error path: the FC uplink
 * publishes at QoS 0, and the protocol provides no acknowledgement at that
 * quality of service. A broker that refuses the publish returns nothing at all,
 * so there is no error to catch and no failure to render — the frames stop
 * existing while the transport stays open and healthy-looking. A surface built
 * on "show an error when a command fails" cannot work here, because the failure
 * is silent by construction. The only honest question is one the browser can
 * answer before it commands: "do I hold a credential the broker accepts writes
 * from, for this device, right now?" That is a local fact, always known.
 *
 * @module nodes/mqtt-control-authority
 * @license GPL-3.0-only
 */

/**
 * How the browser is currently carrying FC frames. Only the cloud relay routes
 * them through the broker; a direct link carries its own authority and is not
 * this module's business to characterise.
 */
export type ControlLane = "direct" | "cloud-relay";

/** A minted broker-write grant, as the browser holds it. */
export interface ControlGrant {
  /** Devices this grant authorises writes for. */
  readonly deviceIds: readonly string[];
  /** Epoch ms after which the broker will reject this credential. */
  readonly expiresAt: number;
  /**
   * True once a probe has proven the broker accepts our writes. A grant we hold
   * but have never exercised is not yet proof of anything, and the gap between
   * holding a credential and having proven it is exactly what produced the
   * silent outage this module exists to prevent.
   */
  readonly writeConfirmed: boolean;
  /** Set when a renewal attempt has failed and the grant is running out. */
  readonly renewalFailed?: boolean;
}

/** State of one capability, from the operator's point of view. */
export type CapabilityState =
  /** Usable, and proven usable. */
  | "available"
  /** A grant is held but unproven. Usable, honestly hedged. */
  | "unconfirmed"
  /** Being obtained. Not usable yet, and must never read as ready. */
  | "provisioning"
  /** Usable right now, but lapsing, and renewal has failed. */
  | "expiring"
  /** Not usable. Structural, not a transient fault. */
  | "unavailable";

/**
 * Machine-readable cause. UI copy and tests key off this, never off prose.
 * These names double as i18n key suffixes, matching how the nodes board renders
 * `NodeCommandBlockedReason`.
 */
export type MqttAuthorityReason =
  | "direct-link"
  | "no-grant"
  | "provisioning"
  | "grant-expired"
  | "grant-expiring"
  | "grant-unconfirmed"
  | "grant-active";

export interface MqttControlAuthority {
  /** Publishing FC frames: arm, mode, parameter writes, mission upload. */
  readonly fcFrames: CapabilityState;
  /** Publishing the offer that starts a cloud peer-to-peer video stream. */
  readonly videoSignaling: CapabilityState;
  readonly reason: MqttAuthorityReason;
  /** When the held grant lapses, if one is held. */
  readonly expiresAt: number | null;
}

export interface MqttAuthorityInput {
  readonly lane: ControlLane;
  readonly deviceId: string;
  /** The grant currently held, if any. */
  readonly grant?: ControlGrant | null;
  /** True while a mint or renewal is in flight and no usable grant is held. */
  readonly minting?: boolean;
  readonly now: number;
}

/**
 * How long before expiry the surface starts warning. The operator should learn
 * that control is ending while they still have it, rather than by a command
 * failing to land, so this fires well ahead of the lapse.
 */
export const EXPIRY_WARNING_MS = 5 * 60 * 1000;

/**
 * Resolve what this browser may publish for `deviceId`. Pure — no clock, no
 * network, no store reads — so every boundary case is reproducible in a test.
 */
export function resolveMqttControlAuthority(
  input: MqttAuthorityInput,
): MqttControlAuthority {
  const { lane, deviceId, grant, minting, now } = input;

  // A direct link does not route FC frames through the broker, so the broker's
  // write policy is irrelevant here. Reporting anything would be inventing a
  // limit that does not exist.
  if (lane === "direct") {
    return {
      fcFrames: "available",
      videoSignaling: "available",
      reason: "direct-link",
      expiresAt: null,
    };
  }

  // A grant for a DIFFERENT device is not a grant for this one. Accepting a
  // near-enough match is the assumption this module exists to refuse.
  const held = grant && grant.deviceIds.includes(deviceId) ? grant : null;

  if (!held) {
    return {
      fcFrames: minting ? "provisioning" : "unavailable",
      videoSignaling: minting ? "provisioning" : "unavailable",
      reason: minting ? "provisioning" : "no-grant",
      expiresAt: null,
    };
  }

  // Expired. Not "probably still fine for a moment" — the broker's clock is the
  // one that decides and we cannot see it, so the boundary is treated as hard.
  if (held.expiresAt <= now) {
    return {
      fcFrames: minting ? "provisioning" : "unavailable",
      videoSignaling: minting ? "provisioning" : "unavailable",
      reason: minting ? "provisioning" : "grant-expired",
      expiresAt: held.expiresAt,
    };
  }

  // Held and unexpired, but renewal has failed and the lapse is in sight. Warn
  // now, while the operator still has control and can act on it.
  if (held.renewalFailed === true && held.expiresAt - now <= EXPIRY_WARNING_MS) {
    return {
      fcFrames: "expiring",
      videoSignaling: "expiring",
      reason: "grant-expiring",
      expiresAt: held.expiresAt,
    };
  }

  // Held and unexpired, but never exercised — usable, and said so honestly.
  if (!held.writeConfirmed) {
    return {
      fcFrames: "unconfirmed",
      videoSignaling: "unconfirmed",
      reason: "grant-unconfirmed",
      expiresAt: held.expiresAt,
    };
  }

  return {
    fcFrames: "available",
    videoSignaling: "available",
    reason: "grant-active",
    expiresAt: held.expiresAt,
  };
}

/**
 * True when this browser may issue flight-affecting commands over the broker.
 * The command layer gates on this rather than on transport liveness, because a
 * connected transport that cannot publish is precisely the state that looked
 * healthy while dropping every frame.
 */
export function canPublishFcFrames(authority: MqttControlAuthority): boolean {
  return (
    authority.fcFrames === "available" ||
    authority.fcFrames === "unconfirmed" ||
    authority.fcFrames === "expiring"
  );
}

/**
 * True when the surface should tell the operator, unprompted, that their
 * ability to command is limited or ending.
 */
export function needsOperatorAttention(
  authority: MqttControlAuthority,
): boolean {
  return (
    authority.fcFrames === "unavailable" ||
    authority.fcFrames === "expiring" ||
    authority.fcFrames === "provisioning"
  );
}
