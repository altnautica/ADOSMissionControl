# Contributing to Altnautica Command

Thank you for your interest in contributing to Altnautica Command — an open-source ground control station for ArduPilot and multi-protocol drone fleets.

Altnautica Command is licensed under the [GNU General Public License v3.0](LICENSE). By contributing, you agree that your contributions will be licensed under GPLv3.

---

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **npm** — bundled with Node.js
- **Git**
- **Chrome 89+** — required for WebSerial (hardware connection). Firefox and Safari do not support WebSerial.

---

## Development Setup

```bash
git clone https://github.com/altnautica/ADOSMissionControlGCS.git
cd ADOSMissionControlGCS
npm install
npm run demo    # Start with 5 simulated drones (recommended for development)
npm run dev     # Start without demo data
npm run build   # Production build
npm run lint    # Run ESLint
```

Open [http://localhost:4000](http://localhost:4000) in Chrome.

**Demo mode** (`npm run demo`) runs a full mock flight engine with 5 simulated drones, telemetry streams, and pre-arm check outputs. Use this for UI development — no hardware required.

---

## Project Structure

```
ADOSMissionControlGCS/
├── src/
│   ├── app/                  # Next.js App Router pages
│   ├── components/
│   │   ├── fc/               # Flight controller panels (CalibrationPanel, PidTuningPanel, etc.)
│   │   ├── indicators/       # Telemetry indicator widgets
│   │   ├── planner/          # Mission planner components
│   │   ├── map/              # Map components (Leaflet)
│   │   └── library/          # Shared UI primitives
│   ├── hooks/                # Custom React hooks
│   ├── lib/
│   │   └── protocol/         # MAVLink parser, encoder, adapter, messages
│   └── stores/               # Zustand stores
├── public/
└── ...
```

---

## Code Style and Conventions

### TypeScript
- **Strict mode is on** — no `any` types. Use `unknown` and narrow explicitly.
- Explicit return types on all public APIs and exported functions.
- Prefer `interface` for object shapes, `type` for unions and aliases.

### Styling
- **Tailwind v4** — CSS-first configuration with design tokens.
- No arbitrary values (`w-[347px]`) where a design token exists. Use the token.
- Dark-first — all components must look correct on the dark theme.

### State Management
- **Zustand** for all application state. One store per domain.
- **Ring buffers** for telemetry data (telemetry-store) — fixed-size circular arrays to cap memory usage.
- Never use `useState` for data that needs to be shared across components. Put it in a store.
- Store files live in `src/stores/`. One file per store.

### Protocol Layer
- **`DroneProtocol` interface** is the only entry point for FC communication — never import MAVLink primitives directly from components or stores.
- All panel writes go through `protocol.setParameter()`.
- ArduPilot auto-saves parameters to EEPROM on `PARAM_SET` (confirmed from `GCS_Param.cpp`). You do not need to call `commitParamsToFlash()` for ArduPilot, but the call is retained as a belt-and-suspenders measure for non-ArduPilot firmware.

### FC Panels
- Every FC panel uses the **`usePanelParams` hook** to load parameters.
- Split param lists into `requiredParams` and `optionalParams` — panels must not fail to load when optional params are absent from the firmware.
- Use `PanelHeader`, `PanelLoadingSkeleton`, and `PanelErrorState` shared components.
- Wrap write operations in `DisconnectGuard` (prevents writes when connection is lost) and `useArmedLock` (prevents writes when vehicle is armed) where appropriate.

---

## How to Add an FC Panel

1. Create `src/components/fc/YourPanel.tsx`.
2. Use the `usePanelParams` hook with separate `requiredParams` and `optionalParams` arrays:
   ```tsx
   const { params, loading, error } = usePanelParams({
     required: ['PARAM_ONE', 'PARAM_TWO'],
     optional: ['OPTIONAL_PARAM'],
   });
   ```
3. Render `<PanelLoadingSkeleton />` while `loading`, `<PanelErrorState />` on `error`.
4. Use `<PanelHeader title="Your Panel" />` at the top.
5. Write parameters with `protocol.setParameter('PARAM_NAME', value)`.
6. Add your panel to the sidebar navigation in the FC configure tab.
7. Wrap destructive or safety-critical writes with `<DisconnectGuard>` and check `useArmedLock`.

---

## How to Add a MAVLink Message Decoder

1. **CRC_EXTRA** — Add the message ID and CRC_EXTRA byte to the lookup table in `src/lib/protocol/mavlink-parser.ts`.
2. **Decode** — Add a `decode<MessageName>()` function in `src/lib/protocol/mavlink-messages.ts`. Return a typed object matching the MAVLink field layout.
3. **Dispatch** — Add a `case MSG_ID:` branch to the dispatch switch in `src/lib/protocol/mavlink-adapter.ts`. Emit to the appropriate Zustand store or invoke a callback.
4. **Encode** (if sending) — Add an `encode<MessageName>()` function in `src/lib/protocol/mavlink-encoder.ts`. Follow the existing byte-packing pattern using `DataView`.

Test by enabling the MAVLink Inspector panel in the UI — it shows all incoming raw messages.

---

## How to Add a New Indicator

1. Create the component in `src/components/indicators/YourIndicator.tsx`.
2. Read state from the appropriate Zustand store (`telemetry-store`, `sensor-health-store`, `diagnostics-store`, etc.). Do not accept telemetry data as props.
3. Keep indicators stateless and reactive — they should re-render automatically when store state changes.
4. Export from `src/components/indicators/index.ts`.

---

## Pull Request Guidelines

- Fork the repo and create a feature branch from `main`. Use a descriptive branch name: `feat/rc-trim-panel`, `fix/mavlink-heartbeat-timeout`.
- Keep PRs focused — **one feature or fix per PR**. Large PRs are hard to review and slow to merge.
- Write a clear description: what changed, why it changed, and how to test it.
- **Test with `npm run demo`** to verify your changes work against simulated drone data.
- **Test with real hardware** if your changes touch the protocol layer, calibration flows, or any pre-arm check logic.
- Run `npm run build` — ensure no TypeScript compilation errors.
- Run `npm run lint` — ensure no ESLint errors.
- Do not bump `package.json` version yourself — maintainers handle releases.

---

## Issue Reporting

Use [GitHub Issues](https://github.com/altnautica/ADOSMissionControlGCS/issues) for bugs and feature requests.

**For bug reports, include:**
- Browser and version (must be Chrome 89+ for WebSerial features)
- Operating system
- Firmware type and version (ArduPilot, Betaflight, iNav) if hardware-related
- Steps to reproduce
- Expected vs actual behavior
- Screenshot or screen recording if the issue is visual
- MAVLink Inspector output if the issue is protocol-related

**For feature requests, include:**
- The use case you are trying to solve
- What firmware / hardware you are targeting
- Any reference implementations (QGC, Mission Planner, Betaflight Configurator)

---

## License

By contributing to Altnautica Command, you agree that your contributions will be licensed under the [GNU General Public License v3.0](LICENSE).
