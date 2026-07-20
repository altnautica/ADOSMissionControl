//! Terminal-UI asset export: turn the real `compose()` grid into standalone SVG
//! and HTML assets for docs, the website, and the deployment guide. Because it
//! consumes the same styled grid the live TUI renders, the asset IS the real UI.

pub mod ansi_cells;
pub mod html;
pub mod svg;

pub use html::{to_document, to_player, to_pre};
pub use svg::to_svg;
