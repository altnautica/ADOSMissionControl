# AGENTS.md - ADOS Mission Control

Agentic coding instructions for ADOS Mission Control, the open-source browser
and desktop ground control station.

## Purpose

Work in this repository as an engineering agent for the GCS application. Keep
changes practical, typed, demo-compatible, and focused on the operator workflow
being touched.

## Read First

- Check `git status --short` before edits and preserve unrelated changes.
- Inspect the nearest existing component, store, hook, protocol type, or test
  before introducing a new pattern.
- Use `npm run demo` for UI work unless the task needs real hardware behavior.
- Keep demo mode working for new features. Add mock params, mock telemetry, or
  mock protocol stubs when the changed UI needs them.
- Prefer targeted verification over broad checks when a focused command proves
  the change.

## Stack and Commands

- Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, Zustand 5,
  Convex, Electron 35. License GPL-3.0-only.
- Dev server port: `4000` for dev, demo, and production.
- Protocol: custom MAVLink v2 binary parser and encoder behind the
  `DroneProtocol` abstraction, plus an MSPv1/MSPv2 codec with iNav decoders and
  a name-based settings client.
- Surface size: ~64 Zustand stores with ring-buffered telemetry, ~58 FC
  configuration panels, 83 MAVLink message decoders, 33 `MAV_CMD` handlers.
- Firmware support: ArduPilot, PX4, Betaflight, and iNav.
- Common commands:

```bash
npm run dev
npm run demo
npm run build
npm run lint
npm test -- --run
npm run desktop:dev
```

- Useful focused commands:

```bash
npm test -- --run path/to/test
npx eslint path/to/file.ts path/to/file.tsx
npm run typecheck
npm run generate:agent-types
```

Use the focused commands first when they cover the touched surface. Run
`npm run build` for changes that affect routing, dynamic imports, generated
types, Convex usage, or production-only behavior.

## Architecture Map

- App routes: `src/app/`
- Shared UI: `src/components/ui/`
- FC panels: `src/components/fc/*Panel.tsx`
- Indicators: `src/components/indicators/*Indicator.tsx`
- Stores: `src/stores/*-store.ts`, with large stores split into domain slices.
- Agent connection: `src/stores/agent-connection/` and `src/lib/agent/`
- Ground station state: `src/stores/ground-station/`
- Protocol types: `src/lib/protocol/types/`
- MAVLink messages: `src/lib/protocol/messages/`
- Encoders: `src/lib/protocol/encoders/`
- Pattern generators: `src/lib/patterns/*-generator.ts`
- Simulation: `src/components/simulation/`, `src/app/simulate/`,
  `src/lib/terrain/`, and related stores.
- Electron wrapper: `electron/`
- Convex functions: `convex/`
  Schema is ~42 tables (7 auth plus ~35 custom) and is a community subset of
  the full platform schema. `cmd_*` files are GCS-exclusive (drones, pairing,
  missions, preferences, AI usage, ADS-B). Shared files such as `profiles.ts`,
  `comments.ts`, and `communityChangelog.ts` are duplicated for self-hosting
  independence, so a change to one must be mirrored. `convex/_generated/` is
  committed; regenerate with `npx convex dev` after editing `convex/`.
- Self-host deployer: `tools/deploy/` (`ados-deploy`, run with `npm run deploy`
  or `tools/deploy/deploy.sh`) is the canonical way to stand up the whole stack
  (Convex, Mission Control, MQTT, video relay). Keep it current when services,
  ports, env vars, or compose wiring change: `src/services.rs` for ports and
  service names, `src/wizard/state.rs` for config and derived URLs,
  `src/env_files.rs` for generated env, `src/deploy/steps.rs` for the state
  machine. A new service means a new step, group, and reach-links row. Gates:
  `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`.
  Generated secrets go only to gitignored files or `npx convex env set`, never
  to source, logs, snapshots, or fixtures. Example screens use placeholders
  such as `mycompany-fleet`, `192.168.1.50`, and `fleet.example.com`.

Keep code files near 300 lines when practical. Split files before they become
hard to review, except generated files, fixtures, data tables, and vendored
code.

## Coding Rules

- Keep TypeScript strict. Avoid `any`; use explicit domain types or `unknown`
  with narrowing at boundaries.
- Interactive App Router components need `"use client"` at the top.
- Flight-controller operations go through the `DroneProtocol` interface.
  Components should not call protocol-specific MAVLink or MSP helpers directly.
- FC panels that read or write parameters use `usePanelParams`, shared panel UI,
  armed-state locking, and unsaved-change guards.
- Telemetry time series use bounded ring buffers. Do not store unbounded arrays
  for live telemetry.
- Subscribe to Zustand stores with selectors. Avoid broad `useStore()` calls in
  React components.
- Convex queries must pass `"skip"` when auth, demo mode, or runtime context is
  unavailable.
- Keep generated API types generated. When Drone Agent OpenAPI changes are
  intentionally consumed here, use the project script instead of hand-editing
  generated types.
- ArduPilot writes `PARAM_SET` straight to EEPROM. `commitParamsToFlash()`
  fires `MAV_CMD_PREFLIGHT_STORAGE` as a belt-and-braces step and is
  fire-and-forget; never block on its ACK.
- Real hardware is the primary test target. Demo mode exists for UI
  development, not as the assumed environment.
- Persisted Zustand stores wrapped in `persist({ name, version, ... })` also
  export a `migrate(persisted, version)` handler. Bump `version` and add a
  branch the moment the persisted shape changes.

## UI Rules

- Use the shared `<Select>` component for dropdowns, not native `<select>`.
- Use design tokens and dark-theme variables. Avoid hardcoded colors.
- Keep operator workflows dense, readable, and stable under live telemetry
  updates.
- Guard destructive or flight-affecting actions with clear disabled states,
  armed-state locks, or confirmation flows matching nearby panels.
- Keep loading, empty, disconnected, and demo states explicit.
- Avoid layout shifts from changing telemetry values. Use stable dimensions for
  gauges, counters, maps, video panes, and toolbars.

## File Conventions

| Type | Naming | Location |
|---|---|---|
| FC panel component | `PascalCase` + `Panel` | `src/components/fc/` |
| Indicator component | `PascalCase` + `Indicator` | `src/components/indicators/` |
| Zustand store | `kebab-case` + `-store` | `src/stores/` |
| Store sub-slices | `kebab-case-(slice\|store).ts` | `src/stores/<domain>/` |
| Custom hook | `use-kebab-case` | `src/hooks/` |
| Protocol types | per-concern files | `src/lib/protocol/types/` |
| MAVLink decoder | message handlers | `src/lib/protocol/messages/`, registered in `mavlink-parser.ts` |
| MAVLink encoder | per-concern files | `src/lib/protocol/encoders/`, re-exported via the `mavlink-encoder.ts` barrel |
| Firmware handler | `<name>.ts` | `src/lib/protocol/firmware/` |
| Board profile | entry in `board-profiles.ts` | `src/lib/board-profiles.ts` |
| Mock params / protocol | entries in the mock modules | `src/mock/mock-params.ts`, `src/mock/mock-protocol.ts` |
| Drawing, patterns, terrain, formats, validation, transforms | `kebab-case` | `src/lib/<area>/` |

Decomposition examples to follow: `src/stores/ground-station-store.ts` and
`src/stores/settings-store.ts` are barrels re-exporting per-concern slices,
`src/components/command/SystemTab.tsx` composes sub-panels, and
`src/components/onboarding/WelcomeModal.tsx` composes per-step components.
Mark an intentional exemption with `// Exempt from 300 LOC soft rule: <reason>`.

## Key Files

| To understand | Read |
|---|---|
| Protocol abstraction | `src/lib/protocol/types/core.ts` |
| MAVLink parsing and encoding | `src/lib/protocol/mavlink-parser.ts`, `mavlink-encoder.ts`, `mavlink-adapter.ts` |
| Firmware behavior | `src/lib/protocol/firmware/{ardupilot,px4,betaflight,inav}.ts` |
| FC panel param loading | `src/hooks/use-panel-params.ts` |
| Connection lifecycle | `src/stores/drone-manager.ts` (`ManagedDrone`, `bridgeTelemetry()`) |
| Telemetry and ring buffer | `src/stores/telemetry-store.ts`, `src/lib/ring-buffer.ts` |
| Demo mode | `src/mock/engine.ts`, `src/mock/mock-protocol.ts`, `src/mock/mock-params.ts` |
| Board profiles and timer groups | `src/lib/board-profiles.ts`, `src/components/fc/motors/TimerGroupDiagram.tsx` |
| Shared panel UI and utilities | `src/components/fc/shared/PanelHeader.tsx`, `src/lib/utils.ts` |
| Planning and patterns | `src/lib/drawing/`, `src/lib/patterns/`, `src/lib/terrain/terrain-provider.ts` |
| Mission I/O and validation | `src/lib/formats/`, `src/lib/validation/mission-validator.ts`, `src/lib/transforms/` |
| Fences and rally points | `src/stores/geofence-store.ts`, `src/stores/rally-store.ts` |
| Cloud, MQTT, and video | `src/components/command/CloudStatusBridge.tsx`, `MqttBridge.tsx`, `src/lib/video/mse-player.ts` |
| Agent connection state | `src/stores/agent-connection-store.ts` and siblings |

## Checklists

**New FC panel.** Create `src/components/fc/MyNewPanel.tsx` with `"use client"`.
Define module-level `paramNames` (and optional `optionalParams`) constants, call
`usePanelParams({ paramNames, optionalParams, panelId, autoLoad: false })`,
render through `PanelHeader`, edit with `setLocalValue()`, persist with
`saveAllToRam()` then `commitToFlash()`. Add one `{ name, value, type: 9 }` mock
param per parameter, wire the panel into the configuration tab navigation, add
`useArmedLock()`, and smoke it in `npm run demo`.

**New MAVLink decoder.** Add the message ID and `CRC_EXTRA` to the CRC map in
`mavlink-parser.ts`, add a decoder case reading little-endian fields from the
`DataView`, define the callback type under `src/lib/protocol/types/`, add
`onMyNew()` to `DroneProtocol`, implement the callback array and emit in
`mavlink-adapter.ts`, add a stub in `src/mock/mock-protocol.ts`, add an encoder
when the message is outbound, and bridge telemetry through `bridgeTelemetry()`.

**New Zustand store.** Create `src/stores/my-new-store.ts`, define state and
action interfaces, use plain `create<State>()` unless middleware is genuinely
needed, use `RingBuffer<T>` with a fixed capacity for telemetry, add `clear()`
for connection reset, wire into `bridgeTelemetry()` if it receives protocol
callbacks, and consume it with selectors.

**New indicator.** Create `src/components/indicators/MyNewIndicator.tsx` with
`"use client"`, subscribe with a selector, use `useTelemetryFreshness()` for
stale-data detection, keep it small and single-concern, and use the
`text-status-{success,warning,error}` tokens.

**New board profile.** Add a `BoardProfile` entry in `src/lib/board-profiles.ts`,
set `boardIds` from the ArduPilot hwdef board config for auto-detection, map
every output to its STM32 timer group in `timerGroups`, set `protocols` per
group (`PWM`, `DShot`, or `Both`), add `outputNotes` for special pads, and
verify the timer-group diagram renders correctly.

**New pattern generator.** Create a pure function in
`src/lib/patterns/my-pattern-generator.ts`, define its config in
`src/lib/patterns/types.ts`, return a `PatternResult`, register it in
`src/lib/patterns/index.ts`, and add controls plus preview rendering in the
planner components.

**New file format.** Add a parser (and exporter) in `src/lib/formats/`, register
detection and export in `src/lib/mission-io.ts`, add the UI option in
`src/components/planner/MissionActions.tsx`, and handle coordinate order:
KML is `lon,lat,alt` while waypoints are `lat,lon`.

## Gotchas

- `getParameter()` returns `{ value, type, index, count }`, not a number.
- All mock params use `type: 9` (`MAV_PARAM_TYPE_REAL32`), matching real
  ArduPilot behavior even for integer-valued params.
- `paramNames` must be a stable module-level constant. `usePanelParams`
  memoizes on the array reference, so an inline array causes infinite
  re-renders. `readonly string[]` means `as const` works without spreading.
- `optionalParams` fail silently and do not set error state. Use them for
  params that exist only on some firmware builds.
- A wrong `CRC_EXTRA` makes every frame for that message fail CRC silently.
- `RingBuffer.toArray()` allocates a new array on every call. Do not call it in
  a render path without memoization.
- `isDemoMode()` checks both `NEXT_PUBLIC_DEMO_MODE=true` and `?demo=true`.
  Never import from `src/mock/` in a production code path.
- Cloud mode auto-activates on HTTPS; plain HTTP connects directly to the agent.
- The MSE player hardcodes `video/mp4; codecs="avc1.640029"`; changing the relay
  output codec means changing that string. MQTT connects in-browser over the
  broker WebSocket URL resolved from `clientConfig`.
- WebSerial is Chromium-only. Feature-detect `navigator.serial` before offering
  it.
- Zustand `getState()` is synchronous: use it in callbacks and event handlers,
  and selectors in components.
- Electron uses `127.0.0.1` everywhere, never `localhost`: macOS can resolve
  `localhost` to `::1` and the standalone server listens on IPv4 only. No proxy
  layer is needed for the standalone build.
- The terrain provider caches by lat/lon rounded to four decimals and falls back
  to elevation 0 offline. Pattern generators are pure functions with no store
  access. The drawing manager is not a React component; it talks to the Leaflet
  map instance directly and is cleaned up on unmount.

## Working in the Open

This is a public, open-source repository. Every commit, diff, and branch is
visible the moment it is pushed and stays in history permanently, so a mistake
cannot be un-published by deleting it later. Review what a change actually
contains before committing.

- **Never commit secrets.** API keys, tokens, deploy keys, passwords, private
  certificates, and `.env` files stay out of the tree. Generated secrets belong
  only in gitignored files. If a secret does land in a commit, treat it as
  compromised and rotate it.
- **Never commit real deployment detail.** Hostnames, IP addresses, tunnel
  names, device identifiers, and account names from a live setup are an attack
  surface. Use placeholders such as `example-oem`, `cloud.example.com`,
  `192.168.1.50`, and `mycompany-fleet`.
- **Never commit other people's data.** Personal names, email addresses,
  customer or employer names, real flight logs and GPS traces, and raw log
  dumps that contain any of the above do not belong in a public repository.
- **Tests are published too.** Fixtures, mock payloads, golden and snapshot
  files, sample JSON, and locale strings get the same care as source.
- **Respect licensing when bringing in outside code.** Third-party source is
  vendored into a vendor directory with its license intact and is never pasted
  into our own modules.
- **Keep contributions technical.** Architecture, APIs, commands, schemas,
  configuration, hardware interfaces, deployment, and troubleshooting.
  Commercial, pricing, or roadmap commentary does not belong in the codebase.
- **Comments, log strings, commit messages, and PR titles are public too.** Keep
  them bland, factual, and technical.

## Verification

- UI-only change: run focused ESLint for touched files and focused Vitest when
  behavior changed.
- Store, hook, parser, protocol, terrain, or simulation logic: add or update
  focused Vitest coverage and run it.
- Route, build config, dynamic import, Convex, or Electron change: run
  `npm run build`; add `npm run electron:compile` for Electron-only changes.
- Demo-visible workflow: smoke with `npm run demo` when practical.
- Browser flow with real interactions: use Playwright only for the affected
  route or workflow.

Before finalizing, run `git diff --check` and report any skipped checks.

## Review Expectations

When reviewing, list findings first and focus on behavior regressions,
performance leaks, memory leaks, missing demo coverage, unsafe flight-control
flows, state churn, and missing tests. Cite file and line references.

For implementation work, keep changes scoped to the touched workflow and verify
the smallest surface that proves the fix.

## Cross-Repo Impact

- Drone Agent API or telemetry shape changes may require generated API type
  updates and UI state handling here.
- Documentation changes may be needed when setup, API behavior, operator
  workflows, or troubleshooting steps change.
- Extension host changes must preserve declared slots, permissions, and stable
  host contracts for `ADOSExtensions`.

## Related Public Projects

- [ADOS Drone Agent](https://github.com/altnautica/ADOSDroneAgent) - companion
  and ground-node agent that Mission Control can connect to.
- [ADOS Documentation](https://github.com/altnautica/Documentation) - public
  docs for user and developer workflows.
