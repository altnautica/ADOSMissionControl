//! Lightweight preflight probes (Docker, ports, Node).

use crate::exec;

/// Whether a TCP port is free to bind on localhost (so a service can take it).
pub fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Whether Node.js is present (needed for `npx convex` + `node` scripts).
/// Uses the Node-aware spawn so the probe works on Windows too.
pub fn node_present() -> bool {
    exec::node_run_ok("node", &["--version"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_free_ephemeral_port_reports_free() {
        // Bind, learn the port, drop, then it should read free.
        let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        assert!(port_free(port));
    }
}
