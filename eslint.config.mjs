import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
  {
    ignores: [
      "convex/_generated/**",
      "convex-tutorial/**",
      "coverage/**",
      "release/**",
      // Vendored, minified third-party bundles copied into public/ at build
      // time. They are not our source and trip rules-of-hooks on their own
      // minified identifiers, so linting them is noise.
      "public/cesium/**",
      "public/monaco-vs/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
  {
    // React's concurrent-render features are wrong for a continuously-mutating
    // telemetry store, not merely unhelpful.
    //
    // `useDeferredValue` never settles on a value that changes every tick: the
    // background render is interruptible and restarts from scratch each time the
    // input moves, so a 35 Hz channel produces an unbounded chain of discarded
    // renders and the deferred value can lag arbitrarily far behind. Wrapping a
    // telemetry write in `startTransition` is worse: `useSyncExternalStore`'s
    // contract has React re-read the snapshot a second time before commit during
    // a Transition and, when the value moved, restart the update as blocking --
    // which over a store that ticks continuously is every tick. The net effect is
    // wasted render passes plus a forced synchronous commit.
    //
    // The right primitive for this data is the rAF-coalesced version bump in
    // `src/stores/telemetry-store.ts`, which collapses every push inside one
    // frame into a single notification. Concurrent features stay legal for
    // genuinely bursty user-initiated work (a typed filter, a mission-plan
    // recompute) -- that is why this restriction is scoped to the live-telemetry
    // surfaces rather than applied app-wide.
    files: [
      "src/stores/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/components/cockpit/**/*.{ts,tsx}",
      "src/components/hud/**/*.{ts,tsx}",
      "src/components/flight/**/*.{ts,tsx}",
      "src/components/indicators/**/*.{ts,tsx}",
      "src/components/vision/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useDeferredValue", "startTransition"],
              message:
                "Concurrent features do not converge on a continuously-mutating telemetry value: useDeferredValue restarts its background render on every tick and startTransition forces a blocking re-commit through useSyncExternalStore. Coalesce with the rAF version bump in src/stores/telemetry-store.ts instead. If this is bursty user-initiated work rather than telemetry, put it outside these directories.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(startTransition|useDeferredValue)$/]",
          message:
            "Concurrent features do not converge on a continuously-mutating telemetry value. Coalesce with the rAF version bump in src/stores/telemetry-store.ts instead.",
        },
        {
          selector: "CallExpression[callee.name='useTransition']",
          message:
            "useTransition on a telemetry surface schedules a Transition per tick, which useSyncExternalStore then restarts as a blocking update. Coalesce with the rAF version bump in src/stores/telemetry-store.ts instead.",
        },
      ],
    },
  },
  {
    // Test files mount throwaway stub components (icon and child mocks) that
    // never reach a real render tree, so a missing display name is harmless.
    files: ["tests/**/*.{ts,tsx}", "src/**/__tests__/**/*.{ts,tsx}"],
    rules: {
      "react/display-name": "off",
    },
  },
];

export default eslintConfig;
