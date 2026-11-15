"use client";

/**
 * The command reach of a node enrolled solely through a ground node's WFB
 * relay: its live MAVLink session through the ground station, the ground
 * station's relay-proxy route to its own agent, or the reason neither lane
 * resolves.
 *
 * @module nodes/relayed-command-reach
 * @license GPL-3.0-only
 */

import { noteModeOnSuccess } from "@/lib/skills/flight-facts";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { resolveDirectFcProtocol } from "@/lib/nodes/direct-fc-protocol";
import { relayProxyBaseUrl, resolveRelayReach } from "@/lib/nodes/relay-reach";
import {
  dispatchOverLan,
  makeDirectFcSink,
  makeSink,
  pageOriginIsHttps,
} from "@/lib/nodes/command-lanes";
import type {
  CommandTargetNode,
  NodeCommandReach,
  NodeCommandSinkOptions,
} from "@/lib/nodes/command-sink";

/** Resolve how commands reach a relayed-only `node` (`isRelayed`). */
export function resolveRelayedCommandReach(
  node: CommandTargetNode,
  options: NodeCommandSinkOptions,
): NodeCommandReach {
  // A relayed-only node holds no LAN credentials and no cloud pairing row (it
  // was never paired directly), so the radio is its reach — and the radio
  // carries two lanes, tried in the order of what each can honestly report.
  //
  // First, `RelayedMavlinkBridge`'s live MAVLink session, opened in the
  // background against the ground station's republish endpoint and keyed by
  // this same `node:<deviceId>` id in the drone manager. That is the vehicle's
  // own protocol speaking, so it keeps precedence over any HTTP lane, except
  // for the return (below).
  //
  // Second, the ground station's relay-proxy route, which forwards an HTTP
  // call to this drone's own agent over the aux radio lane and projects the
  // drone's real status back. Same agent command route as the direct LAN
  // lane, one radio hop further out, so it reports the vehicle's own ack.
  const relayedId = nodeIdForDevice(node.deviceId);
  const relay = resolveRelayReach({
    agentDeviceId: null,
    reachedVia: node.reachedVia,
    droneDeviceId: node.deviceId,
  });
  // The ground station is reached at a plain-HTTP LAN address, so an HTTPS
  // page origin blocks this lane as mixed content exactly as it blocks the
  // direct LAN lane — and for exactly the same reason, so it reports that
  // cause. Falling through to "relay-only" here would tell the operator the
  // ground station is unpaired when it is paired and reachable.
  const relayBlocked = relay !== null && (options.originIsHttps ?? pageOriginIsHttps());
  const relaySink =
    relay && !relayBlocked
      ? makeSink("relay-proxy", true, options.agentFirmware, (cmd, args) =>
          dispatchOverLan(
            {
              agentUrl: relayProxyBaseUrl(relay),
              apiKey: relay.apiKey,
              relay: true,
            },
            cmd,
            args,
          ),
        )
      : null;
  const liveFc = resolveDirectFcProtocol(relayedId);
  if (liveFc) {
    const sink = makeDirectFcSink(liveFc, relayedId);
    if (!relaySink) return { sink };
    // The return goes to the drone's agent while its route is up: in `ados`
    // control the agent hands `rtl` to its pilot, which flies back along the
    // flown path, where the flight controller's own RTL flies straight home.
    return {
      sink: {
        ...sink,
        returnToLaunch: () => noteModeOnSuccess(relayedId, "RTL", relaySink.returnToLaunch()),
      },
    };
  }
  if (relayBlocked) return { sink: null, blockedReason: "lan-blocked-by-https" };
  if (relaySink) return { sink: relaySink };

  // No lane at all: the radio is up, but this browser has not paired the
  // ground station that owns its near end.
  return { sink: null, blockedReason: "relay-only" };
}
