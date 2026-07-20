//! The plain renderer: one escape-free line per group transition.
//!
//! Used when stderr is not a terminal (CI, piped, redirected), `TERM=dumb`, or
//! `--plain`. No color, no animation, no cursor control — every line is
//! immutable and grep-friendly. The `quiet` variant suppresses the per-step
//! lines and prints only the final summary.

use std::sync::mpsc::Receiver;

use crate::ui::events::{GroupMap, ProgressEvent};
use crate::ui::model::{fmt_dur, GStatus, Group, Model};
use crate::ui::summary;

/// Run the plain renderer to completion. Consumes events until `Finished`.
pub fn run(rx: Receiver<ProgressEvent>, quiet: bool, header: String, groups: GroupMap) {
    if !quiet {
        eprintln!("{header}");
    }
    let mut model = Model::new(groups);
    while let Ok(ev) = rx.recv() {
        match ev {
            ProgressEvent::StepStarted { id } => {
                model.start(&id);
            }
            ProgressEvent::StepResult { id, outcome } => {
                if let Some(idx) = model.record(&id, &outcome) {
                    if !quiet {
                        eprintln!("{}", group_line(&model, idx));
                    }
                }
            }
            ProgressEvent::SubProgress { id, done, total } => {
                model.set_sub(&id, done, total);
            }
            // Detailed logs always go to the journal; the plain stream stays the
            // clean per-group transition log, so live-detail + Log events are not
            // echoed here.
            ProgressEvent::Activity { .. }
            | ProgressEvent::SubLog { .. }
            | ProgressEvent::ByteProgress { .. }
            | ProgressEvent::Log { .. } => {}
            ProgressEvent::Summary(s) => {
                for line in summary::plain_lines(&s) {
                    eprintln!("{line}");
                }
            }
            ProgressEvent::Finished => break,
        }
    }
}

/// `[ok]   Building radio stack            (00:42)` — a finalized group line.
fn group_line(model: &Model, idx: usize) -> String {
    let g: &Group = &model.groups[idx];
    let mark = match g.status {
        GStatus::Ok => "[ok]  ",
        GStatus::Skipped => "[skip]",
        GStatus::Failed => "[FAIL]",
        _ => "[..]  ",
    };
    let detail = match g.status {
        GStatus::Skipped => "already configured".to_string(),
        _ => g
            .elapsed
            .map(|d| format!("({})", fmt_dur(d)))
            .unwrap_or_default(),
    };
    let step = model.finalized();
    let total = model.total();
    format!(
        "{mark} {label:<26} {detail}  [{step}/{total}]",
        label = g.label
    )
}
