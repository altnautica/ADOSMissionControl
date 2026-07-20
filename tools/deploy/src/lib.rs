//! `ados-deploy` — a Rust TUI that self-hosts the full Altnautica ADOS cloud
//! stack (Mission Control + Convex + MQTT + video relay) in one guided flow,
//! looking and behaving like the drone-agent installer.
//!
//! The `ui` + pure `wizard::{frame,render,widgets}` + `graph` + `exec` modules
//! are vendored from `ados-installer` (see `.vendor-sha`); the terminal backend
//! (`ui::tty`) is rewritten on `crossterm` for macOS / Windows / Linux. The
//! deploy-specific surface (menu, wizard screens, the turnkey state machine,
//! docker/env orchestration, asset export) is new.

pub mod checks;
pub mod cli;
pub mod ctx;
pub mod deploy;
pub mod docker;
pub mod env;
pub mod env_files;
pub mod exec;
pub mod graph;
pub mod host;
pub mod menu;
pub mod result;
pub mod services;
pub mod shell;
pub mod ui;
pub mod wizard;
