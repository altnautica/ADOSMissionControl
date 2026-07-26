# Changelog

All notable changes to ADOS Mission Control are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
the project follows [Semantic Versioning](https://semver.org/).

## [0.57.2] - 2026-07-26

A second follow-up patch, released the same day as 0.57.1. Everything below
is otherwise unchanged from 0.57.1, repeated here so an update from before
that release carries the full picture.

### Added

- **Four-firmware flight controller configuration.** ArduPilot, PX4, Betaflight
  and iNav each gain deep configuration surfaces. ArduPilot adds rover steering
  and speed tuning, an EKF3 estimator panel, telemetry stream rates, QuadPlane
  and VTOL, plane energy and navigation tuning, ArduSub, traditional
  helicopter, non-GPS positioning, multi-instance rangefinders, airspeed,
  harmonic notch, sailboat, gripper and ADS-B. PX4 adds flight behavior,
  fixed-wing tuning, autotune for multicopter and fixed wing, VTOL transition,
  GPS, control allocation, live actuator test and thermal calibration.
  Betaflight adds serial ports, OSD with font upload, LED strip with a 16-colour
  palette and mode-colour editor, receiver configuration, DShot special
  commands, blackbox download and a CLI terminal with live output. iNav adds
  per-index logic conditions, live global variables, OSD font upload and
  editable landing datums.
- **Parameter metadata registry with bitmask and enum editors.** Parameter
  metadata now ships bundled with the app, so full names, ranges, units,
  defaults and per-bit flag descriptions are available offline for every
  firmware rather than only when an external site is reachable. A Set Bitmask
  modal gives you labelled per-bit checkboxes with search, raw decimal and hex,
  and preservation of bits it does not recognise, so an undocumented flag is
  never silently cleared. Enum parameters get a real dropdown. An Options column
  shows the decoded value at a glance, and the write confirmation shows the flag
  difference before you commit.
- **A hosted parameter registry overlay.** On top of the bundled floor, the app
  can pull versioned metadata snapshots so parameter help matches the firmware
  version actually on the board. iNav gains its full named-settings registry of
  677 settings.
- **A JavaScript expression compiler for iNav logic conditions.** Write a plain
  expression and it compiles down to the underlying logic-condition slots
  instead of hand-assembling them one row at a time.
- **Onboard Lua scripting for ArduPilot.** A Scripts section under Setup manages
  the scripts on the board over MAVLink file transfer, with upload by drag and
  drop, download, delete, engine configuration and a filtered script console.
  A starter catalog of first-party applets is one click to install.
- **MAVLink file transfer, structured events and native sockets.** The file
  transfer client now writes, lists and removes as well as reads, and is
  hardened against a lossy or hostile server. PX4 structured events (message
  410) decode into a readable feed backed by the vehicle's own event metadata,
  so prearm, mode and failsafe messages are finally visible. Parameter metadata
  can be served by the flight controller itself. The desktop app connects over
  native UDP and TCP in addition to serial.
- **Mission planning, rebuilt.** The Plan tab gains a survey solver that works
  backwards from the ground sample distance you want to an altitude and a
  motion-blur-safe speed, wind-optimised line orientation, fixed-wing turnaround
  geometry, keep-out polygon skipping, a coverage footprint overlay, a quick
  builder from the map bounds, and a change-detection resurvey planner. Landing
  patterns cover fixed wing and VTOL.
- **A per-waypoint action timeline.** Actions attach to the waypoint they belong
  to, edited inline with reordering and a jump-target picker, and flatten and
  re-nest correctly across upload, download, export and import. The command
  palette filters to what your firmware actually supports.
- **Mission checks before you fly.** Upload is blocked while validation errors
  stand. Inclusion and exclusion zones, rally points and terrain clearance are
  enforced, with a soft-buffer warning short of a hard breach. Terrain conflicts
  are flagged along each leg and on the return-to-launch leg. There is an
  advisory item-count check against the flight controller, a keyless airport
  proximity gate, a flight energy model, sun times with a golden-hour card and a
  pre-flight checklist.
- **Weather, import, export and sharing in the planner.** A keyless go/no-go
  weather card, boundary import from KML, KMZ and shapefiles, GeoTIFF orthophoto
  overlay, a flight-brief PDF export, a built-in mission template library, plan
  folders, points of interest, and shareable plan links that encode the plan in
  the URL fragment so nothing leaves your machine.
- **A copilot for mission intent.** Describe what you want in plain words and a
  deterministic parser sets up the matching pattern. No key and no external
  service.
- **Coordinates and units throughout.** Live cursor coordinate and elevation
  readout, a display-format preference across decimal degrees, degrees minutes
  seconds, UTM and MGRS, forward geocoding search on the map, and one shared
  units formatter behind the stats bar, pattern stats and altitude profile.
- **The Cockpit.** The old Fly Mode is now the Cockpit, split into a Flight tab
  and an immersive Cockpit tab. Flight behaviors are skills bound to hotkeys and
  gamepad buttons on a shared skill bar, contributed by built-in commands and
  extensions through the same registry. Widgets are arrangeable by zone and
  persist with your loadout, information density is a per-loadout setting, and a
  command palette on Ctrl or Cmd plus K searches and runs any drone command
  through the same pipeline. The safety band showing arm state, battery, GPS and
  link never hides.
- **Target designation in the Cockpit.** Click a detection to designate it. A
  what-is-locked chip names the current target, an aim-ahead lead reticle tracks
  a moving one, and extensions contribute their own target actions into the
  click popup with their own hotkeys. Detection boxes ease between batches so
  they follow motion instead of stepping.
- **Multi-camera video with picture-in-picture.** A node exposing more than one
  camera gets stream tabs at the top left, switched by the number keys or by
  cycling. A second stream can be pinned as a picture-in-picture inset whose
  position persists per loadout. Concurrent streams flip instantly by
  re-pointing at each leg's own address, switching is debounced so a rapid flip
  cannot stack encoder restarts, and a dead leg is disabled rather than shown
  as live.
- **Camera roster management.** A Cameras surface on the node detail reads the
  roster from the agent and round-trips per-leg bitrate and calibration.
- **A Nodes fleet board.** A third dashboard view mode renders a dense live
  table ordered live, then stale, then offline. Each row carries reach, link,
  battery, mode and role, with per-row controls that act on that node over the
  LAN or the cloud queue. Rows support selection, bulk apply-one-change and
  search, and flight controls are gated on the same liveness the board shows.
- **A unified per-profile node console.** One console adapts to the node in
  front of you across drone, flight controller, ground station and workstation,
  with a profile-aware hero header, sidebar and overview. The agent dashboard is
  folded into Overview, the last tab you used is restored per node, and a
  per-node feature framework lets you opt a drone into World Model capture.
- **A node Settings tab with thirteen configuration pages.** Network uplink,
  Wi-Fi scan and join, cellular APN, MAC pinning and adapter stability,
  self-heal and link guardian, MAVLink routing, security, vision and
  perception, world model, discovery and reach names, video and cameras, and
  cloud, organised behind two-tier grouped navigation and reachable over the
  LAN or the cloud.
  Security downgrades and link-affecting toggles ask for confirmation first.
- **Relayed enrollment and a live mesh map.** A drone linked to a paired ground
  node over the radio enrolls as its own node, nested under the ground node that
  carries it, with per-bearer reach provenance rather than a bare label. A live
  node-to-node mesh and reach map names each relay funnel.
- **Extensions.** What were called plugins are now Extensions, on a contribution
  platform. One manifest block contributes tabs, settings sections, parameters,
  models, mission templates, map overlays, skills, target actions and tools, all
  resolved through one registry so a built-in surface and an extension surface
  are the same shape. Parameters are described by JSON Schema and rendered
  natively. Install works from the registry, from a URL pinned to the bytes the
  agent reviewed, and local-first from a paired agent over the LAN with no cloud
  round trip. The install dialog was rebuilt around trust signals, capability
  chips and a contributions summary.
- **An MCP tab.** Connect an AI client to your fleet through the Model Context
  Protocol. A guided local-first setup wizard takes you from nothing to a
  connected client in five steps with a live connection check, including a
  one-command option that covers every drone on your LAN with no file and no
  login. Machine credentials are scoped by capability and by node with an
  expiry, and there is a searchable tool catalog, an audit log and a live panel
  that shows calls as they happen.
- **Perception.** The Vision tab is now Perception, grouped into engine,
  execution, feed health, inputs and models. A drone without an accelerator can
  offload detection to a paired workstation, configured per node, with the tier
  and target surfaced honestly in the Cockpit beside streaming-session health.
  Detections carry lock state and association confidence, are keyed by model and
  camera stream, and reach the app over the cloud relay as well as the LAN.
- **ADOS Workstation.** The compute profile is now the Workstation, with a
  branded dashboard showing real GPU, CPU, memory and disk with live GPU
  utilisation, and it is enabled by default rather than behind a flag.
- **Atlas world model.** Capture 3D reconstructions from a drone and view them
  as gaussian splats or point clouds, with a live-updating Live World tab, a
  dedicated splat viewer with download progress, detail-level presets carrying a
  gaussian budget, and a Forge workbench for the reconstruction queue.
- **ADOS Stack Deployer.** A Rust terminal UI is now the supported way to
  self-host the whole stack. It plans and runs a turnkey deploy, then manages
  the running stack with status, logs, restart, upgrade and teardown, detects
  your LAN address for the default reach, flags an already-bound port inline,
  and recovers its configuration from an existing environment file on a re-run.
- **Simulation.** Sky rendering that follows the map mode, quality presets, a
  top-centre warning banner clear of the playback bar, an actual-flight-path
  overlay, rounded-turn previews and playback driven through a sampled track
  source.
- **Radio link diagnosis.** The radio surfaces packets seen and decrypt-error
  counters, prefers the radio's own transmit-proof verdict over an inferred one,
  and names a transmitting-but-unproven link as its own state instead of reading
  it as fully down. Adapter USB and injection health resolve into one reading.
  Phantom-pairing and stale-key bind failures are named for what they are.
- **A ground-station HDMI cockpit and touch calibration**, on the Display tab.
- **An RC and ELRS control-lane tab.** The control-lane snapshot flows into the
  per-node store from both the LAN and the cloud, carrying transmit power and
  the command-down gate.
- **Per-node dashboard access PIN management**, so you can set, reset and check
  the PIN that guards a node's own web dashboard from the fleet view.
- **Native UDP and TCP MAVLink in the desktop app**, with a helper that bridges
  either to a WebSocket for the browser build.

### Changed

- **Extensions replaced plugins in all user-facing copy**, across all sixteen
  locales. The packaging format, the SDK and the CLI keep their existing names.
- **The standalone full-screen flight route is retired.** The immersive view is
  now the Cockpit tab in place, with unified flight-recording control.
- **The minimap is a clean auto-follow map.** Overlays were stripped, the
  basemap selector collapsed behind an icon, the map enlarged, and clicking it
  opens the Flight tab.
- **Elevation reports as unavailable instead of a fabricated zero**, and MSL
  placement now applies EGM96 geoid separation.
- **Demo mode covers the whole platform.** A mixed-firmware fleet, five world
  tour missions in the plan library, a direct-connect USB flight controller, a
  ground station with its node tabs and control lane, relayed enrollment, per
  stream video and a mock node configuration surface.
- **Self-hosting documentation now points at the deployer** rather than the
  removed command-line tool.

### Fixed

- **A failed parameter write surfaces instead of passing silently**, because
  error frames now reject rather than resolve.
- **Live telemetry is no longer faked from stale values.** Zeros are gated on
  freshness, an unreachable configured source is surfaced, and a stale radio
  signal is dimmed rather than shown as current.
- **A queued cloud command reports the vehicle's real answer**, and a rejected
  command spends nothing.
- **Commands and settings act on the node you are looking at.** A settings draft
  resets when you switch nodes, the radio panel keys to its own node, and a
  section that was showing another node's channels was removed.
- **A filtered-out relay funnel no longer implies a radio link to the app.**
- **Return-to-launch and Land are disabled on a node whose firmware has no
  autonomous navigation**, rather than offered and silently ignored.
- **A host that merely starts with a private address prefix is rejected**, and
  an incomplete address literal no longer passes the private-host guard.
- **The MAVLink WebSocket proxy is ticket-authenticated**, and the app prefers
  the authenticated endpoint where the agent offers one.
- **Dropdown menus and popovers render above their scroll containers** instead
  of being clipped, and they implement the keyboard contract their roles claim.
- **Unpairing removes the node everywhere**, including the cloud row.
- **Reachability failures explain themselves** instead of returning a bare
  gateway error.
- **A drone reached only through a ground station's radio relay now gets a
  live flight-controller link.** Its Setup and Parameters tabs previously
  showed the agent as offline with no heartbeat, contradicting the node's own
  online status in the sidebar. The app now opens the same MAVLink session the
  ground station's relay already carries, so real parameters, telemetry and
  commands work over the radio, not just video.
- **The parameter download progress bar no longer reads past 100%.** It was
  counting every received value frame rather than every unique parameter, so a
  retried or retransmitted frame over a lossy link double-counted and pushed
  the count past the real total. Downloads on a lossy link also converge more
  patiently now: a second request for an already-downloading board shares that
  download instead of quietly abandoning it, and a stalled retry only gives up
  once it truly stops making progress rather than after a fixed number of
  rounds.

### Removed

- **The Node self-hosting command-line tool**, superseded by the deployer.
- **The top-level extension risk badge.** The per-capability sensitive tag
  stays, which is the signal that tells you what an extension can actually
  reach.
- **Unmounted contribution slots** that had no host to render them, and the
  registry browse pages that were not yet backed by a live service.

### Notes

- Pairs with ADOS Drone Agent 0.99.241.
- Versions 0.35.0 through 0.56.0 shipped continuously and are covered here
  rather than as separate entries.

## [0.57.1] - 2026-07-26

A follow-up patch to 0.57.0, closing a gap that surfaced immediately after
that release. Everything below is otherwise unchanged from 0.57.0, repeated
here so an update from before that release carries the full picture.

### Added

- **Four-firmware flight controller configuration.** ArduPilot, PX4, Betaflight
  and iNav each gain deep configuration surfaces. ArduPilot adds rover steering
  and speed tuning, an EKF3 estimator panel, telemetry stream rates, QuadPlane
  and VTOL, plane energy and navigation tuning, ArduSub, traditional
  helicopter, non-GPS positioning, multi-instance rangefinders, airspeed,
  harmonic notch, sailboat, gripper and ADS-B. PX4 adds flight behavior,
  fixed-wing tuning, autotune for multicopter and fixed wing, VTOL transition,
  GPS, control allocation, live actuator test and thermal calibration.
  Betaflight adds serial ports, OSD with font upload, LED strip with a 16-colour
  palette and mode-colour editor, receiver configuration, DShot special
  commands, blackbox download and a CLI terminal with live output. iNav adds
  per-index logic conditions, live global variables, OSD font upload and
  editable landing datums.
- **Parameter metadata registry with bitmask and enum editors.** Parameter
  metadata now ships bundled with the app, so full names, ranges, units,
  defaults and per-bit flag descriptions are available offline for every
  firmware rather than only when an external site is reachable. A Set Bitmask
  modal gives you labelled per-bit checkboxes with search, raw decimal and hex,
  and preservation of bits it does not recognise, so an undocumented flag is
  never silently cleared. Enum parameters get a real dropdown. An Options column
  shows the decoded value at a glance, and the write confirmation shows the flag
  difference before you commit.
- **A hosted parameter registry overlay.** On top of the bundled floor, the app
  can pull versioned metadata snapshots so parameter help matches the firmware
  version actually on the board. iNav gains its full named-settings registry of
  677 settings.
- **A JavaScript expression compiler for iNav logic conditions.** Write a plain
  expression and it compiles down to the underlying logic-condition slots
  instead of hand-assembling them one row at a time.
- **Onboard Lua scripting for ArduPilot.** A Scripts section under Setup manages
  the scripts on the board over MAVLink file transfer, with upload by drag and
  drop, download, delete, engine configuration and a filtered script console.
  A starter catalog of first-party applets is one click to install.
- **MAVLink file transfer, structured events and native sockets.** The file
  transfer client now writes, lists and removes as well as reads, and is
  hardened against a lossy or hostile server. PX4 structured events (message
  410) decode into a readable feed backed by the vehicle's own event metadata,
  so prearm, mode and failsafe messages are finally visible. Parameter metadata
  can be served by the flight controller itself. The desktop app connects over
  native UDP and TCP in addition to serial.
- **Mission planning, rebuilt.** The Plan tab gains a survey solver that works
  backwards from the ground sample distance you want to an altitude and a
  motion-blur-safe speed, wind-optimised line orientation, fixed-wing turnaround
  geometry, keep-out polygon skipping, a coverage footprint overlay, a quick
  builder from the map bounds, and a change-detection resurvey planner. Landing
  patterns cover fixed wing and VTOL.
- **A per-waypoint action timeline.** Actions attach to the waypoint they belong
  to, edited inline with reordering and a jump-target picker, and flatten and
  re-nest correctly across upload, download, export and import. The command
  palette filters to what your firmware actually supports.
- **Mission checks before you fly.** Upload is blocked while validation errors
  stand. Inclusion and exclusion zones, rally points and terrain clearance are
  enforced, with a soft-buffer warning short of a hard breach. Terrain conflicts
  are flagged along each leg and on the return-to-launch leg. There is an
  advisory item-count check against the flight controller, a keyless airport
  proximity gate, a flight energy model, sun times with a golden-hour card and a
  pre-flight checklist.
- **Weather, import, export and sharing in the planner.** A keyless go/no-go
  weather card, boundary import from KML, KMZ and shapefiles, GeoTIFF orthophoto
  overlay, a flight-brief PDF export, a built-in mission template library, plan
  folders, points of interest, and shareable plan links that encode the plan in
  the URL fragment so nothing leaves your machine.
- **A copilot for mission intent.** Describe what you want in plain words and a
  deterministic parser sets up the matching pattern. No key and no external
  service.
- **Coordinates and units throughout.** Live cursor coordinate and elevation
  readout, a display-format preference across decimal degrees, degrees minutes
  seconds, UTM and MGRS, forward geocoding search on the map, and one shared
  units formatter behind the stats bar, pattern stats and altitude profile.
- **The Cockpit.** The old Fly Mode is now the Cockpit, split into a Flight tab
  and an immersive Cockpit tab. Flight behaviors are skills bound to hotkeys and
  gamepad buttons on a shared skill bar, contributed by built-in commands and
  extensions through the same registry. Widgets are arrangeable by zone and
  persist with your loadout, information density is a per-loadout setting, and a
  command palette on Ctrl or Cmd plus K searches and runs any drone command
  through the same pipeline. The safety band showing arm state, battery, GPS and
  link never hides.
- **Target designation in the Cockpit.** Click a detection to designate it. A
  what-is-locked chip names the current target, an aim-ahead lead reticle tracks
  a moving one, and extensions contribute their own target actions into the
  click popup with their own hotkeys. Detection boxes ease between batches so
  they follow motion instead of stepping.
- **Multi-camera video with picture-in-picture.** A node exposing more than one
  camera gets stream tabs at the top left, switched by the number keys or by
  cycling. A second stream can be pinned as a picture-in-picture inset whose
  position persists per loadout. Concurrent streams flip instantly by
  re-pointing at each leg's own address, switching is debounced so a rapid flip
  cannot stack encoder restarts, and a dead leg is disabled rather than shown
  as live.
- **Camera roster management.** A Cameras surface on the node detail reads the
  roster from the agent and round-trips per-leg bitrate and calibration.
- **A Nodes fleet board.** A third dashboard view mode renders a dense live
  table ordered live, then stale, then offline. Each row carries reach, link,
  battery, mode and role, with per-row controls that act on that node over the
  LAN or the cloud queue. Rows support selection, bulk apply-one-change and
  search, and flight controls are gated on the same liveness the board shows.
- **A unified per-profile node console.** One console adapts to the node in
  front of you across drone, flight controller, ground station and workstation,
  with a profile-aware hero header, sidebar and overview. The agent dashboard is
  folded into Overview, the last tab you used is restored per node, and a
  per-node feature framework lets you opt a drone into World Model capture.
- **A node Settings tab with thirteen configuration pages.** Network uplink,
  Wi-Fi scan and join, cellular APN, MAC pinning and adapter stability,
  self-heal and link guardian, MAVLink routing, security, vision and
  perception, world model, discovery and reach names, video and cameras, and
  cloud, organised behind two-tier grouped navigation and reachable over the
  LAN or the cloud.
  Security downgrades and link-affecting toggles ask for confirmation first.
- **Relayed enrollment and a live mesh map.** A drone linked to a paired ground
  node over the radio enrolls as its own node, nested under the ground node that
  carries it, with per-bearer reach provenance rather than a bare label. A live
  node-to-node mesh and reach map names each relay funnel.
- **Extensions.** What were called plugins are now Extensions, on a contribution
  platform. One manifest block contributes tabs, settings sections, parameters,
  models, mission templates, map overlays, skills, target actions and tools, all
  resolved through one registry so a built-in surface and an extension surface
  are the same shape. Parameters are described by JSON Schema and rendered
  natively. Install works from the registry, from a URL pinned to the bytes the
  agent reviewed, and local-first from a paired agent over the LAN with no cloud
  round trip. The install dialog was rebuilt around trust signals, capability
  chips and a contributions summary.
- **An MCP tab.** Connect an AI client to your fleet through the Model Context
  Protocol. A guided local-first setup wizard takes you from nothing to a
  connected client in five steps with a live connection check, including a
  one-command option that covers every drone on your LAN with no file and no
  login. Machine credentials are scoped by capability and by node with an
  expiry, and there is a searchable tool catalog, an audit log and a live panel
  that shows calls as they happen.
- **Perception.** The Vision tab is now Perception, grouped into engine,
  execution, feed health, inputs and models. A drone without an accelerator can
  offload detection to a paired workstation, configured per node, with the tier
  and target surfaced honestly in the Cockpit beside streaming-session health.
  Detections carry lock state and association confidence, are keyed by model and
  camera stream, and reach the app over the cloud relay as well as the LAN.
- **ADOS Workstation.** The compute profile is now the Workstation, with a
  branded dashboard showing real GPU, CPU, memory and disk with live GPU
  utilisation, and it is enabled by default rather than behind a flag.
- **Atlas world model.** Capture 3D reconstructions from a drone and view them
  as gaussian splats or point clouds, with a live-updating Live World tab, a
  dedicated splat viewer with download progress, detail-level presets carrying a
  gaussian budget, and a Forge workbench for the reconstruction queue.
- **ADOS Stack Deployer.** A Rust terminal UI is now the supported way to
  self-host the whole stack. It plans and runs a turnkey deploy, then manages
  the running stack with status, logs, restart, upgrade and teardown, detects
  your LAN address for the default reach, flags an already-bound port inline,
  and recovers its configuration from an existing environment file on a re-run.
- **Simulation.** Sky rendering that follows the map mode, quality presets, a
  top-centre warning banner clear of the playback bar, an actual-flight-path
  overlay, rounded-turn previews and playback driven through a sampled track
  source.
- **Radio link diagnosis.** The radio surfaces packets seen and decrypt-error
  counters, prefers the radio's own transmit-proof verdict over an inferred one,
  and names a transmitting-but-unproven link as its own state instead of reading
  it as fully down. Adapter USB and injection health resolve into one reading.
  Phantom-pairing and stale-key bind failures are named for what they are.
- **A ground-station HDMI cockpit and touch calibration**, on the Display tab.
- **An RC and ELRS control-lane tab.** The control-lane snapshot flows into the
  per-node store from both the LAN and the cloud, carrying transmit power and
  the command-down gate.
- **Per-node dashboard access PIN management**, so you can set, reset and check
  the PIN that guards a node's own web dashboard from the fleet view.
- **Native UDP and TCP MAVLink in the desktop app**, with a helper that bridges
  either to a WebSocket for the browser build.

### Changed

- **Extensions replaced plugins in all user-facing copy**, across all sixteen
  locales. The packaging format, the SDK and the CLI keep their existing names.
- **The standalone full-screen flight route is retired.** The immersive view is
  now the Cockpit tab in place, with unified flight-recording control.
- **The minimap is a clean auto-follow map.** Overlays were stripped, the
  basemap selector collapsed behind an icon, the map enlarged, and clicking it
  opens the Flight tab.
- **Elevation reports as unavailable instead of a fabricated zero**, and MSL
  placement now applies EGM96 geoid separation.
- **Demo mode covers the whole platform.** A mixed-firmware fleet, five world
  tour missions in the plan library, a direct-connect USB flight controller, a
  ground station with its node tabs and control lane, relayed enrollment, per
  stream video and a mock node configuration surface.
- **Self-hosting documentation now points at the deployer** rather than the
  removed command-line tool.

### Fixed

- **A failed parameter write surfaces instead of passing silently**, because
  error frames now reject rather than resolve.
- **Live telemetry is no longer faked from stale values.** Zeros are gated on
  freshness, an unreachable configured source is surfaced, and a stale radio
  signal is dimmed rather than shown as current.
- **A queued cloud command reports the vehicle's real answer**, and a rejected
  command spends nothing.
- **Commands and settings act on the node you are looking at.** A settings draft
  resets when you switch nodes, the radio panel keys to its own node, and a
  section that was showing another node's channels was removed.
- **A filtered-out relay funnel no longer implies a radio link to the app.**
- **Return-to-launch and Land are disabled on a node whose firmware has no
  autonomous navigation**, rather than offered and silently ignored.
- **A host that merely starts with a private address prefix is rejected**, and
  an incomplete address literal no longer passes the private-host guard.
- **The MAVLink WebSocket proxy is ticket-authenticated**, and the app prefers
  the authenticated endpoint where the agent offers one.
- **Dropdown menus and popovers render above their scroll containers** instead
  of being clipped, and they implement the keyboard contract their roles claim.
- **Unpairing removes the node everywhere**, including the cloud row.
- **Reachability failures explain themselves** instead of returning a bare
  gateway error.
- **A drone reached only through a ground station's radio relay now gets a
  live flight-controller link.** Its Setup and Parameters tabs previously
  showed the agent as offline with no heartbeat, contradicting the node's own
  online status in the sidebar. The app now opens the same MAVLink session the
  ground station's relay already carries, so real parameters, telemetry and
  commands work over the radio, not just video.

### Removed

- **The Node self-hosting command-line tool**, superseded by the deployer.
- **The top-level extension risk badge.** The per-capability sensitive tag
  stays, which is the signal that tells you what an extension can actually
  reach.
- **Unmounted contribution slots** that had no host to render them, and the
  registry browse pages that were not yet backed by a live service.

### Notes

- Pairs with ADOS Drone Agent 0.99.241.
- Versions 0.35.0 through 0.56.0 shipped continuously and are covered here
  rather than as separate entries.

## [0.57.0] - 2026-07-25

This release rolls up everything since 0.34.4, covering versions 0.35.0 through
0.57.0 and roughly five weeks of work. Highlights below, grouped by area.

The thread running through it is breadth. Mission Control now configures four
flight-controller firmwares at the depth their own configurators do, plans and
checks a mission against terrain, airspace, energy and weather before you fly
it, and treats every node in a fleet as a first-class object with its own
console, settings and reach provenance.

### Added

- **Four-firmware flight controller configuration.** ArduPilot, PX4, Betaflight
  and iNav each gain deep configuration surfaces. ArduPilot adds rover steering
  and speed tuning, an EKF3 estimator panel, telemetry stream rates, QuadPlane
  and VTOL, plane energy and navigation tuning, ArduSub, traditional
  helicopter, non-GPS positioning, multi-instance rangefinders, airspeed,
  harmonic notch, sailboat, gripper and ADS-B. PX4 adds flight behavior,
  fixed-wing tuning, autotune for multicopter and fixed wing, VTOL transition,
  GPS, control allocation, live actuator test and thermal calibration.
  Betaflight adds serial ports, OSD with font upload, LED strip with a 16-colour
  palette and mode-colour editor, receiver configuration, DShot special
  commands, blackbox download and a CLI terminal with live output. iNav adds
  per-index logic conditions, live global variables, OSD font upload and
  editable landing datums.
- **Parameter metadata registry with bitmask and enum editors.** Parameter
  metadata now ships bundled with the app, so full names, ranges, units,
  defaults and per-bit flag descriptions are available offline for every
  firmware rather than only when an external site is reachable. A Set Bitmask
  modal gives you labelled per-bit checkboxes with search, raw decimal and hex,
  and preservation of bits it does not recognise, so an undocumented flag is
  never silently cleared. Enum parameters get a real dropdown. An Options column
  shows the decoded value at a glance, and the write confirmation shows the flag
  difference before you commit.
- **A hosted parameter registry overlay.** On top of the bundled floor, the app
  can pull versioned metadata snapshots so parameter help matches the firmware
  version actually on the board. iNav gains its full named-settings registry of
  677 settings.
- **A JavaScript expression compiler for iNav logic conditions.** Write a plain
  expression and it compiles down to the underlying logic-condition slots
  instead of hand-assembling them one row at a time.
- **Onboard Lua scripting for ArduPilot.** A Scripts section under Setup manages
  the scripts on the board over MAVLink file transfer, with upload by drag and
  drop, download, delete, engine configuration and a filtered script console.
  A starter catalog of first-party applets is one click to install.
- **MAVLink file transfer, structured events and native sockets.** The file
  transfer client now writes, lists and removes as well as reads, and is
  hardened against a lossy or hostile server. PX4 structured events (message
  410) decode into a readable feed backed by the vehicle's own event metadata,
  so prearm, mode and failsafe messages are finally visible. Parameter metadata
  can be served by the flight controller itself. The desktop app connects over
  native UDP and TCP in addition to serial.
- **Mission planning, rebuilt.** The Plan tab gains a survey solver that works
  backwards from the ground sample distance you want to an altitude and a
  motion-blur-safe speed, wind-optimised line orientation, fixed-wing turnaround
  geometry, keep-out polygon skipping, a coverage footprint overlay, a quick
  builder from the map bounds, and a change-detection resurvey planner. Landing
  patterns cover fixed wing and VTOL.
- **A per-waypoint action timeline.** Actions attach to the waypoint they belong
  to, edited inline with reordering and a jump-target picker, and flatten and
  re-nest correctly across upload, download, export and import. The command
  palette filters to what your firmware actually supports.
- **Mission checks before you fly.** Upload is blocked while validation errors
  stand. Inclusion and exclusion zones, rally points and terrain clearance are
  enforced, with a soft-buffer warning short of a hard breach. Terrain conflicts
  are flagged along each leg and on the return-to-launch leg. There is an
  advisory item-count check against the flight controller, a keyless airport
  proximity gate, a flight energy model, sun times with a golden-hour card and a
  pre-flight checklist.
- **Weather, import, export and sharing in the planner.** A keyless go/no-go
  weather card, boundary import from KML, KMZ and shapefiles, GeoTIFF orthophoto
  overlay, a flight-brief PDF export, a built-in mission template library, plan
  folders, points of interest, and shareable plan links that encode the plan in
  the URL fragment so nothing leaves your machine.
- **A copilot for mission intent.** Describe what you want in plain words and a
  deterministic parser sets up the matching pattern. No key and no external
  service.
- **Coordinates and units throughout.** Live cursor coordinate and elevation
  readout, a display-format preference across decimal degrees, degrees minutes
  seconds, UTM and MGRS, forward geocoding search on the map, and one shared
  units formatter behind the stats bar, pattern stats and altitude profile.
- **The Cockpit.** The old Fly Mode is now the Cockpit, split into a Flight tab
  and an immersive Cockpit tab. Flight behaviors are skills bound to hotkeys and
  gamepad buttons on a shared skill bar, contributed by built-in commands and
  extensions through the same registry. Widgets are arrangeable by zone and
  persist with your loadout, information density is a per-loadout setting, and a
  command palette on Ctrl or Cmd plus K searches and runs any drone command
  through the same pipeline. The safety band showing arm state, battery, GPS and
  link never hides.
- **Target designation in the Cockpit.** Click a detection to designate it. A
  what-is-locked chip names the current target, an aim-ahead lead reticle tracks
  a moving one, and extensions contribute their own target actions into the
  click popup with their own hotkeys. Detection boxes ease between batches so
  they follow motion instead of stepping.
- **Multi-camera video with picture-in-picture.** A node exposing more than one
  camera gets stream tabs at the top left, switched by the number keys or by
  cycling. A second stream can be pinned as a picture-in-picture inset whose
  position persists per loadout. Concurrent streams flip instantly by
  re-pointing at each leg's own address, switching is debounced so a rapid flip
  cannot stack encoder restarts, and a dead leg is disabled rather than shown
  as live.
- **Camera roster management.** A Cameras surface on the node detail reads the
  roster from the agent and round-trips per-leg bitrate and calibration.
- **A Nodes fleet board.** A third dashboard view mode renders a dense live
  table ordered live, then stale, then offline. Each row carries reach, link,
  battery, mode and role, with per-row controls that act on that node over the
  LAN or the cloud queue. Rows support selection, bulk apply-one-change and
  search, and flight controls are gated on the same liveness the board shows.
- **A unified per-profile node console.** One console adapts to the node in
  front of you across drone, flight controller, ground station and workstation,
  with a profile-aware hero header, sidebar and overview. The agent dashboard is
  folded into Overview, the last tab you used is restored per node, and a
  per-node feature framework lets you opt a drone into World Model capture.
- **A node Settings tab with thirteen configuration pages.** Network uplink,
  Wi-Fi scan and join, cellular APN, MAC pinning and adapter stability,
  self-heal and link guardian, MAVLink routing, security, vision and
  perception, world model, discovery and reach names, video and cameras, and
  cloud, organised behind two-tier grouped navigation and reachable over the
  LAN or the cloud.
  Security downgrades and link-affecting toggles ask for confirmation first.
- **Relayed enrollment and a live mesh map.** A drone linked to a paired ground
  node over the radio enrolls as its own node, nested under the ground node that
  carries it, with per-bearer reach provenance rather than a bare label. A live
  node-to-node mesh and reach map names each relay funnel.
- **Extensions.** What were called plugins are now Extensions, on a contribution
  platform. One manifest block contributes tabs, settings sections, parameters,
  models, mission templates, map overlays, skills, target actions and tools, all
  resolved through one registry so a built-in surface and an extension surface
  are the same shape. Parameters are described by JSON Schema and rendered
  natively. Install works from the registry, from a URL pinned to the bytes the
  agent reviewed, and local-first from a paired agent over the LAN with no cloud
  round trip. The install dialog was rebuilt around trust signals, capability
  chips and a contributions summary.
- **An MCP tab.** Connect an AI client to your fleet through the Model Context
  Protocol. A guided local-first setup wizard takes you from nothing to a
  connected client in five steps with a live connection check, including a
  one-command option that covers every drone on your LAN with no file and no
  login. Machine credentials are scoped by capability and by node with an
  expiry, and there is a searchable tool catalog, an audit log and a live panel
  that shows calls as they happen.
- **Perception.** The Vision tab is now Perception, grouped into engine,
  execution, feed health, inputs and models. A drone without an accelerator can
  offload detection to a paired workstation, configured per node, with the tier
  and target surfaced honestly in the Cockpit beside streaming-session health.
  Detections carry lock state and association confidence, are keyed by model and
  camera stream, and reach the app over the cloud relay as well as the LAN.
- **ADOS Workstation.** The compute profile is now the Workstation, with a
  branded dashboard showing real GPU, CPU, memory and disk with live GPU
  utilisation, and it is enabled by default rather than behind a flag.
- **Atlas world model.** Capture 3D reconstructions from a drone and view them
  as gaussian splats or point clouds, with a live-updating Live World tab, a
  dedicated splat viewer with download progress, detail-level presets carrying a
  gaussian budget, and a Forge workbench for the reconstruction queue.
- **ADOS Stack Deployer.** A Rust terminal UI is now the supported way to
  self-host the whole stack. It plans and runs a turnkey deploy, then manages
  the running stack with status, logs, restart, upgrade and teardown, detects
  your LAN address for the default reach, flags an already-bound port inline,
  and recovers its configuration from an existing environment file on a re-run.
- **Simulation.** Sky rendering that follows the map mode, quality presets, a
  top-centre warning banner clear of the playback bar, an actual-flight-path
  overlay, rounded-turn previews and playback driven through a sampled track
  source.
- **Radio link diagnosis.** The radio surfaces packets seen and decrypt-error
  counters, prefers the radio's own transmit-proof verdict over an inferred one,
  and names a transmitting-but-unproven link as its own state instead of reading
  it as fully down. Adapter USB and injection health resolve into one reading.
  Phantom-pairing and stale-key bind failures are named for what they are.
- **A ground-station HDMI cockpit and touch calibration**, on the Display tab.
- **An RC and ELRS control-lane tab.** The control-lane snapshot flows into the
  per-node store from both the LAN and the cloud, carrying transmit power and
  the command-down gate.
- **Per-node dashboard access PIN management**, so you can set, reset and check
  the PIN that guards a node's own web dashboard from the fleet view.
- **Native UDP and TCP MAVLink in the desktop app**, with a helper that bridges
  either to a WebSocket for the browser build.

### Changed

- **Extensions replaced plugins in all user-facing copy**, across all sixteen
  locales. The packaging format, the SDK and the CLI keep their existing names.
- **The standalone full-screen flight route is retired.** The immersive view is
  now the Cockpit tab in place, with unified flight-recording control.
- **The minimap is a clean auto-follow map.** Overlays were stripped, the
  basemap selector collapsed behind an icon, the map enlarged, and clicking it
  opens the Flight tab.
- **Elevation reports as unavailable instead of a fabricated zero**, and MSL
  placement now applies EGM96 geoid separation.
- **Demo mode covers the whole platform.** A mixed-firmware fleet, five world
  tour missions in the plan library, a direct-connect USB flight controller, a
  ground station with its node tabs and control lane, relayed enrollment, per
  stream video and a mock node configuration surface.
- **Self-hosting documentation now points at the deployer** rather than the
  removed command-line tool.

### Fixed

- **A failed parameter write surfaces instead of passing silently**, because
  error frames now reject rather than resolve.
- **Live telemetry is no longer faked from stale values.** Zeros are gated on
  freshness, an unreachable configured source is surfaced, and a stale radio
  signal is dimmed rather than shown as current.
- **A queued cloud command reports the vehicle's real answer**, and a rejected
  command spends nothing.
- **Commands and settings act on the node you are looking at.** A settings draft
  resets when you switch nodes, the radio panel keys to its own node, and a
  section that was showing another node's channels was removed.
- **A filtered-out relay funnel no longer implies a radio link to the app.**
- **Return-to-launch and Land are disabled on a node whose firmware has no
  autonomous navigation**, rather than offered and silently ignored.
- **A host that merely starts with a private address prefix is rejected**, and
  an incomplete address literal no longer passes the private-host guard.
- **The MAVLink WebSocket proxy is ticket-authenticated**, and the app prefers
  the authenticated endpoint where the agent offers one.
- **Dropdown menus and popovers render above their scroll containers** instead
  of being clipped, and they implement the keyboard contract their roles claim.
- **Unpairing removes the node everywhere**, including the cloud row.
- **Reachability failures explain themselves** instead of returning a bare
  gateway error.

### Removed

- **The Node self-hosting command-line tool**, superseded by the deployer.
- **The top-level extension risk badge.** The per-capability sensitive tag
  stays, which is the signal that tells you what an extension can actually
  reach.
- **Unmounted contribution slots** that had no host to render them, and the
  registry browse pages that were not yet backed by a live service.

### Notes

- Pairs with ADOS Drone Agent 0.99.241.
- Versions 0.35.0 through 0.56.0 shipped continuously and are covered here
  rather than as separate entries.

## [0.34.4] - 2026-06-21

A patch over 0.34.3 that makes flight-controller link health honest: the GCS now
tells you when a flight controller is plugged in but is not actually speaking
MAVLink, instead of showing a connected badge over stale telemetry.

### Added

- **Flight-controller link diagnostics.** When a flight controller's port is
  open but no MAVLink heartbeat is decoding, the agent status reads "Port open ·
  no MAVLink" (amber) instead of a false "Connected", with an actionable message
  telling you what to fix — for example, set the flight controller's serial
  protocol to MAVLink (on ArduPilot, `SERIAL0_PROTOCOL=2` on the USB port; on
  iNav, enable MAVLink on the port). A board that is speaking MSP instead of
  MAVLink is called out specifically.
- **Fleet-card flight-controller pill.** The per-drone fleet card surfaces a
  silent flight controller ("FC: no MAVLink" / "FC: MSP") so you can spot it at a
  glance without opening the detail panel, whether the drone is paired over the
  LAN or over the cloud relay.

### Fixed

- **No more stale telemetry shown as live.** When the flight-controller link goes
  silent, the Flight Data card, the telemetry readout, and the drone-detail
  health metrics blank attitude, GPS, and battery to placeholders instead of
  freezing the last sample as if it were live. GPS fields stay gated on a real
  fix.
- **Link health reaches both connection paths.** The gated link state (transport
  open, heartbeat alive, heartbeat age) and the diagnostic hint now flow through
  both the LAN-direct and cloud-relay views, so a remotely connected operator
  sees the same honest state a locally connected one does.

## [0.34.3] - 2026-06-19

This desktop build is a patch over 0.34.2 (same 0.10.6 through 0.34.x feature
set) that fixes bundled-asset loading in the installed app. Highlights below,
grouped by area.

### Added

- **Mission planning, reworked.** The Plan tab now drives every map tool from a
  single interaction mode with one labeled toolbar, so select, waypoint, draw,
  measure, geofence, and rally no longer fight each other. A persistent hint
  reminds you that a select-click drops a waypoint. Search patterns get an
  explicit Set Datum tool. Rally placement is a sticky tool. Undo is unified
  across waypoints, geofence, rally, and drawn shapes. Each waypoint keeps its
  own altitude reference frame through upload, export, and import. Missions
  export losslessly to `.altmission` and `.kmz`. Offline tile download follows
  wherever you have panned the map. A Center Map Here action and working
  geofence-clear and rally-clear buttons round it out.
- **Mission upload feedback.** Uploading a mission to the flight controller now
  reports success or failure instead of finishing silently, and each waypoint's
  altitude frame is sent exactly as drawn.
- **Simulation playback.** The simulator runs from a single clock, shows only
  the values it actually models, labels its HUD as a preview rather than live
  telemetry, and preserves the flight duration when you rewind.
- **Fleet dashboard, one card per agent.** Each agent renders as a single card
  derived from its device id, so an agent and the flight controller behind it
  collapse into one entry instead of duplicating. The detail panel adapts to
  the node's profile (drone, ground station, or compute) through a surface
  registry that shows only the tabs that node supports. A new node grid view
  puts live video tiles side by side, with a grid or overview toggle. Stale
  local nodes show a clear re-pair or remove prompt.
- **Black Box log viewer.** Read the agent's durable on-device log and
  telemetry store straight from the GCS, including history that survives an
  agent restart, with an option to push it to the cloud backend.
- **Software Update card.** The System tab shows live over-the-air update
  progress through each phase as the agent updates itself.
- **Radio and pairing visibility.** The radio panel shows the rendezvous and
  current channel and band, whether the drone is transmitting, the peer-link
  and hop state, and the regulatory domain when set. It adds link tuning
  controls with auto-calibration, the live FEC ratio and adaptive mode, a
  warning when the radio adapter enumerated on a slow USB port (advancing its
  transmit counter while emitting no usable RF), a power-floor (muted PHY)
  badge, a coarse radio-stack rollup that names why a link is not
  transmitting, a video transmitter stall indicator, and bind
  injection-adapter readiness on the pairing card.
- **Camera and video health.** The fleet card surfaces a missing or recovering
  air-side camera, including a USB power-contention diagnostic, even for a
  drone paired only over the LAN. Local-node video plays from the agent IP that
  is actually reachable.
- **Per-drone plugins.** Plugins install against a specific drone, with the
  drone detail panel carrying a Plugins tab scoped to that drone (install,
  enable, disable, configure, uninstall). The list now shows each plugin's
  service readiness and per-plugin model-delivery status. Plugins can
  contribute a per-drone tab through a `drone.detail.tab` UI slot.
- **Vision navigation surface.** Drones running the vision navigation plugin
  gain a Navigation tab with live optical flow rate and quality, rangefinder
  reading and health, the active EKF source set, and an arm-readiness summary.
  Backed by new `OPTICAL_FLOW_RAD`, `VISION_POSITION_ESTIMATE`, and `ODOMETRY`
  decoders, a `MAV_CMD_SET_EKF_SOURCE_SET` encoder, and a pre-arm parameter
  batch. The detection overlay carries lock-state and association confidence.
- **One connect modal.** A single dialog connects a flight controller or a
  companion agent, and the Pair New Node dialog shows the exact agent install
  command. Pair-by-code resolves over the LAN with no cloud round-trip.
- **Firmware flashing.** A complete in-app firmware flashing workflow.
- **Ground station surfaces.** The uplink card shows cloud-relay forwarding
  state and surfaces a failed share-uplink apply, and you can trigger on-device
  touch calibration from the ground-station panel.
- **Agent reach-back visibility.** The GCS surfaces agent management-link
  health, the management-link reach-back mode, and the USB-rehome self-heal
  state.

### Changed

- **Native desktop title bar** on macOS and Linux.
- **Authenticated MAVLink link.** The MAVLink WebSocket proxy is ticket
  authenticated, and the GCS prefers the authenticated endpoint whenever the
  agent advertises it.
- **Nodes, not drones.** Sidebar terminology moved from "drone" to "node",
  since an agent can run as a drone, ground, compute, relay, or receiver, with
  each row labeling its specific type.
- **Local-first pairing throughout.** Pair flow (probe, claim, unpair) routes
  through the Mission Control proxy so `.local` hostnames resolve even in
  browsers without mDNS, an unreachable LAN probe explains itself instead of
  returning a bare 502, and a pairing code the cloud does not know returns a
  calm "pair on this network" prompt instead of a console error.
- **Cloud relay hardening.** The relay forwards radio fields generically and
  records transmit-rate and churn counters, and its auth, retention, and
  heartbeat contract are tightened. Agent polling is bounded with clean aborts,
  and failed cloud command acknowledgements surface in the UI.
- **Tooling.** Continuous integration now gates on lint and type-check,
  enforces a test-coverage floor, adds dependency scanning, and the codebase
  gained protocol and pairing state-machine test coverage.

### Fixed

- **Desktop fonts and map icons load.** The packaged app now serves its bundled
  fonts, and the Leaflet map control icons, from the correct asset path instead
  of 404ing, so the interface renders in its intended typefaces.
- **Desktop app no longer crashes on launch.** The Convex client provider is
  always mounted, so a build with no cloud backend configured, and any screen
  that uses Convex, renders normally instead of dropping into the global error
  screen.
- **Cloud features in the desktop app.** The desktop build now includes the
  cloud backend, so the community pages, sign-in, and cloud relay for remote
  drones work in the installed app, matching the web version.
- **Geofence data loss.** The geofence editor is bound to the geofence store,
  so an edited fence is no longer dropped.
- **Stuck and mis-gated panels.** Fleet video gating, bounded diagnostics, and
  recovery for stuck panels, plus corrected MAVLink routing, command
  correlation, and mission and mode handling.
- **Local pairing edge cases.** A locally-paired node routes through one
  LAN-versus-cloud connect path, deleting a local drone purges its stored
  entry, and local-first mode no longer wipes pair state on sign-in.
- **Desktop release pipeline builds the Windows installer.** The packaging
  step no longer rebuilds native node modules that the desktop wrapper never
  ships, so the Windows build no longer needs a C toolchain on the runner.
  All three platforms (macOS, Windows, Linux) package again.

### Removed

- **ROS tab.** The ROS sub-tab, its store, API client, types, and the related
  capability and heartbeat fields are gone, since the agent no longer ships a
  ROS environment.

## [0.34.2] - 2026-06-19

This desktop build re-ships the 0.34.1 feature set (rolled up from web versions
0.10.6 through 0.34.1) with the launch crash fixed and cloud features enabled.
Highlights below, grouped by area.

### Added

- **Mission planning, reworked.** The Plan tab now drives every map tool from a
  single interaction mode with one labeled toolbar, so select, waypoint, draw,
  measure, geofence, and rally no longer fight each other. A persistent hint
  reminds you that a select-click drops a waypoint. Search patterns get an
  explicit Set Datum tool. Rally placement is a sticky tool. Undo is unified
  across waypoints, geofence, rally, and drawn shapes. Each waypoint keeps its
  own altitude reference frame through upload, export, and import. Missions
  export losslessly to `.altmission` and `.kmz`. Offline tile download follows
  wherever you have panned the map. A Center Map Here action and working
  geofence-clear and rally-clear buttons round it out.
- **Mission upload feedback.** Uploading a mission to the flight controller now
  reports success or failure instead of finishing silently, and each waypoint's
  altitude frame is sent exactly as drawn.
- **Simulation playback.** The simulator runs from a single clock, shows only
  the values it actually models, labels its HUD as a preview rather than live
  telemetry, and preserves the flight duration when you rewind.
- **Fleet dashboard, one card per agent.** Each agent renders as a single card
  derived from its device id, so an agent and the flight controller behind it
  collapse into one entry instead of duplicating. The detail panel adapts to
  the node's profile (drone, ground station, or compute) through a surface
  registry that shows only the tabs that node supports. A new node grid view
  puts live video tiles side by side, with a grid or overview toggle. Stale
  local nodes show a clear re-pair or remove prompt.
- **Black Box log viewer.** Read the agent's durable on-device log and
  telemetry store straight from the GCS, including history that survives an
  agent restart, with an option to push it to the cloud backend.
- **Software Update card.** The System tab shows live over-the-air update
  progress through each phase as the agent updates itself.
- **Radio and pairing visibility.** The radio panel shows the rendezvous and
  current channel and band, whether the drone is transmitting, the peer-link
  and hop state, and the regulatory domain when set. It adds link tuning
  controls with auto-calibration, the live FEC ratio and adaptive mode, a
  warning when the radio adapter enumerated on a slow USB port (advancing its
  transmit counter while emitting no usable RF), a power-floor (muted PHY)
  badge, a coarse radio-stack rollup that names why a link is not
  transmitting, a video transmitter stall indicator, and bind
  injection-adapter readiness on the pairing card.
- **Camera and video health.** The fleet card surfaces a missing or recovering
  air-side camera, including a USB power-contention diagnostic, even for a
  drone paired only over the LAN. Local-node video plays from the agent IP that
  is actually reachable.
- **Per-drone plugins.** Plugins install against a specific drone, with the
  drone detail panel carrying a Plugins tab scoped to that drone (install,
  enable, disable, configure, uninstall). The list now shows each plugin's
  service readiness and per-plugin model-delivery status. Plugins can
  contribute a per-drone tab through a `drone.detail.tab` UI slot.
- **Vision navigation surface.** Drones running the vision navigation plugin
  gain a Navigation tab with live optical flow rate and quality, rangefinder
  reading and health, the active EKF source set, and an arm-readiness summary.
  Backed by new `OPTICAL_FLOW_RAD`, `VISION_POSITION_ESTIMATE`, and `ODOMETRY`
  decoders, a `MAV_CMD_SET_EKF_SOURCE_SET` encoder, and a pre-arm parameter
  batch. The detection overlay carries lock-state and association confidence.
- **One connect modal.** A single dialog connects a flight controller or a
  companion agent, and the Pair New Node dialog shows the exact agent install
  command. Pair-by-code resolves over the LAN with no cloud round-trip.
- **Firmware flashing.** A complete in-app firmware flashing workflow.
- **Ground station surfaces.** The uplink card shows cloud-relay forwarding
  state and surfaces a failed share-uplink apply, and you can trigger on-device
  touch calibration from the ground-station panel.
- **Agent reach-back visibility.** The GCS surfaces agent management-link
  health, the management-link reach-back mode, and the USB-rehome self-heal
  state.

### Changed

- **Native desktop title bar** on macOS and Linux.
- **Authenticated MAVLink link.** The MAVLink WebSocket proxy is ticket
  authenticated, and the GCS prefers the authenticated endpoint whenever the
  agent advertises it.
- **Nodes, not drones.** Sidebar terminology moved from "drone" to "node",
  since an agent can run as a drone, ground, compute, relay, or receiver, with
  each row labeling its specific type.
- **Local-first pairing throughout.** Pair flow (probe, claim, unpair) routes
  through the Mission Control proxy so `.local` hostnames resolve even in
  browsers without mDNS, an unreachable LAN probe explains itself instead of
  returning a bare 502, and a pairing code the cloud does not know returns a
  calm "pair on this network" prompt instead of a console error.
- **Cloud relay hardening.** The relay forwards radio fields generically and
  records transmit-rate and churn counters, and its auth, retention, and
  heartbeat contract are tightened. Agent polling is bounded with clean aborts,
  and failed cloud command acknowledgements surface in the UI.
- **Tooling.** Continuous integration now gates on lint and type-check,
  enforces a test-coverage floor, adds dependency scanning, and the codebase
  gained protocol and pairing state-machine test coverage.

### Fixed

- **Desktop app no longer crashes on launch.** The Convex client provider is
  always mounted, so a build with no cloud backend configured, and any screen
  that uses Convex, renders normally instead of dropping into the global error
  screen.
- **Cloud features in the desktop app.** The desktop build now includes the
  cloud backend, so the community pages, sign-in, and cloud relay for remote
  drones work in the installed app, matching the web version.
- **Geofence data loss.** The geofence editor is bound to the geofence store,
  so an edited fence is no longer dropped.
- **Stuck and mis-gated panels.** Fleet video gating, bounded diagnostics, and
  recovery for stuck panels, plus corrected MAVLink routing, command
  correlation, and mission and mode handling.
- **Local pairing edge cases.** A locally-paired node routes through one
  LAN-versus-cloud connect path, deleting a local drone purges its stored
  entry, and local-first mode no longer wipes pair state on sign-in.
- **Desktop release pipeline builds the Windows installer.** The packaging
  step no longer rebuilds native node modules that the desktop wrapper never
  ships, so the Windows build no longer needs a C toolchain on the runner.
  All three platforms (macOS, Windows, Linux) package again.

### Removed

- **ROS tab.** The ROS sub-tab, its store, API client, types, and the related
  capability and heartbeat fields are gone, since the agent no longer ships a
  ROS environment.

## [0.34.1] - 2026-06-19

This desktop build rolls up everything since the last desktop release (0.10.5),
covering web versions 0.10.6 through 0.34.1. Highlights below, grouped by area.

### Added

- **Mission planning, reworked.** The Plan tab now drives every map tool from a
  single interaction mode with one labeled toolbar, so select, waypoint, draw,
  measure, geofence, and rally no longer fight each other. A persistent hint
  reminds you that a select-click drops a waypoint. Search patterns get an
  explicit Set Datum tool. Rally placement is a sticky tool. Undo is unified
  across waypoints, geofence, rally, and drawn shapes. Each waypoint keeps its
  own altitude reference frame through upload, export, and import. Missions
  export losslessly to `.altmission` and `.kmz`. Offline tile download follows
  wherever you have panned the map. A Center Map Here action and working
  geofence-clear and rally-clear buttons round it out.
- **Mission upload feedback.** Uploading a mission to the flight controller now
  reports success or failure instead of finishing silently, and each waypoint's
  altitude frame is sent exactly as drawn.
- **Simulation playback.** The simulator runs from a single clock, shows only
  the values it actually models, labels its HUD as a preview rather than live
  telemetry, and preserves the flight duration when you rewind.
- **Fleet dashboard, one card per agent.** Each agent renders as a single card
  derived from its device id, so an agent and the flight controller behind it
  collapse into one entry instead of duplicating. The detail panel adapts to
  the node's profile (drone, ground station, or compute) through a surface
  registry that shows only the tabs that node supports. A new node grid view
  puts live video tiles side by side, with a grid or overview toggle. Stale
  local nodes show a clear re-pair or remove prompt.
- **Black Box log viewer.** Read the agent's durable on-device log and
  telemetry store straight from the GCS, including history that survives an
  agent restart, with an option to push it to the cloud backend.
- **Software Update card.** The System tab shows live over-the-air update
  progress through each phase as the agent updates itself.
- **Radio and pairing visibility.** The radio panel shows the rendezvous and
  current channel and band, whether the drone is transmitting, the peer-link
  and hop state, and the regulatory domain when set. It adds link tuning
  controls with auto-calibration, the live FEC ratio and adaptive mode, a
  warning when the radio adapter enumerated on a slow USB port (advancing its
  transmit counter while emitting no usable RF), a power-floor (muted PHY)
  badge, a coarse radio-stack rollup that names why a link is not
  transmitting, a video transmitter stall indicator, and bind
  injection-adapter readiness on the pairing card.
- **Camera and video health.** The fleet card surfaces a missing or recovering
  air-side camera, including a USB power-contention diagnostic, even for a
  drone paired only over the LAN. Local-node video plays from the agent IP that
  is actually reachable.
- **Per-drone plugins.** Plugins install against a specific drone, with the
  drone detail panel carrying a Plugins tab scoped to that drone (install,
  enable, disable, configure, uninstall). The list now shows each plugin's
  service readiness and per-plugin model-delivery status. Plugins can
  contribute a per-drone tab through a `drone.detail.tab` UI slot.
- **Vision navigation surface.** Drones running the vision navigation plugin
  gain a Navigation tab with live optical flow rate and quality, rangefinder
  reading and health, the active EKF source set, and an arm-readiness summary.
  Backed by new `OPTICAL_FLOW_RAD`, `VISION_POSITION_ESTIMATE`, and `ODOMETRY`
  decoders, a `MAV_CMD_SET_EKF_SOURCE_SET` encoder, and a pre-arm parameter
  batch. The detection overlay carries lock-state and association confidence.
- **One connect modal.** A single dialog connects a flight controller or a
  companion agent, and the Pair New Node dialog shows the exact agent install
  command. Pair-by-code resolves over the LAN with no cloud round-trip.
- **Firmware flashing.** A complete in-app firmware flashing workflow.
- **Ground station surfaces.** The uplink card shows cloud-relay forwarding
  state and surfaces a failed share-uplink apply, and you can trigger on-device
  touch calibration from the ground-station panel.
- **Agent reach-back visibility.** The GCS surfaces agent management-link
  health, the management-link reach-back mode, and the USB-rehome self-heal
  state.

### Changed

- **Native desktop title bar** on macOS and Linux.
- **Authenticated MAVLink link.** The MAVLink WebSocket proxy is ticket
  authenticated, and the GCS prefers the authenticated endpoint whenever the
  agent advertises it.
- **Nodes, not drones.** Sidebar terminology moved from "drone" to "node",
  since an agent can run as a drone, ground, compute, relay, or receiver, with
  each row labeling its specific type.
- **Local-first pairing throughout.** Pair flow (probe, claim, unpair) routes
  through the Mission Control proxy so `.local` hostnames resolve even in
  browsers without mDNS, an unreachable LAN probe explains itself instead of
  returning a bare 502, and a pairing code the cloud does not know returns a
  calm "pair on this network" prompt instead of a console error.
- **Cloud relay hardening.** The relay forwards radio fields generically and
  records transmit-rate and churn counters, and its auth, retention, and
  heartbeat contract are tightened. Agent polling is bounded with clean aborts,
  and failed cloud command acknowledgements surface in the UI.
- **Tooling.** Continuous integration now gates on lint and type-check,
  enforces a test-coverage floor, adds dependency scanning, and the codebase
  gained protocol and pairing state-machine test coverage.

### Fixed

- **Geofence data loss.** The geofence editor is bound to the geofence store,
  so an edited fence is no longer dropped.
- **Stuck and mis-gated panels.** Fleet video gating, bounded diagnostics, and
  recovery for stuck panels, plus corrected MAVLink routing, command
  correlation, and mission and mode handling.
- **Local pairing edge cases.** A locally-paired node routes through one
  LAN-versus-cloud connect path, deleting a local drone purges its stored
  entry, and local-first mode no longer wipes pair state on sign-in.
- **Desktop release pipeline builds the Windows installer.** The packaging
  step no longer rebuilds native node modules that the desktop wrapper never
  ships, so the Windows build no longer needs a C toolchain on the runner.
  All three platforms (macOS, Windows, Linux) package again.

### Removed

- **ROS tab.** The ROS sub-tab, its store, API client, types, and the related
  capability and heartbeat fields are gone, since the agent no longer ships a
  ROS environment.

## [0.29.8] - 2026-06-04

### Fixed

- The cloud relay now forwards every radio field generically (snake_case to
  camelCase) and records the radio transmit-rate and churn counters (transmit
  zombie kills, transmit bytes per second, restart count). A thrashing or
  zombie transmitter is now visible remotely on a self-hosted backend, matching
  the hosted backend.

## [0.29.2] - 2026-06-01

### Added

- **Radio USB-degradation warning.** The radio panel now warns when the agent
  reports its WFB adapter enumerated on a slow (full-speed, 12 Mbps) USB link —
  a state where the radio advances its transmit counter yet emits no usable RF.
  It shows the speed and flows through both the local link and the cloud relay.

## [0.29.1] - 2026-06-01

### Added

- **Radio stack state on the link health card.** The radio panel now shows the
  agent's coarse radio-stack rollup ("OK", or the reason it is not transmitting:
  no injection-capable adapter, unpaired, missing bind keys, or an incomplete
  radio stack), highlighted when it is not OK. The field was already carried
  over the cloud relay; this surfaces it.

## [0.28.0] - 2026-05-29

### Removed

- **ROS tab and capability surface.** The Command-page ROS sub-tab, its store,
  API client, and types are gone, along with the `ros2State` capability and the
  `foxgloveBindFailed` heartbeat field (schema, mutation args, status mapper,
  and cloud bridge). The agent no longer ships a ROS environment, so the GCS no
  longer surfaces one.

## [0.26.0] - 2026-05-27

### Added

- **Radio link state on the Hardware tab.** The radio panel now shows the
  home (rendezvous) channel, the current channel and band, whether the drone
  is actually transmitting, the peer-link state (linked / searching / no
  peer), the hop state, and the regulatory domain when set. A silently stuck
  link is now visible instead of looking idle. Read-only; the home channel is
  a fixed rendezvous value both sides boot on.

## [0.25.3] - 2026-05-27

### Fixed

- **No console error when a pairing code is not found.** Resolving a code that
  the cloud relay does not know (the agent is in local mode, the default) no
  longer logs anything to the browser console. The claim function now returns
  an expected "not found" result instead of throwing, so the Convex client has
  no server error to report. The calm local-first message and the "Pair on
  this network" button are unchanged; they now key off the returned result.

## [0.25.2] - 2026-05-27

### Fixed

- **Clearer failure when a pairing code is not found.** Entering a code for an
  agent that is reachable on your network but not registered with the cloud
  relay used to tell you to check the agent's internet connection. The dialog
  now shows a calm message with a "Pair on this network" button that jumps
  straight to pairing by hostname or IP, which is the path that works on a
  single network. The Add-a-Node form also nudges you to enter the hostname
  when a code does not resolve.

## [0.24.0] - 2026-05-25

### Added

- **Video transmitter stall indicator on the radio panel.** When an agent
  reports that its video transmitter has wedged and is being recovered,
  the radio link card shows a "Video TX stalled" warning and the number of
  recoveries so far. The cloud-relay heartbeat, the stored drone status,
  and the per-drone radio state now carry the video-tx liveness fields end
  to end, so a silently stalled video link is visible remotely instead of
  only on the rig.

## [0.19.5] - 2026-05-16

### Added

- **Per-drone plugin install model.** Plugins are now installed against a
  specific drone rather than the whole fleet. The drone detail panel
  carries a Plugins tab that lists only the plugins installed on that
  drone, with install, enable, disable, configure, and uninstall actions
  scoped to that drone. The fleet view at Settings -> Plugins still lists
  every install across all drones grouped by plugin id; the "Apply to all
  drones" button on each row is reserved for a follow-up release and
  ships disabled. The install dialog runs the same six-stage flow
  (queued, commanded, downloading, verifying, installing, completed)
  whether the agent is reachable on the LAN or only through the cloud
  relay; the dialog picks the transport based on the page protocol and
  the agent's pairing mode.
- **`drone.detail.tab` UI slot.** A new slot lets a plugin contribute a
  per-drone tab to the drone detail panel. The slot is keyed by the
  active drone id; switching drones unmounts the previous drone's
  plugin iframes after a 300 ms pause-resume grace and lazily mounts
  the new drone's plugin tabs on first focus. An LRU cap of 8 mounted
  iframes per drone-detail panel keeps memory bounded; the ninth tab
  opens by evicting the least-recently-focused.
- **Vision navigation telemetry channel.** Drones running the
  `com.altnautica.vision-nav` plugin now surface a Navigation tab on
  the drone detail panel. The tab renders the live optical flow rate
  in rad/s, the flow quality (0-255), the rangefinder reading and
  health, the active EKF source set (ArduPilot), and a four-card arm
  readiness summary (camera healthy, rangefinder healthy, EKF position
  healthy, FC armable). Telemetry feeds through a ring-buffered store
  with capacity 1000 samples per channel.
- **EKF source-set encoder.** `MAV_CMD_SET_EKF_SOURCE_SET` (command id
  42007) ships as a typed encoder under `src/lib/protocol/encoders/`.
  ArduPilot accepts the command at runtime to swap between SRC1, SRC2,
  and SRC3. PX4 has no runtime equivalent; the Navigation tab disables
  the switcher on PX4 firmware and points the operator at the
  parameter-write path instead.
- **Three new MAVLink decoders.** `OPTICAL_FLOW_RAD` (msg id 106),
  `VISION_POSITION_ESTIMATE` (msg id 102), `ODOMETRY` (msg id 331).
  Each decoder lands under `src/lib/protocol/messages/` with its
  CRC_EXTRA wired into the parser table and a typed callback on the
  `DroneProtocol` interface. The mock protocol gets matching stubs so
  every consumer works in demo mode.
- **`NavigationCapability` flag.** Added to the per-drone capability
  store at `src/stores/agent-capabilities-store.ts`. The capability is
  reported by the agent's heartbeat when the vision-nav plugin is
  installed and enabled. The drone-card pill at
  `src/components/shared/drone-card.tsx` renders a small `Nav` chip
  when the capability is present so the fleet view shows at a glance
  which drones have vision navigation active.
- **Pre-arm vision channel.** A new pre-arm helper batches the FC
  parameter writes the vision-nav plugin needs (FLOW_TYPE,
  EK3_SRC1_*, EK3_FLOW_DELAY, EK3_FLOW_QUAL_MIN, RNGFND1_*) and
  verifies each one read back correctly before reporting success.
  PX4 has a matching helper for the EKF2_OF_* parameter set.
- **Capability-token bridge gains per-drone scope.** Tokens minted by
  `cmdPluginCapabilityTokens.mintToken({pluginInstallId, deviceId})`
  carry the agent id as a claim. The bridge at
  `src/lib/plugins/bridge.ts` validates that the token's agent id
  matches the currently-selected drone on every plugin RPC; cross-drone
  RPCs are rejected before they reach the agent.
- **i18n keys for the Navigation tab and the per-drone Plugins tab.**
  16 non-English locales receive parity entries. Real translations are
  a follow-up for the community translation pipeline.

### Changed

- The Plugins surface is split into two views. Settings -> Plugins is
  the fleet view; the drone detail panel's Plugins tab is the
  per-drone view. Both read from `cmd_pluginInstalls` with different
  filters.
- `cmd_pluginInstalls` Convex table amends `droneId` from optional to
  required. A new compound index `by_user_drone_plugin` powers the
  per-drone list. No production migration is needed because no
  production installs predate this release.

## [0.17.1] - 2026-05-14

### Changed

- Command sidebar UX cleanup. The "Pair New Node" button moved from
  the footer to a top strip so it's the first row below the header.
  The redundant horizontal divider that used to render above the
  Nodes group when no cloud-paired drones existed is gone — the
  divider now only appears when there's content above it to separate
  from. The collapsed (narrow) sidebar now renders LAN-paired nodes
  alongside cloud-paired ones; previously the rail hid every local
  agent until the operator expanded the sidebar. Each LAN-paired
  icon in the collapsed rail carries a small accent dot top-left so
  it reads distinctly from cloud-paired entries at a glance.
- Collapsed-rail clicks now share the same LAN-vs-cloud branching as
  the expanded list. A new `src/lib/agent/node-click-handler.ts`
  exports a single `selectNode` helper that both surfaces call;
  HTTPS origins still route LAN-paired nodes through the cloud relay
  (mixed-content guard), HTTP origins prefer the direct REST path.

## [0.17.0] - 2026-05-14

### Added

- LAN-first code pair. Entering a 6-character pair code now scans the
  local network over mDNS (`_ados._tcp.local.`), probes each candidate
  for its current pair code, and claims the match directly. No cloud
  relay round-trip needed when the agent is on the same LAN, so code
  pair works against a fresh-installed agent even when its outbound
  cloud beacon is disabled. The Convex `claimPairingCodeAnon` path
  remains as a cross-network fallback for cases where the agent has
  beaconing enabled and the GCS is off-LAN.
- New `/api/lan-pair/discover` route, Node-side mDNS browser via
  `bonjour-service`. Returns the LAN-visible ADOS agents with mDNS
  host, IPv4, and port within a 3-second discovery window. Same
  private-host whitelist as the existing probe route.

### Changed

- All pair-flow calls (`probe`, `claim`, `unpair`) now go through the
  Mission Control proxy regardless of origin. The browser-side direct
  fetch path is gone — browsers without mDNS resolution (Safari with
  some link-local DNS configs, Brave's strict privacy mode, Firefox
  without permission) used to hit "Failed to fetch" when the user
  pasted a `*.local` hostname. The Node-side resolver speaks mDNS, so
  the proxy hop fixes the gap. Pair is a one-off operation, so the
  extra round-trip is invisible to perceived latency.
- Better error when the LAN scan finds nothing AND the Convex
  fallback rejects the code: the new `codeNoLanMatchError` message
  names the two conditions to check (same Wi-Fi, beacon enabled on
  the agent) instead of the generic "Invalid pairing code".

## [0.16.1] - 2026-05-14

### Fixed

- Clicking a node on an HTTPS origin no longer hangs indefinitely on
  "Waiting for agent connection..." when the cloud relay path can't reach
  the agent (agent not cloud-paired, or user not signed in). After 15
  seconds without a heartbeat, the spinner is replaced with an actionable
  error card explaining the two options: open Mission Control from the
  LAN URL for direct mode, or sign in and pair the agent with a
  6-character code to enable cloud relay.

## [0.16.0] - 2026-05-14

### Fixed

- Clicking a locally-paired node in the Command sidebar from an HTTPS
  origin now routes through the cloud relay instead of failing silently.
  The prior direct REST path tripped browser mixed-content protection
  (`https://` page → `http://<host>:8080` fetch), the fetch was rejected,
  and the error was swallowed by the click handler's try/catch. The
  Overview tab was the visible casualty — it never rendered because the
  agent status never populated. The handler now detects an HTTPS origin
  and subscribes to the agent heartbeat through Convex `cmd_droneStatus`
  by `deviceId`, which is populated by the agent regardless of pair
  flavor. HTTP origins (desktop, localhost) still use the faster direct
  REST path.
- Connection errors raised inside the sidebar click handler now surface
  in the connection bar instead of being swallowed by the catch block.

### Changed

- Command sidebar terminology renamed from "drone" to "node". An ADOS
  agent can run as a drone agent, ground agent, compute agent, relay
  agent, or receiver agent — the umbrella term in the UI is now "node".
  Each row shows the specific agent type as a subtitle, derived from
  the heartbeat profile (`Drone Agent · Raspberry Pi 4B`,
  `Ground Agent · ROCK 5C Lite`, etc.). The renamed copy lands in all
  16 locale files; non-English locales carry the English string until
  a translation pass runs.
- The NodeSidebar section below the cloud-paired list collapses its
  five per-profile groups into a single flat "Nodes" list. With per-row
  agent-type labels, the extra group headers were redundant for the
  typical two-to-five node case.
- The empty "No nodes paired" CTA above the NodeSidebar now hides when
  the NodeSidebar has any local-paired nodes to render. The prior
  layout showed a misleading "Pair Your First Node" prompt above a
  populated list when the user wasn't signed in.

## [0.10.6] - 2026-05-07

### Added

- Fleet drone card now surfaces a small amber "auto" pill when the agent
  reports that its profile was picked by hardware auto-detection rather
  than an operator. Three values trigger the pill: `detected` (clean
  fingerprint match), `tiebreaker` (auto with ambiguous signals), and
  `default` (no detect signals, fell back). Profiles set by an operator
  in the setup webapp or forced via `/etc/ados/board_override` render
  no pill, matching the prior layout for legacy heartbeats.
- Cloud heartbeat schema accepts two new optional fields, `setupState`
  and `profileSource`, so the universal setup contract on the agent
  side has a place to land in the cloud relay. Both flow into the
  per-drone capability store. `profileSource` also syncs into the
  `cmd_drones` row alongside `runtimeMode` and `attachedDisplayType`
  so the fleet card renders the pill without an extra per-drone query.

## [0.10.5] - 2026-05-06

### Fixed

- Desktop release pipeline now builds the macOS DMG. The `@xmldom/xmldom`
  override pinned the package to `^0.9.10`, whose strict-mode parser
  rejects `parseFromString(content)` calls without a mime type. That
  broke `electron-builder`'s plist parser end of `app-builder-lib`,
  which relies on the older lenient API. Override relaxed to `^0.8.10`
  so the security-patched `0.8.x` line ships and the build pipeline
  succeeds. No source code imports `@xmldom/xmldom` directly; this
  override only affected transitive consumers.

## [0.10.4] - 2026-05-06

Headline fix: the desktop app no longer hangs as a hidden process when the
embedded server fails to start. Plus a wide pass on the firmware tab, plugin
host foundation, fleet overview, and the Hardware tab.

### Fixed

- Desktop app now opens its window reliably on macOS and Windows. Previously,
  if the embedded Next.js standalone server failed to start within the
  startup timeout, the window-creation path was never reached and the app
  sat as a hidden process with no way to recover. Three changes close this:
  - `app.whenReady()` is wrapped so any startup failure surfaces an error
    dialog and the app exits cleanly instead of leaving a windowless process.
  - The window force-shows on `did-finish-load` and `did-fail-load` so a
    renderer that loads but never emits `ready-to-show`, or a page that
    fails to load, no longer leaves the user staring at a dock icon.
  - Server-startup wait reduced from 30s to 15s so genuine failures surface
    quickly instead of feeling like the app is frozen.
- Single-instance lock now hard-exits the secondary process instead of
  letting initialization continue past `app.quit()`.
- Windows installer events (`--squirrel-install`, `--squirrel-updated`,
  `--squirrel-uninstall`, `--squirrel-obsolete`) exit the app immediately
  so installer-spawned processes do not linger as windowless background apps.

### Added

- **ADOS agent stack support in the firmware tab.** Flash the agent
  software stack alongside flight-controller firmware, with a Rockchip
  bootrom flasher for ADOS-class companion computers. The agent manifest
  is signed with minisign and verified at install time; an offline catalog
  UI lets operators pick a build without a live network connection. Schema
  versioning on the manifest keeps older clients compatible.
- **Fleet overview** with live video and telemetry on the Command page.
  Multiple drones at a glance, with each card pulling its own status,
  battery, GPS fix, runtime mode, and live preview.
- **Plugin host foundation** for ADOS plugins. Settings page exposes a
  Plugins tab with an installed-plugins list and a registry browser. The
  slot orchestrator mounts each plugin contribution into a sandboxed
  iframe gated on a `ui.slot.*` capability. Two-stage install dialog
  parses the manifest and shows the permission set before commit, with
  partial-grant failure surfaces and pinned required permissions.
- **Hardware tab** surfaces attached SPI displays at the fleet level and
  on individual drone cards. The tab populates from the agent's
  `profile` and `hardware-check` payloads, and `runtimeMode` propagates
  through the capability inference fallback path so older agents without
  an explicit field still gate features correctly.
- **Setup-and-access integration** end-to-end with the agent. The Command
  page consumes the universal setup contract (status, access URLs,
  remote-access state) and surfaces it with cloud-relay enhancements.
- **CLI service-management and production-deployment wizard** for
  self-hosted Convex backends.
- `/pair` deep link now accepts a pre-filled pairing code, simplifying
  field setup from a printed sticker or QR.
- Camera-trigger toggle on simulation drones, with sync-performance
  improvements while the toggle runs.
- Conditional planner UI render based on whether a plan is active, idle,
  loaded, or dirty.

### Changed

- **Capability inference** now covers BCM2710A1 (Pi Zero 2 W), BCM2711
  (Pi 4B), BCM2712 (Pi 5), RV1106G3 (Luckfox class), and RV1103 SoCs,
  with NPU TOPS lookup for each.
- **Runtime-mode propagation:** `runtimeMode` flows from the agent
  heartbeat through `cmd_droneStatus` and `cmd_drones` into the
  capability store. The fleet card renders a small "Lite" pill for
  drones running the constrained backend; Smart Modes, ROS, and Scripts
  tabs hide on lite-mode drones.
- **Cloud-relay HTTP routes** moved behind internal Convex functions,
  with input validation, response size limits, and safety overrides on
  every command-path entry.
- **Cloud-command gating:** the GCS no longer enqueues cloud commands
  when the user is not authenticated.
- **Convex skip-guards** added across the Command page so reactive
  queries no longer crash when auth or runtime context is absent.
- **Locale-aware number rendering** for currency, percent, and decimal
  values; telemetry freshness now flags stale data older than 45s.
- **Zustand store hardening:** added version + migrate handlers across
  persisted stores; previously `any`-typed surfaces now use Zod schemas
  for runtime validation.
- iNav mock protocol corrections and roadmap-copy refresh in locales.

## [0.10.1] - 2026-05-05

Companion release for the lightweight Rust agent backend. Surfaces a
"Lite" pill on the fleet card and hides UI surfaces the lite backend
does not ship.

### Added
- Fleet card renders a small "Lite" badge next to the drone name when
  the agent reports `runtimeMode: "lite"`. Visible at a glance so
  operators know the drone is running the constrained backend.
- `runtimeMode` field on the `cmd_droneStatus` table and on the
  `cmd_drones` table. The status push handler propagates the value
  from heartbeats into the paired-drone row so reactive consumers
  pick it up without a second query. Schema additions are
  optional / backward-compatible; existing clients see `undefined`
  and default to "full".
- `runtimeMode` field on the `AgentCapabilities` interface and the
  `agent-capabilities-store`. The capability normalizer accepts
  either `runtimeMode` or `runtime_mode` from agent payloads.
- SoC-to-NPU table entries for BCM2710A1 (Pi Zero 2 W), BCM2711
  (Pi 4B / CM4), BCM2712 (Pi 5), RV1106G3 (Luckfox Pico Zero),
  and RV1103 (Luckfox Pico) so capability inference does not return
  null for those targets.

### Changed
- `useVisibleTabs` excludes the Smart Modes, ROS, and Scripts
  Command-page sub-tabs when `runtimeMode === "lite"`. The lite
  backend does not ship the plugin host, peripheral manager,
  scripting tier, or ROS integration; offering those tabs would lead
  to broken handlers.
- `FleetDrone` and `CloudDroneBridge` carry the `runtimeMode`
  field through to the fleet store so the drone card can read it
  without subscribing to a per-drone status query.
- The Calibrate, Parameters, and Configure tabs on the drone-detail
  panel are intentionally NOT gated. They serve all backend variants
  including lite (FC connection works on lite) and stay visible.

### Notes
- The lite Rust agent codebase lives at `agents/lite-rs/` in the
  ADOSDroneAgent repository. CI publishes prebuilt signed binaries
  to GitHub Releases. Operators install the lite backend with
  `ADOS_PROFILE=lite-rs` set as an environment variable on the
  install.sh invocation.

## [0.9.11] - 2026-05-04

This release lands universal-setup integration on the GCS side and
a security + reliability sweep on the cloud-relay surface.

### Added

- **Setup-and-access card.** New shared component at
  `src/components/hardware/SetupAccessCard.tsx`. Reads the agent's
  `/api/v1/setup/status` (or, when no agent is connected locally,
  the most recent cloud-relay snapshot) and shows completion
  percent, the next-action sentence, MAVLink / video / remote-access
  state, and direct links to the agent's setup webapp and any
  advertised tunnel URL.
- **Disconnected-state setup handoff.** The Hardware Overview empty
  state now surfaces "Open setup" when the cloud relay carries an
  advertised setup URL for any drone the operator has paired,
  alongside the existing "Connect ground station" action.
- **Agent client `getSetupStatus()`** at `src/lib/agent/client.ts`
  with a `SetupStatusSchema` zod schema validating the full
  response tree (`SetupStep`, `SetupAccessUrl`, `MavlinkAccess`,
  `VideoAccess`, `RemoteAccessStatus`, `NetworkStatus`).
- **Cloud-relay schema** carries absolute URLs from the agent:
  `setupUrl`, `apiUrl`, `missionControlUrl`, `videoWhepUrl`,
  `mavlinkWsUrl`, and `remoteAccess`. Both `convex/schema.ts` and
  `convex/cmdDroneStatus.ts` accept the new fields, and
  `convex/http.ts` ingests them. The Command fleet store, the
  CloudStatusBridge mapper, and the agent video-session hook
  prefer the absolute URLs over rebuilding from `lastIp + port`.
- **`feat(command)`**: fleet overview tile with live video and
  telemetry. `CommandFleetOverview.tsx` now renders an inline
  WHEP video preview alongside the per-drone telemetry chips,
  driven by the new absolute-URL plumbing on the agent side.
- **`feat(simulation)`**: camera-trigger toggle. Sim drones now
  publish trigger events the planner consumes, with sync-perf
  improvements on the playback path.
- **`feat(planner)`**: conditional UI render based on the active
  plan. Idle / loaded / dirty states diverge cleanly so the
  planner does not animate empty panels on cold start.
- **`feat(cli)`**: production-deployment wizard and service-
  management subcommands on the `altnautica-command` CLI. Prompts
  walk through TLS, MQTT, video-relay, and Convex bindings; the
  service subcommand wraps `systemctl` for the standard units.
  Public-docs entry at `docs/cli-reference.md` and self-hosting
  guide updated.
- **`AGENTS.md`** with agentic-coding instructions for AI contributors.

### Changed

- **Hardware Overview poll on `/api/v1/setup/status`** gained a
  visibility guard so it pauses while the tab is hidden, matching
  the ground-station poll on the same page.
- **CommandFleetOverview** prefers absolute `videoWhepUrl` and
  `mavlinkWsUrl` advertised by the agent before falling back to
  the previous `lastIp + port` reconstruction.

### Fixed

- **`fix(cloud-relay)`**: agent-facing HTTP routes are now backed
  by Convex internal mutations only. External callers can no
  longer reach the heartbeat write path directly.
- **`fix(CloudStatusBridge)`**: the bridge no longer enqueues
  cloud commands when the user is unauthenticated; previously a
  silent failure path could fire commands during sign-out.
- **`fix(use-agent-video-session)`**: null-check before assigning
  `srcObject` to the video element. Closes a TypeError on disconnect.
- **`fix`**: prevent connection attempt when `whepUrl` is missing.
  The video pipeline used to fire WebRTC negotiation against
  `undefined` after a partial cloud-status snapshot.
- **`fix(ui)`**: escape quotes in UI text and clean up test mocks
  flagged by the linter.
- **`fix`**: input validation, response limits, and safety overrides
  on the agent-facing surface. Bounds requests that previously
  could wedge the relay on malformed payloads.

### Notes

- Pairs with ADOS Drone Agent v0.10.0 (universal setup contract).
- Mission Control still consumes `lastIp + port` as a fallback so
  older agents continue to work without re-pairing.
- Convex schema is in sync with the website's `convex/schema.ts`
  per the dual-Convex convention.
