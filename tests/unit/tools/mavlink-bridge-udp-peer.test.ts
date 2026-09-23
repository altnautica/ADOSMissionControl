// @vitest-environment node
/**
 * UDP listen-mode peer policy shared by the mavlink-bridge relay and the
 * desktop app: drop non-local sources, learn the send peer once from the
 * first local MAVLink frame, and never re-learn it from a later sender.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach } from "vitest";
import dgram from "node:dgram";
import net from "node:net";
import { once } from "node:events";
import WebSocket from "ws";
import { UdpWsBridge } from "../../../tools/mavlink-bridge/src/udp-ws";
import {
  UdpPeerTracker,
  isLocalEndpoint,
} from "../../../tools/mavlink-bridge/src/udp-peer";

/** A structurally complete MAVLink v2 HEARTBEAT (9-byte payload). */
function mavlinkFrame(sysid: number): Buffer {
  const frame = Buffer.alloc(21);
  frame[0] = 0xfd;
  frame[1] = 9;
  frame[5] = sysid;
  frame[6] = 1;
  return frame;
}

describe("UdpPeerTracker", () => {
  it("drops a non-local source without letting it become the peer", () => {
    const peers = new UdpPeerTracker();
    expect(peers.observe("203.0.113.9", 14550, mavlinkFrame(1))).toBe("drop");
    expect(peers.peer).toBeNull();
    expect(peers.observe("192.168.1.50", 14550, mavlinkFrame(1))).toBe("learned");
    expect(peers.peer).toEqual({ host: "192.168.1.50", port: 14550 });
  });

  it("learns once and relays a later sender without re-learning", () => {
    const peers = new UdpPeerTracker();
    expect(peers.observe("192.168.1.50", 14550, Buffer.from([1, 2, 3]))).toBe("relay");
    expect(peers.peer).toBeNull();
    expect(peers.observe("192.168.1.50", 14550, mavlinkFrame(1))).toBe("learned");
    expect(peers.observe("192.168.1.51", 14555, mavlinkFrame(1))).toBe("relay");
    expect(peers.peer).toEqual({ host: "192.168.1.50", port: 14550 });
  });

  it("never replaces a fixed target peer", () => {
    const peers = new UdpPeerTracker({ host: "127.0.0.1", port: 14550 });
    expect(peers.observe("127.0.0.1", 40000, mavlinkFrame(1))).toBe("relay");
    expect(peers.peer).toEqual({ host: "127.0.0.1", port: 14550 });
  });
});

describe("isLocalEndpoint", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.31.0.1", true],
    ["172.32.0.1", false],
    ["100.64.0.1", true],
    ["100.128.0.1", false],
    ["8.8.8.8", false],
    ["10.attacker.example", false],
    ["::1", true],
    ["fe80::1", true],
    ["fd00::1", true],
    ["2001:db8::1", false],
    ["::ffff:192.168.1.50", true],
    ["::ffff:8.8.8.8", false],
  ])("%s -> %s", (host, local) => {
    expect(isLocalEndpoint(host)).toBe(local);
  });
});

async function freeUdpPort(): Promise<number> {
  const s = dgram.createSocket("udp4");
  s.bind(0, "127.0.0.1");
  await once(s, "listening");
  const { port } = s.address();
  s.close();
  return port;
}

async function freeTcpPort(): Promise<number> {
  const srv = net.createServer().listen(0, "127.0.0.1");
  await once(srv, "listening");
  const addr = srv.address();
  srv.close();
  if (!addr || typeof addr === "string") throw new Error("expected an inet address");
  return addr.port;
}

async function boundSocket(): Promise<dgram.Socket> {
  const s = dgram.createSocket("udp4");
  s.bind(0, "127.0.0.1");
  await once(s, "listening");
  return s;
}

describe("UdpWsBridge listen mode", () => {
  const cleanup: (() => void)[] = [];

  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
  });

  it("sends GCS traffic to the first sender, not a later one", async () => {
    const udpPort = await freeUdpPort();
    const wsPort = await freeTcpPort();
    const bridge = new UdpWsBridge({
      wsPort,
      wsHost: "127.0.0.1",
      token: "test-token",
      mode: "listen",
      host: "127.0.0.1",
      port: udpPort,
    });
    bridge.on("error", () => {});
    bridge.start();
    await once(bridge, "connected");
    cleanup.push(() => bridge.shutdown());

    const gcs = new WebSocket(`ws://127.0.0.1:${wsPort}/?token=test-token`);
    cleanup.push(() => gcs.close());
    await once(gcs, "open");
    let relayed = 0;
    gcs.on("message", () => relayed++);

    const vehicle = await boundSocket();
    const attacker = await boundSocket();
    cleanup.push(() => vehicle.close(), () => attacker.close());

    vehicle.send(mavlinkFrame(1), udpPort, "127.0.0.1");
    await once(bridge, "data");
    attacker.send(mavlinkFrame(1), udpPort, "127.0.0.1");
    await once(bridge, "data");
    await expect.poll(() => relayed).toBe(2);

    const winner = Promise.race([
      once(vehicle, "message").then(() => "vehicle"),
      once(attacker, "message").then(() => "attacker"),
    ]);
    gcs.send(Buffer.from([0xfd, 0xaa]));
    expect(await winner).toBe("vehicle");
    expect(bridge.peer?.port).toBe(vehicle.address().port);
  });
});
