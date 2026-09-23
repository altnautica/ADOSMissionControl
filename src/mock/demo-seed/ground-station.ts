/**
 * @module mock/demo-seed/ground-station
 * @description Seeds every ground-station store slice the node-detail tabs read in demo mode.
 * @license GPL-3.0-only
 */

import { useGroundStationStore } from "@/stores/ground-station-store";

/** Seed every ground-station store slice the node-detail GS tabs read — the
 * Overview cards (link health, uplink, paired drone, mesh role/health) plus the
 * Radio / Network / Mesh / Distributed-RX / Display / Physical-UI / Peripherals
 * tables. In demo the GS REST client is null (groundStationApiFromAgent), so the
 * tabs' load-on-mount polls no-op and this seeded data renders untouched. */
export function seedGroundStationStore(): void {
  useGroundStationStore.setState({
    status: {
      paired_drone: "alpha-1",
      profile: "ground_station",
      uplink_active: "ethernet",
    },
    statusFetchedAt: Date.now(),
    linkHealth: {
      rssi_dbm: -58,
      bitrate_mbps: 18.5,
      fec_rec: 1240,
      fec_lost: 9,
      channel: 149,
    },
    // WiFi access point + full uplink matrix (WiFi client / Ethernet / 4G) for
    // the Network tab's per-uplink sections.
    ap: {
      enabled: true,
      ssid: "ADOS-GS-AP",
      passphrase: "altnautica",
      channel: 6,
      connected_clients: 1,
    },
    network: {
      ap: {
        enabled: true,
        ssid: "ADOS-GS-AP",
        passphrase: "altnautica",
        channel: 6,
        connected_clients: 1,
      },
      wifi_client: {
        available: true,
        connected: false,
        ssid: null,
        rssi_dbm: null,
        ip: null,
      },
      ethernet: {
        available: true,
        link: true,
        speed_mbps: 1000,
        ip: "192.168.1.60",
        gateway: "192.168.1.1",
        iface: "eth0",
      },
      modem_4g: {
        enabled: false,
        apn: "internet",
        cap_mb: null,
        connected: null,
        iface: null,
        ip: null,
        signal_quality: null,
        technology: null,
        operator: null,
        state: null,
        data_used_mb: null,
        percent: null,
      },
      active_uplink: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      share_uplink: false,
    },
    modem: {
      enabled: false,
      apn: "internet",
      cap_mb: null,
      connected: null,
      iface: null,
      ip: null,
      signal_quality: null,
      technology: null,
      operator: null,
      state: null,
      data_used_mb: null,
      percent: null,
    },
    ethernetConfig: { mode: "dhcp" },
    uplink: {
      active: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      health: "ok",
      failover_log: [],
      data_cap: null,
      cloud_relay: {
        mqtt_connected: true,
        throttle_state: "ok",
        forwarding_video: true,
        forwarding_telemetry: true,
      },
      shareUplinkApplied: null,
      shareUplinkAppliedReason: null,
      loading: false,
      error: null,
      fetchedAt: Date.now(),
    },
    role: {
      info: {
        current: "relay",
        configured: "relay",
        supported: ["direct", "relay", "receiver"],
        mesh_capable: true,
      },
      loading: false,
      switching: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // batman-adv mesh: neighbors, routes, and the elected cloud gateway for the
    // Mesh tab's neighbor / gateway tables + health card.
    mesh: {
      health: {
        up: true,
        peer_count: 2,
        selected_gateway: "aa:bb:cc:00:11:01",
        partition: false,
        mesh_id: "ados-mesh-01",
      },
      neighbors: [
        { mac: "aa:bb:cc:00:11:02", iface: "bat0", tq: 244, last_seen_ms: 320 },
        { mac: "aa:bb:cc:00:11:03", iface: "bat0", tq: 198, last_seen_ms: 640 },
      ],
      routes: [
        { dest: "aa:bb:cc:00:11:02", via: null, metric: 244 },
        { dest: "aa:bb:cc:00:11:03", via: "aa:bb:cc:00:11:02", metric: 210 },
      ],
      gateways: [
        {
          mac: "aa:bb:cc:00:11:01",
          class_up_kbps: 20000,
          class_down_kbps: 100000,
          tq: 255,
          selected: true,
        },
        {
          mac: "aa:bb:cc:00:11:02",
          class_up_kbps: 8000,
          class_down_kbps: 40000,
          tq: 220,
          selected: false,
        },
      ],
      selectedGateway: "aa:bb:cc:00:11:01",
      lastTransientEvent: null,
      wsState: "connected",
      wsDisconnectedAt: null,
      loading: false,
      error: null,
      fetchedAt: Date.now(),
    },
    // Distributed-RX relay forwarder state (this node is a relay) for the
    // Distributed RX tab.
    distributedRx: {
      receiverRelays: [],
      combined: null,
      relayStatus: {
        role: "relay",
        drone_iface: "wlan1",
        receiver_ip: "10.0.0.2",
        receiver_port: 5800,
        receiver_last_seen_ms: 240,
        fragments_seen: 148230,
        fragments_forwarded: 148102,
        up: true,
        mesh_iface: "bat0",
        stale: false,
      },
      pairingWindowOpen: false,
      pairingWindowExpiresAt: null,
      pairingCode: null,
      pendingRequests: [],
      loading: false,
      error: null,
    },
    // Physical UI (OLED brightness + button bindings + screen order) for the
    // Physical UI tab, plus a paired gamepad for its Bluetooth section.
    ui: {
      oled: { brightness: 180, auto_dim_enabled: true, screen_cycle_seconds: 10 },
      buttons: {
        button_a: { short_press: "next_screen", long_press: "toggle_backlight" },
        button_b: { short_press: "prev_screen", long_press: "open_pair_window" },
        button_c: { short_press: "cycle_uplink" },
        button_d: { short_press: "mute_alerts", long_press: "reboot" },
      },
      screens: {
        order: ["link", "uplink", "mesh", "pair"],
        enabled: ["link", "uplink", "mesh", "pair"],
      },
    },
    bluetooth: {
      scanning: false,
      scan_results: [],
      paired: [
        {
          mac: "44:55:66:77:88:99",
          name: "Wireless Gamepad",
          rssi_dbm: -52,
          paired: true,
          connected: true,
        },
      ],
      // Demo has no ground-station REST client, so the list belongs to no node URL.
      pairedFor: null,
      pairing_mac: null,
      error: null,
    },
    // Local HDMI/LCD display config for the Display tab.
    display: { resolution: "480x320", kiosk_enabled: false },
    // Attached peripherals for the Peripherals tab.
    peripherals: {
      list: [
        {
          id: "oled-0",
          display_name: "OLED 128x64 (SSD1306)",
          transport: "serial",
          connected: true,
          capabilities: ["display"],
        },
        {
          id: "gamepad-0",
          display_name: "USB Gamepad",
          transport: "usb",
          connected: true,
          capabilities: ["joystick", "buttons"],
        },
        {
          id: "gnss-0",
          display_name: "u-blox GNSS Receiver",
          transport: "usb",
          connected: true,
          capabilities: ["gnss"],
        },
      ],
      detail: {},
      loading: false,
      error: null,
    },
  });
}
