// @generated from tools/mavlink-bridge/src/udp-peer.ts by scripts/sync-bridge-shared.mjs. Do not edit by hand.
// udp-peer.ts — local-endpoint classifier and UDP listen-mode peer policy
// SPDX-License-Identifier: GPL-3.0-only
//
// Shared by the mavlink-bridge UDP relay and the desktop app's native UDP
// socket. Pure: no imports, so the same text compiles under both packages'
// module settings.

/** Parse a dotted-quad IPv4 literal, or null when it is not one. */
function parseIpv4(input: string): number[] | null {
  const m = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  return octets.some((n) => n > 255) ? null : octets;
}

/** Parse an IPv6 literal (zone id and embedded IPv4 allowed) into eight groups. */
function parseIpv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s) return null;

  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4 && v4.index !== undefined) {
    const o = v4.slice(1, 5).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${s.slice(0, v4.index)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }

  const groups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const halves = s.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 2) {
    const head = groups(halves[0]);
    const tail = groups(halves[1]);
    if (head === null || tail === null) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    return [...head, ...new Array<number>(fill).fill(0), ...tail];
  }
  const all = groups(s);
  return all && all.length === 8 ? all : null;
}

/**
 * Loopback, RFC 1918 private, link-local and carrier-grade NAT (100.64.0.0/10,
 * the range overlay VPNs such as Tailscale hand out).
 */
function isLocalIpv4(o: number[]): boolean {
  const [a, b] = o;
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Whether `host` is a loopback / private / link-local endpoint.
 *
 * Accepts the unspecified bind addresses (`0.0.0.0`, `::`), `localhost` and
 * mDNS `.local` names, IPv4 literals in the local ranges, and IPv6 loopback,
 * unique-local (fc00::/7), link-local (fe80::/10) and IPv4-mapped local
 * addresses. Literals are parsed, never prefix-matched, so a hostname that
 * merely starts with a private label is not local.
 */
export function isLocalEndpoint(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === '' || h === '0.0.0.0' || h === '::' || h === 'localhost') return true;
  if (h.endsWith('.local')) return true;

  const v4 = parseIpv4(h);
  if (v4) return isLocalIpv4(v4);

  if (!h.includes(':')) return false;
  const v6 = parseIpv6(h);
  if (!v6) return false;
  if (v6.every((g, i) => g === (i === 7 ? 1 : 0))) return true; // ::1
  const first = v6[0];
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10
  // ::ffff:a.b.c.d — an IPv4 source seen through a dual-stack socket.
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    return isLocalIpv4([v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff]);
  }
  return false;
}

const MAVLINK_V1_MAGIC = 0xfe;
const MAVLINK_V2_MAGIC = 0xfd;
const MAVLINK_V2_SIGNED = 0x01;

/**
 * Whether `data` begins with a complete MAVLink v1 or v2 frame: the start
 * byte, and at least as many bytes as the header's payload length (plus the
 * v2 signature when the incompat flag says one follows) requires.
 */
export function isMavlinkFrame(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  const len = data[1];
  if (data[0] === MAVLINK_V1_MAGIC) return data.length >= 8 + len;
  if (data[0] !== MAVLINK_V2_MAGIC || data.length < 3) return false;
  const signature = data[2] & MAVLINK_V2_SIGNED ? 13 : 0;
  return data.length >= 12 + len + signature;
}

export interface UdpPeer {
  host: string;
  port: number;
}

/** What to do with one inbound datagram. */
export type UdpVerdict =
  /** Source is outside the local endpoint space: do not relay it. */
  | 'drop'
  /** Relay it; this datagram set the send peer. */
  | 'learned'
  /** Relay it; the send peer is unchanged. */
  | 'relay';

/**
 * The send peer of a UDP link.
 *
 * Target mode starts with a fixed peer that never changes. Listen mode learns
 * the peer exactly once, from the first datagram that comes from a local
 * source AND carries a MAVLink frame, and keeps it for the life of the socket:
 * a later sender, spoofed or not, can never redirect GCS-to-vehicle traffic.
 */
export class UdpPeerTracker {
  private current: UdpPeer | null;

  constructor(fixedPeer: UdpPeer | null = null) {
    this.current = fixedPeer ? { host: fixedPeer.host, port: fixedPeer.port } : null;
  }

  /** Where GCS-to-vehicle bytes go, or null before a peer is known. */
  get peer(): UdpPeer | null {
    return this.current;
  }

  observe(host: string, port: number, datagram: Uint8Array): UdpVerdict {
    if (!isLocalEndpoint(host)) return 'drop';
    if (this.current === null && isMavlinkFrame(datagram)) {
      this.current = { host, port };
      return 'learned';
    }
    return 'relay';
  }
}
