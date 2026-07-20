# CLAUDE.md — Altnautica Command GCS

> Agentic coding instructions for AI coding agents. See [README.md](README.md) for architecture and features. See [CONTRIBUTING.md](CONTRIBUTING.md) for PR guidelines.

---

## Quick Context

- **Stack:** Next.js 16 (App Router) + React 19 + Zustand 5 + Tailwind v4 + TypeScript strict
- **Protocol:** Custom MAVLink v2 binary parser/encoder, `DroneProtocol` abstraction interface
- **Stores:** ~64 Zustand stores with ring-buffered telemetry. Larger stores are split into per-domain slices under `src/stores/<domain>/` and re-exported from a thin aggregator file (see ground-station and settings).
- **Node detail (profile-aware):** the Dashboard is central command for every agent profile. The per-node detail panel is `NodeDetailPanel` (`src/components/dashboard/node-detail/`), a profile -> surface registry: the visible tabs are resolved from the node's profile (drone / ground-station / compute / future) + role + capabilities via `surfaces.ts` (`resolveSurfaces`), and an unknown/future profile falls back to the universal companion surfaces. A drone shows Overview / Parameters / Flights / Configure (+ Radio / Vision when present) and the companion strip (Agent / System / Black Box / Plugins, lock-badged teasers on an FC-only drone). A ground-station shows its role-gated surfaces (Overview / Radio / Network / Mesh / Distributed RX / Display / Physical UI / Peripherals) plus System / Black Box / Plugins. A surface is a `SurfaceSpec { id, labelKey, when?, locked?, render }` referencing existing components from `src/components/command/*`, `src/components/drone-detail/*`, and the ground-station node folder; `src/components/dashboard/DroneDetailPanel.tsx` re-exports `NodeDetailPanel`. There is no separate Command tab or `/command` route (it redirects to `/`). Agent state bridges + the pairing dialog mount once in `CommandShell`. Behaviors (Follow-Me, Orbit, thermal, gimbal, etc.) ship as per-drone plugins installed from the extensions registry.
- **FC panels:** ~58 configuration panel components plus shared infra
- **MAVLink:** 83 message decoders, 33 MAV_CMD handlers
- **MSP:** MSPv1 + MSPv2 codec, ~65 iNav-specific decoders, ~15 encoders, name-based settings client
- **Firmware:** ArduPilot (full), PX4 (full), Betaflight (full), iNav (full)
- **Desktop:** Electron 35 wrapper for native distribution
- **Port:** 4000 (dev, demo, and production)
- **License:** GPL-3.0-only

```bash
npm run dev          # Dev server, no demo data
npm run demo         # Dev server with a simulated mixed-profile fleet
npm run build        # Production build
npm run lint         # ESLint
npm test -- --run    # Vitest unit + component tests
npm run desktop:dev  # Electron desktop dev mode
```

---

## Convex Backend

The `convex/` directory contains the standalone backend for cloud features (auth, fleet, community, missions, ADS-B cache). Community users can deploy their own backend with `npx convex dev`.

- **Schema:** ~42 tables (7 auth + ~35 custom, including `cmd_droneStatus` and `cmd_droneCommands` for cloud relay). Community subset of the full Altnautica schema.
- **`cmd_*` files** are GCS-exclusive functions (drones, pairing, missions, preferences, AI usage, ADS-B).
- **Shared files** (`profiles.ts`, `comments.ts`, `communityChangelog.ts`, etc.) are duplicated from `website/convex/` for OSS independence.
- **`community-api.ts` and `community-api-drones.ts`** use typed imports from `convex/_generated/api`.
- **`convex/_generated/`** is committed per Convex best practice. Regenerate with `npx convex dev` if you modify `convex/` files.
- **For the hosted version:** the website project's `convex/` directory is the superset deployment that both apps share at runtime. Changes to shared functions must be synced between both directories.

---

## Deploying / self-hosting — `ados-deploy` (tools/deploy)

The **Rust TUI at `tools/deploy/`** (`ados-deploy`, run via `npm run deploy` or the `tools/deploy/deploy.sh` one-liner) is the **canonical, supported way to self-host the whole stack** (Convex + Mission Control + MQTT + video relay) and to run/build the app. It supersedes the old Node `cli/`.

- **Keep it current with the stack.** When services, ports, env vars, or compose wiring change (`tools/selfhost/docker-compose.yml`, `.env.example`, `convex/clientConfig.ts`, `src/lib/config/endpoints.ts`), update the deployer to match: `src/services.rs` (ports + service names), `src/wizard/state.rs` (config + derived URLs), `src/env_files.rs` (generated env), `src/deploy/steps.rs` (the state machine). A new service means a new step + group + reach-links row. This toolkit is meant to evolve with the platform, not rot.
- **Never leak secrets.** The deployer GENERATES the Convex instance secret, JWT/JWKS, and MQTT password; they go ONLY to gitignored files (`tools/selfhost/.env`, `passwd`, `docker-compose.override.yml`) via `env_files::write_secret_file` (which refuses a non-gitignored path) or to `npx convex env set` — NEVER printed to committable logs, hardcoded in source, or baked into a snapshot/fixture. `--plan` output is secret-redacted. This repo is PUBLIC: no infra hostnames/IPs, partner/business content.
- **Example + asset screens use generic placeholders** (`mycompany-fleet`, `192.168.1.50`, `fleet.example.com`) — never real infrastructure. The `examples/ui_gallery` assets and any docs screenshots follow this.
- **Gates:** `cargo test` + `cargo clippy --all-targets -- -D warnings` + `cargo fmt --check` (CI: `.github/workflows/deploy-tui.yml`, cross-platform). Convex self-hosted targeting is env-var-based (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`, clean child env), not `--url/--admin-key` flags.

---

## File Conventions

| Type | Naming | Location |
|------|--------|----------|
| FC panel component | `PascalCase` + `Panel` suffix | `src/components/fc/` |
| Indicator component | `PascalCase` + `Indicator` suffix | `src/components/indicators/` |
| Zustand store | `kebab-case` + `-store` suffix | `src/stores/` |
| Store sub-slices | `kebab-case-(slice|store).ts` | `src/stores/<domain>/` |
| Custom hook | `use-kebab-case` | `src/hooks/` |
| Protocol types | per-concern files | `src/lib/protocol/types/` |
| MAVLink decoder | message handlers | `src/lib/protocol/messages/`, registered in `mavlink-parser.ts` |
| MAVLink encoder | per-concern files | `src/lib/protocol/encoders/` (re-exported via `mavlink-encoder.ts` barrel) |
| Firmware handler | `<name>.ts` | `src/lib/protocol/firmware/` (e.g. `ardupilot.ts`, `px4.ts`, `betaflight.ts`, `inav.ts`) |
| Board profile | in `board-profiles.ts` | `src/lib/board-profiles.ts` |
| Mock params | in `mock-params.ts` | `src/mock/mock-params.ts` |
| Mock protocol | in `mock-protocol.ts` | `src/mock/mock-protocol.ts` |
| Drawing utilities | `kebab-case` | `src/lib/drawing/` |
| Pattern generators | `kebab-case-generator` | `src/lib/patterns/` |
| Terrain utilities | `kebab-case` | `src/lib/terrain/` |
| File format handlers | `kebab-case` | `src/lib/formats/` |
| Mission validation | `kebab-case` | `src/lib/validation/` |
| Mission transforms | `kebab-case` | `src/lib/transforms/` |

---

## Core Rules

These are non-negotiable. Violating any of these will break the codebase or waste review cycles.

1. **Always go through `DroneProtocol`** — Never call MAVLink or MSP functions directly from components. All FC operations go through the `DroneProtocol` interface (`src/lib/protocol/types/core.ts`). The adapter pattern is the entire architecture.

2. **Use `usePanelParams` for FC panels** — Every panel that reads/writes FC parameters must use the `usePanelParams` hook (`src/hooks/use-panel-params.ts`). It handles batched loading, retry, dirty tracking, RAM writes, and flash commit. Never call `protocol.getParameter()` / `protocol.setParameter()` directly from panel components.

3. **Ring buffers for telemetry** — All time-series telemetry data uses `RingBuffer<T>` (`src/lib/ring-buffer.ts`). Never use unbounded arrays for telemetry. A 30-minute flight at 10 Hz = 18,000 entries per channel — without ring buffers, memory grows without bound.

4. **Mock everything in demo mode** — Every new feature must work in demo mode (`npm run demo`). New FC panels need mock params in `src/mock/mock-params.ts` (type: 9 for all). New protocol methods need stubs in `src/mock/mock-protocol.ts`. Check `isDemoMode()` from `src/lib/utils.ts` when needed.

5. **No `any` types** — TypeScript strict mode is on. Use proper types. The `DroneProtocol` interface, callback types, and store types are all fully typed. If you need a type, it probably already exists under `src/lib/protocol/types/` (per-concern files: `core.ts`, callbacks, capabilities, etc.) or in domain-specific modules under `src/lib/` (the old central `src/lib/types.ts` aggregator has been scattered into domain modules).

6. **Dark-first UI** — All components use the dark theme CSS variables. Background: `bg-surface-primary` (near-black). Text: `text-text-primary` (white). Accent: `text-accent-primary` (electric blue). Never use hardcoded colors. Never use `bg-white` or `text-black`.

7. **Safety guards are mandatory** — Any panel that writes params must respect `use-armed-lock` (blocks writes while armed) and `use-unsaved-guard` (warns on navigation with dirty params). Use `PanelHeader` (`src/components/fc/shared/PanelHeader.tsx`) for consistent loading/error/refresh UI.

8. **ArduPilot auto-saves to EEPROM** — `PARAM_SET` triggers `vp->save()` to EEPROM immediately (confirmed from ArduPilot `GCS_Param.cpp`). `commitParamsToFlash()` fires `MAV_CMD_PREFLIGHT_STORAGE` as belt-and-suspenders but is fire-and-forget (no blocking ACK wait). Never block on the flash commit ACK.

9. **`"use client"` on all interactive components** — Next.js App Router defaults to Server Components. Any component that uses hooks, event handlers, or browser APIs needs the `"use client"` directive at the top. All FC panels, indicators, and store consumers are client components.

10. **Zustand selectors — subscribe to what you need** — Use `useStore((s) => s.field)` selector pattern, not `useStore()` which re-renders on any state change. For protocol access: `useDroneManager((s) => s.getSelectedProtocol)`.

11. **All dropdowns use `<Select>` from `@/components/ui/select`** — Never use native `<select>` elements. The custom component renders a portal dropdown with keyboard navigation, viewport-aware positioning, and dark theme styling. For large option lists (>15 items), enable `searchable`. For options that benefit from explanation, add `description` to option objects. For categorized options, use `SelectOptionGroup[]`. All option values must be strings.

12. **Real hardware first** — Never assume demo mode, mock data, or SITL as the default environment. The primary test target is real flight controller hardware (SpeedyBee F405, real ArduPilot). Debug with real connections. Demo mode exists for UI development only.

---

## Code File Size Convention (Soft Rule)

Soft target: 300 lines per `.ts` / `.tsx` file. Hard target: 500 lines.

When a file crosses 300 lines, decide:
1. **Decompose** into per-domain sub-files under `src/<area>/<topic>/` and re-export from a thin aggregator at the original path. Callers keep working with no import changes.
2. **Mark as data-file exempt** by adding a top-of-file comment like `// Exempt from 300 LOC soft rule: <reason>`. Pure data tables, mock fixtures, and self-contained protocol clients are reasonable exemptions.
3. **Defer** for a later round if neither makes sense yet.

The soft rule is a prompt to think, not a blocker. Tests, type generation, and vendored third-party source are out of scope.

Established decomposition examples to follow:
- `src/stores/ground-station-store.ts` is a barrel that re-exports from `src/stores/ground-station/` (per-concern slices: link, pair, uplink, mesh, peripherals).
- `src/stores/settings-store.ts` is a barrel that re-exports from `src/stores/settings/` (per-domain slices: display, network, auth, command-tab, video).
- `src/components/command/SystemTab.tsx` composes sub-panels under `src/components/command/system/`.
- `src/components/onboarding/WelcomeModal.tsx` composes per-step components under `src/components/onboarding/steps/`.

---

## Checklist: New FC Panel

1. Create `src/components/fc/MyNewPanel.tsx` with `"use client"` directive
2. Define `paramNames` array and optional `optionalParams` array for all FC parameters the panel reads
3. Call `usePanelParams({ paramNames, optionalParams, panelId: "my-new-panel", autoLoad: false })`
4. Use `PanelHeader` component with `loading`, `loadProgress`, `hasLoaded`, `error`, `missingOptional`, and `onRead: refresh`
5. Render param values from the `params` Map. Use `setLocalValue()` for edits, `saveAllToRam()` for save, `commitToFlash()` for flash
6. Add mock params to `src/mock/mock-params.ts` — one `{ name, value, type: 9 }` entry per parameter
7. Wire the panel into the FC configuration tab navigation (check existing panels for the pattern)
8. Add `useArmedLock()` — disable all writes when the vehicle is armed
9. Test in demo mode: `npm run demo` → navigate to the panel → "Read from FC" → edit → save → flash
10. If the panel needs a new protocol method, follow the "New MAVLink Decoder" checklist below

---

## Checklist: New MAVLink Message Decoder

1. Add the message ID and `CRC_EXTRA` to the CRC map in `src/lib/protocol/mavlink-parser.ts`
2. Add a decoder case in the parser's `decodePayload()` switch — extract fields from the `DataView` using little-endian reads
3. Define the callback type under `src/lib/protocol/types/` (typically in `core.ts` or the appropriate per-concern file, e.g., `export type MyNewCallback = (data: { ... }) => void`)
4. Add `onMyNew(callback: MyNewCallback): () => void` to the `DroneProtocol` interface
5. Implement the callback array + emit in `src/lib/protocol/mavlink-adapter.ts`
6. Add the stub implementation in `src/mock/mock-protocol.ts` (return `() => {}` for the unsubscribe)
7. If the message needs encoding (outbound), add the encoder function in `src/lib/protocol/mavlink-encoder.ts`
8. Bridge into a Zustand store via `bridgeTelemetry()` in `src/stores/drone-manager.ts` if it's telemetry data

---

## Checklist: New Zustand Store

1. Create `src/stores/my-new-store.ts`
2. Define the state interface and actions interface
3. Use `create<State>()` from `zustand` — no middleware unless genuinely needed
4. For telemetry data: use `RingBuffer<T>` with a fixed capacity (e.g., 1000 for 10 Hz × 100s)
5. Add a `clear()` method for connection reset
6. Wire into `bridgeTelemetry()` in `src/stores/drone-manager.ts` if the store receives protocol callbacks
7. Use selectors in consuming components: `useMyNewStore((s) => s.specificField)`

---

## Checklist: New Indicator Component

1. Create `src/components/indicators/MyNewIndicator.tsx` with `"use client"` directive
2. Subscribe to the relevant store with a selector
3. Use `useTelemetryFreshness()` hook for stale-data detection if the indicator shows live telemetry
4. Follow the existing indicator pattern: small, self-contained, single concern
5. Use status colors: `text-status-success` (green), `text-status-warning` (yellow), `text-status-error` (red)

---

## Checklist: New Board Profile

1. Add a new `BoardProfile` entry in `src/lib/board-profiles.ts`
2. Set `boardIds` from ArduPilot `AP_HAL_ChibiOS/hwdef/` board config for auto-detection
3. Map all outputs to their STM32 timer groups in `timerGroups` (each sub-array = outputs sharing a timer)
4. Set `protocols` per group: `'PWM'`, `'DShot'`, or `'Both'`
5. Add `outputNotes` for special outputs (solder pads, LED pads, etc.)
6. Test: connect to the board (or mock it) → open OutputsPanel → verify timer group diagram renders correctly

---

## Key Files

When you need to understand a system, read these files:

| To understand... | Read |
|-----------------|------|
| Protocol abstraction | `src/lib/protocol/types/core.ts` — `DroneProtocol` interface, every FC operation |
| MAVLink binary parsing | `src/lib/protocol/mavlink-parser.ts` — CRC_EXTRA map, frame decoder; per-message decoders in `src/lib/protocol/messages/` |
| MAVLink binary encoding | `src/lib/protocol/mavlink-encoder.ts` — barrel re-export from `src/lib/protocol/encoders/` |
| MAVLink adapter | `src/lib/protocol/mavlink-adapter.ts` — `DroneProtocol` implementation for MAVLink |
| Firmware-specific behavior | `src/lib/protocol/firmware/ardupilot.ts`, `px4.ts`, `betaflight.ts`, `inav.ts` — mode maps, capabilities, param names |
| FC panel param loading | `src/hooks/use-panel-params.ts` — `PanelParamOptions` interface, batch loading, dirty tracking |
| Connection lifecycle | `src/stores/drone-manager.ts` — `ManagedDrone`, `bridgeTelemetry()`, add/remove/select |
| Telemetry stores | `src/stores/telemetry-store.ts` — ring-buffered attitude, position, battery, GPS, etc. |
| Ring buffer | `src/lib/ring-buffer.ts` — `RingBuffer<T>` class (70 lines) |
| Demo mode engine | `src/mock/engine.ts` — a simulated mixed-profile fleet (drones + compute + ground station), realistic flight data |
| Mock FC protocol | `src/mock/mock-protocol.ts` — full `DroneProtocol` impl for demo mode |
| Mock parameters | `src/mock/mock-params.ts` — ~200 realistic ArduCopter params (all type: 9) |
| Board profiles | `src/lib/board-profiles.ts` — 9 board profiles, STM32 timer groups |
| Timer group diagram | `src/components/fc/motors/TimerGroupDiagram.tsx` — visual timer group conflict detection |
| Shared panel UI | `src/components/fc/shared/PanelHeader.tsx` — loading/error/refresh header for all FC panels |
| Utility functions | `src/lib/utils.ts` — `cn()`, `isDemoMode()`, `formatDate()`, `clamp()` |
| Drawing tools | `src/lib/drawing/drawing-manager.ts` — Leaflet polygon/circle/measure drawing |
| Geodetic math | `src/lib/drawing/geo-utils.ts` — polygon area, centroid, clipping, offset |
| Pattern generators | `src/lib/patterns/survey-generator.ts`, `orbit-generator.ts`, `corridor-generator.ts` |
| Pattern store | `src/stores/pattern-store.ts` — active pattern, preview, apply to mission |
| GSD calculator | `src/lib/patterns/gsd-calculator.ts` — camera profiles, GSD/footprint/spacing |
| Terrain provider | `src/lib/terrain/terrain-provider.ts` — Open Elevation API with LRU cache |
| Geofence protocol | `src/stores/geofence-store.ts` — fence upload/download, polygon/circle |
| Rally points | `src/stores/rally-store.ts` — rally point CRUD + protocol upload/download |
| Mission validation | `src/lib/validation/mission-validator.ts` — pre-upload checks |
| File formats | `src/lib/formats/kml-parser.ts`, `src/lib/formats/csv-handler.ts` — KML/KMZ/CSV I/O |
| Mission transforms | `src/lib/transforms/mission-transforms.ts` — move/rotate/scale |
| Cloud status bridge | `src/components/command/CloudStatusBridge.tsx` — Convex reactive query → agent store |
| MQTT bridge | `src/components/command/MqttBridge.tsx` — Browser MQTT client for real-time telemetry |
| MSE video player | `src/lib/video/mse-player.ts` — WebSocket to MediaSource Extensions player |
| Agent store (cloud mode) | `src/stores/agent-connection-store.ts` — Cloud/local agent connection state (with `agent-system-store`, `agent-peripherals-store`, `fleet-network-store`) |

---

## Checklist: New Pattern Generator

1. Create `src/lib/patterns/my-pattern-generator.ts` — pure function, no side effects
2. Define config interface in `src/lib/patterns/types.ts`
3. Return `PatternResult` with waypoints array and stats
4. Add to dispatcher in `src/lib/patterns/index.ts`
5. Add UI controls in `src/components/planner/PatternEditor.tsx`
6. Add preview rendering in `src/components/planner/PatternOverlay.tsx`
7. Test: draw boundary → select pattern → configure → generate → apply → verify waypoints

---

## Checklist: New File Format

1. Create parser in `src/lib/formats/my-format.ts` — `parse(text/buffer): Waypoint[]`
2. Create exporter if needed — `export(waypoints): string/Blob`
3. Add format detection to `src/lib/mission-io.ts` `importMissionFile()` (by file extension)
4. Add export function call in `src/lib/mission-io.ts`
5. Add UI option in `src/components/planner/MissionActions.tsx`
6. Handle coordinate order differences (KML uses lon,lat; we use lat,lon)

---

## Gotchas

- **Always skip Convex queries when context is unavailable** — Any hook that calls `useQuery(communityApi.*.*)` MUST pass `"skip"` as the second argument when Convex is unavailable or in demo mode. Pattern: `useQuery(ref, !isDemoMode() && convexAvailable ? {} : "skip")`. Apply this guard in every hook that wraps a Convex query that depends on auth or runtime context. Never call `useQuery(ref)` with no skip guard -- it crashes when auth context doesn't exist.
- **`getParameter()` returns `{ value, type, index, count }`** — not just a number. Access `.value` for the numeric value.
- **All mock params use `type: 9`** (`MAV_PARAM_TYPE_REAL32`). Even integer-valued params like `FLTMODE1` are stored as floats — this matches real ArduPilot behavior.
- **`paramNames` must be stable** — `usePanelParams` memoizes on the array reference. Define `paramNames` as a module-level `const`, not inline in the component. Otherwise you get infinite re-render loops. The hook accepts `readonly string[]`, so `as const` arrays work without spreading.
- **Persisted Zustand stores need `version` + `migrate`** — Every store wrapped in `persist({ name, version, ... })` should also export a `migrate(persisted, version)` handler. Identity passthrough is fine while the schema is stable, but bump `version` and add a branch the moment the persisted shape changes. Without `migrate`, the next user load silently throws away or breaks on the old payload. Reference: `src/stores/settings-store/migrations.ts` for a real chain (currently at version 32) and `src/stores/drone-metadata-store.ts` for the inline-branch shape.
- **`optionalParams` fail silently** — They don't trigger error state when the FC doesn't have them. Use for params that exist on some firmware builds but not others (e.g., `CAM1_*`, `MNT1_*`, `BATT2_*`).
- **WebSerial is Chrome-only** — `navigator.serial` exists only in Chromium browsers (Chrome 89+, Edge 89+). Feature-detect before offering the option.
- **`commitParamsToFlash()` is fire-and-forget** — Do not `await` and check for ACK success. ArduPilot doesn't reliably ACK `MAV_CMD_PREFLIGHT_STORAGE`. The `usePanelParams` hook handles this correctly already.
- **CRC_EXTRA must match the MAVLink XML** — If you add a new message decoder and the CRC_EXTRA is wrong, every frame for that message will silently fail CRC validation and be dropped. Use the MAVLink generator or reference the XML definition.
- **Ring buffer `.toArray()` copies** — It returns a new array every call. Don't call it in render paths without memoization.
- **`isDemoMode()` checks both env var and URL param** — `NEXT_PUBLIC_DEMO_MODE=true` or `?demo=true` in the URL. Either activates the mock engine.
- **Never import from `src/mock/` in production code paths** — Mock modules should only be loaded when `isDemoMode()` is true. Use dynamic imports or conditional requires.
- **Cloud mode auto-activates on HTTPS** — When `window.location.protocol === "https:"`, the GCS uses cloud relay instead of direct agent HTTP. On plain HTTP (local dev), it connects directly.
- **MQTT connects over a tunnel** — the broker WebSocket URL is resolved from `clientConfig` (managed default in `src/lib/config/endpoints.ts`) and routes to Mosquitto's WebSocket listener (port 9001). The `mqtt.js` client connects in-browser with MQTTv5.
- **MSE player assumes H.264 AVC1** — The codec string `video/mp4; codecs="avc1.640029"` is hardcoded in `mse-player.ts`. Changing the video relay's ffmpeg output codec requires updating this string.
- **Zustand `getState()` is synchronous** — Use it in callbacks and event handlers. Use selectors (`useStore(s => s.field)`) in React components for reactivity.
- **Electron: no proxy needed for standalone** — The Next.js standalone server serves `/_next/static/*` natively when `.next/static/` is copied into the standalone directory. No HTTP proxy layer required. `server.ts` just forks the standalone server on a single port. Always use `127.0.0.1` (not `localhost`) to avoid IPv6 resolution issues on macOS.
- **Electron: always use `127.0.0.1`** — `window.ts`, `main.ts`, and `server.ts` all use `127.0.0.1` instead of `localhost`. macOS can resolve `localhost` to `::1` (IPv6), causing ECONNREFUSED when the server only listens on IPv4.
- **KML uses lon,lat order** — KML coordinates are `lon,lat,alt`. Leaflet and our Waypoint type use `lat,lon`. Always swap when importing/exporting KML.
- **Terrain provider caching** — `terrain-provider.ts` uses an LRU cache keyed by rounded lat,lon (4 decimal places). Cache hit rate is high for survey patterns where many waypoints are close together. Falls back to elevation 0 when offline.
- **Pattern generators are pure functions** — They take config objects and return waypoint arrays. No store access, no side effects. This makes them testable and composable.
- **Drawing manager is not a React component** — `drawing-manager.ts` interfaces directly with the Leaflet map instance. It's instantiated in a `useEffect` in `PlannerMap.tsx` and cleaned up on unmount.
