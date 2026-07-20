//! Host networking facts — the LAN IP the deploy defaults its reach address to.

use std::net::UdpSocket;

/// The machine's primary LAN IPv4, detected cross-platform via the outbound-route
/// trick: bind a UDP socket and "connect" it to a public address (no packets are
/// sent) so the OS picks the source interface, then read the local address. This
/// is the address browsers + drones on the same network reach the stack at.
/// Returns `None` when only loopback is available (offline).
pub fn detect_lan_ip() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    // 192.0.2.1 is TEST-NET-1 (RFC 5737) — never routed, just picks the iface.
    sock.connect("192.0.2.1:80").ok()?;
    let ip = sock.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        None
    } else {
        Some(ip.to_string())
    }
}

/// The default reach address: an explicit override, else the detected LAN IP,
/// else loopback.
pub fn default_host(explicit: Option<&str>) -> String {
    explicit
        .map(str::to_string)
        .or_else(detect_lan_ip)
        .unwrap_or_else(|| "127.0.0.1".to_string())
}
