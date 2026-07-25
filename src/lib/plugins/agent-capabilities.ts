/**
 * Mirror of the ADOSDroneAgent agent capability catalog.
 *
 * TypeScript copy of the agent-side capability catalog. The agent is the
 * source of truth; this mirror exists so the GCS can render label +
 * description + risk metadata for agent-side capability ids when the install
 * dialog parses a `.adosplug` manifest locally (the cloud-relay path does not
 * consult the agent before showing the pre-install review).
 *
 * The catalog data is generated from `capabilities.toml` by
 * `ados-capabilities-codegen`, which emits the same catalog for Python, Rust,
 * and TypeScript so the three cannot drift. The generated data lives in
 * `./agent-capabilities.generated`; this module re-exports it. Edit the TOML
 * and regenerate, never the generated file.
 *
 * Drift detection also runs through `tests/unit/capability-catalog-parity.test.ts`.
 *
 * @license GPL-3.0-only
 */

export { AGENT_CAPABILITY_CATALOG } from "./agent-capabilities.generated";
