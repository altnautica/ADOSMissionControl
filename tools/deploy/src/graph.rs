//! The step graph — the core ordering engine the whole crate exists to
//! guarantee.
//!
//! Steps declare their dependencies (`requires`) by id. The graph topologically
//! orders them (stable, deterministic) and runs each only when *all* of its
//! dependencies have succeeded. The load-bearing invariant: when a **Required**
//! step fails, no later step runs — the install aborts cleanly and writes a
//! result naming the failure, rather than charging ahead into a half-installed
//! state. Optional failures are recorded (the install degrades) but do not
//! abort the run.

use std::collections::{BTreeMap, BTreeSet};

use crate::ctx::Ctx;

/// Whether a step's failure is fatal to the install.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepKind {
    /// Failure aborts the install (status → `failed`); later steps do not run.
    Required,
    /// Failure degrades the install (status → `degraded`); the run continues.
    Optional,
}

/// The result of running (or not running) a single step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepOutcome {
    /// The step did its work successfully.
    Ok,
    /// The step had nothing to do (e.g. checkpoint already marked, or the step
    /// does not apply to this profile). Treated as success for dependents.
    Skipped,
    /// The step failed, with a human-readable reason.
    Failed(String),
}

/// A single install step. Implementors are unit structs (no per-step state);
/// all mutable state lives in [`Ctx`].
pub trait Step {
    /// Stable, unique step id (also the failure-report key).
    fn id(&self) -> &str;
    /// Ids of the steps that must succeed before this one runs.
    fn requires(&self) -> &[&str];
    /// The checkpoint name this step marks on success, if any. A step with a
    /// marked checkpoint is skipped (unless `--force`).
    fn checkpoint(&self) -> Option<&str>;
    /// Whether a failure is Required (fatal) or Optional (degrading).
    fn kind(&self) -> StepKind;
    /// Do the step's work, returning [`StepOutcome::Ok`] on success,
    /// [`StepOutcome::Skipped`] when there is nothing to do (already
    /// checkpointed or not applicable to this profile), or
    /// [`StepOutcome::Failed`] with a reason.
    fn run(&self, ctx: &mut Ctx) -> StepOutcome;
}

/// Why a graph could not be ordered (a programming error in the step set, not
/// a runtime install failure).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GraphError {
    /// A step's `requires` names an id no step in the set provides.
    #[error("step {step:?} requires unknown step {missing:?}")]
    UnknownRequire { step: String, missing: String },
    /// The dependency edges form a cycle.
    #[error("dependency cycle detected among steps: {0:?}")]
    Cycle(Vec<String>),
    /// Two steps share an id.
    #[error("duplicate step id {0:?}")]
    DuplicateId(String),
}

/// The per-step result of a graph run, for inspection (tests + the final
/// result write). Order matches execution order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepReport {
    /// The step id.
    pub id: String,
    /// What happened to the step.
    pub outcome: StepOutcome,
}

/// Topologically order the step ids by their `requires` edges. Stable: among
/// steps with no ordering constraint, the original insertion order is
/// preserved (a deterministic Kahn's algorithm over a sorted-but-insertion-keyed
/// ready set). Returns the ordered ids, or a [`GraphError`] for an unknown
/// require / cycle / duplicate id.
pub fn topo_order(steps: &[Box<dyn Step>]) -> Result<Vec<String>, GraphError> {
    // Insertion index per id (defines the stable tiebreak).
    let mut index: BTreeMap<String, usize> = BTreeMap::new();
    for (i, s) in steps.iter().enumerate() {
        if index.insert(s.id().to_string(), i).is_some() {
            return Err(GraphError::DuplicateId(s.id().to_string()));
        }
    }

    // Validate requires + build the indegree + adjacency.
    let mut indegree: BTreeMap<String, usize> = BTreeMap::new();
    let mut dependents: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for s in steps {
        indegree.entry(s.id().to_string()).or_insert(0);
        for req in s.requires() {
            if !index.contains_key(*req) {
                return Err(GraphError::UnknownRequire {
                    step: s.id().to_string(),
                    missing: req.to_string(),
                });
            }
            *indegree.entry(s.id().to_string()).or_insert(0) += 1;
            dependents
                .entry(req.to_string())
                .or_default()
                .push(s.id().to_string());
        }
    }

    // Kahn's algorithm. The ready set drains in insertion order so the result
    // is stable across runs.
    let mut ready: Vec<String> = indegree
        .iter()
        .filter(|(_, &d)| d == 0)
        .map(|(id, _)| id.clone())
        .collect();
    ready.sort_by_key(|id| index[id]);

    let mut ordered: Vec<String> = Vec::with_capacity(steps.len());
    while let Some(id) = pop_lowest_index(&mut ready, &index) {
        ordered.push(id.clone());
        if let Some(deps) = dependents.get(&id) {
            for dep in deps {
                let d = indegree.get_mut(dep).expect("dependent has an indegree");
                *d -= 1;
                if *d == 0 {
                    ready.push(dep.clone());
                }
            }
        }
    }

    if ordered.len() != steps.len() {
        // The unscheduled remainder is the cycle membership.
        let scheduled: BTreeSet<&String> = ordered.iter().collect();
        let cycle: Vec<String> = steps
            .iter()
            .map(|s| s.id().to_string())
            .filter(|id| !scheduled.contains(id))
            .collect();
        return Err(GraphError::Cycle(cycle));
    }

    Ok(ordered)
}

/// Remove and return the ready id with the lowest insertion index (the stable
/// tiebreak).
fn pop_lowest_index(ready: &mut Vec<String>, index: &BTreeMap<String, usize>) -> Option<String> {
    let pos = ready
        .iter()
        .enumerate()
        .min_by_key(|(_, id)| index[*id])
        .map(|(pos, _)| pos)?;
    Some(ready.remove(pos))
}

/// Run the step graph against the context, recording failures into
/// `ctx.failures`. Returns the per-step report in execution order.
///
/// Rules, in order, per step (in topological order):
/// 1. If any of the step's `requires` did not SUCCEED → the step is blocked:
///    [`StepOutcome::Skipped`], not run.
/// 2. If the graph is ABORTING (a Required step failed earlier) → blocked:
///    [`StepOutcome::Skipped`], not run.
/// 3. If the step has a checkpoint already marked and `--force` is off →
///    [`StepOutcome::Skipped`] (the work is already done), and it counts as a
///    success for dependents.
/// 4. Otherwise run it. On [`StepOutcome::Failed`] record into `ctx.failures`
///    (required iff `kind() == Required`); a Required failure flips the graph
///    to ABORTING. On success, mark its checkpoint.
///
/// A malformed graph (cycle / unknown require) is itself a hard error and is
/// surfaced as a synthetic Required failure of a `graph` pseudo-step so the
/// install fails loudly rather than silently doing nothing.
pub fn run_graph(steps: Vec<Box<dyn Step>>, ctx: &mut Ctx) -> Vec<StepReport> {
    let order = match topo_order(&steps) {
        Ok(o) => o,
        Err(e) => {
            tracing::error!(error = %e, "install step graph is malformed");
            ctx.failures.record("graph", true);
            return vec![StepReport {
                id: "graph".to_string(),
                outcome: StepOutcome::Failed(e.to_string()),
            }];
        }
    };

    // Lookup by id into the boxed steps.
    let by_id: BTreeMap<&str, &Box<dyn Step>> = steps.iter().map(|s| (s.id(), s)).collect();

    let mut succeeded: BTreeSet<String> = BTreeSet::new();
    let mut aborting = false;
    let mut reports: Vec<StepReport> = Vec::with_capacity(order.len());

    for id in &order {
        let step = by_id[id.as_str()];

        // (1) Blocked by an unsuccessful dependency.
        let deps_ok = step.requires().iter().all(|r| succeeded.contains(*r));
        if !deps_ok {
            tracing::warn!(step = %id, "skipped: a required dependency did not succeed");
            ctx.progress.step_result(id, &StepOutcome::Skipped);
            reports.push(StepReport {
                id: id.clone(),
                outcome: StepOutcome::Skipped,
            });
            continue;
        }

        // (2) Blocked because a Required step already failed.
        if aborting {
            tracing::warn!(step = %id, "skipped: install aborting after a required failure");
            ctx.progress.step_result(id, &StepOutcome::Skipped);
            reports.push(StepReport {
                id: id.clone(),
                outcome: StepOutcome::Skipped,
            });
            continue;
        }

        // (3) Checkpoint short-circuit (unless force).
        if let Some(cp) = step.checkpoint() {
            if !ctx.force && ctx.checkpoint.is_done(cp) {
                tracing::info!(step = %id, checkpoint = %cp, "skipped: checkpoint already done");
                succeeded.insert(id.clone());
                ctx.progress.step_result(id, &StepOutcome::Skipped);
                reports.push(StepReport {
                    id: id.clone(),
                    outcome: StepOutcome::Skipped,
                });
                continue;
            }
        }

        // (4) Run.
        ctx.progress.step_started(id);
        let outcome = step.run(ctx);
        match &outcome {
            StepOutcome::Ok | StepOutcome::Skipped => {
                succeeded.insert(id.clone());
                if let Some(cp) = step.checkpoint() {
                    if let Err(e) = ctx.checkpoint.mark(cp) {
                        tracing::warn!(step = %id, checkpoint = %cp, error = %e, "failed to mark checkpoint");
                    }
                }
            }
            StepOutcome::Failed(msg) => {
                let required = step.kind() == StepKind::Required;
                tracing::error!(step = %id, required, reason = %msg, "step failed");
                ctx.failures.record(id, required);
                if required {
                    aborting = true;
                }
            }
        }
        ctx.progress.step_result(id, &outcome);
        reports.push(StepReport {
            id: id.clone(),
            outcome,
        });
    }

    reports
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoint::Checkpoint;
    use std::cell::RefCell;

    // A test step that records into a shared run-recorder when its run() fires,
    // and returns a configured outcome. The recorder lets a test assert which
    // steps were actually executed (vs skipped/blocked).
    struct TestStep {
        id: &'static str,
        requires: Vec<&'static str>,
        checkpoint: Option<&'static str>,
        kind: StepKind,
        outcome: StepOutcome,
        ran: &'static RecordCell,
    }

    type RecordCell = RefCell<Vec<String>>;

    impl Step for TestStep {
        fn id(&self) -> &str {
            self.id
        }
        fn requires(&self) -> &[&str] {
            &self.requires
        }
        fn checkpoint(&self) -> Option<&str> {
            self.checkpoint
        }
        fn kind(&self) -> StepKind {
            self.kind
        }
        fn run(&self, _ctx: &mut Ctx) -> StepOutcome {
            self.ran.borrow_mut().push(self.id.to_string());
            self.outcome.clone()
        }
    }

    fn ctx() -> Ctx {
        // Each test gets its own tempdir checkpoint root.
        let dir = Box::leak(Box::new(tempfile::tempdir().unwrap()));
        Ctx::for_test(Checkpoint::with_root(dir.path()))
    }

    fn recorder() -> &'static RecordCell {
        Box::leak(Box::new(RefCell::new(Vec::new())))
    }

    #[test]
    fn topo_order_respects_requires() {
        let ran = recorder();
        let steps: Vec<Box<dyn Step>> = vec![
            Box::new(TestStep {
                id: "c",
                requires: vec!["b"],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
            Box::new(TestStep {
                id: "b",
                requires: vec!["a"],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
            Box::new(TestStep {
                id: "a",
                requires: vec![],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
        ];
        let order = topo_order(&steps).unwrap();
        // a before b before c, regardless of insertion order.
        let pos = |id: &str| order.iter().position(|x| x == id).unwrap();
        assert!(pos("a") < pos("b"));
        assert!(pos("b") < pos("c"));
    }

    #[test]
    fn unknown_require_is_a_graph_error() {
        let ran = recorder();
        let steps: Vec<Box<dyn Step>> = vec![Box::new(TestStep {
            id: "b",
            requires: vec!["a"], // no step 'a'
            checkpoint: None,
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        })];
        let err = topo_order(&steps).unwrap_err();
        assert_eq!(
            err,
            GraphError::UnknownRequire {
                step: "b".to_string(),
                missing: "a".to_string()
            }
        );
    }

    #[test]
    fn cycle_is_detected() {
        let ran = recorder();
        let steps: Vec<Box<dyn Step>> = vec![
            Box::new(TestStep {
                id: "a",
                requires: vec!["b"],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
            Box::new(TestStep {
                id: "b",
                requires: vec!["a"],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
        ];
        let err = topo_order(&steps).unwrap_err();
        assert!(matches!(err, GraphError::Cycle(_)));
    }

    #[test]
    fn required_failure_blocks_dependent_step() {
        let ran = recorder();
        let steps: Vec<Box<dyn Step>> = vec![
            Box::new(TestStep {
                id: "first",
                requires: vec![],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Failed("boom".to_string()),
                ran,
            }),
            Box::new(TestStep {
                id: "second",
                requires: vec!["first"],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
        ];
        let mut c = ctx();
        let reports = run_graph(steps, &mut c);
        // first ran and failed; second was blocked (never ran).
        assert_eq!(ran.borrow().as_slice(), &["first".to_string()]);
        assert_eq!(c.failures.derive_status(), "failed");
        let second = reports.iter().find(|r| r.id == "second").unwrap();
        assert_eq!(second.outcome, StepOutcome::Skipped);
    }

    // THE ordering-invariant the whole crate exists to guarantee: a Required
    // fetch_binaries failure must mean systemd.run is NEVER called.
    #[test]
    fn systemd_never_runs_when_required_fetch_binaries_fails() {
        let ran = recorder();
        let steps: Vec<Box<dyn Step>> = vec![
            Box::new(TestStep {
                id: "fetch_binaries",
                requires: vec![],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Failed("no network".to_string()),
                ran,
            }),
            Box::new(TestStep {
                id: "systemd",
                requires: vec!["fetch_binaries"],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
        ];
        let mut c = ctx();
        run_graph(steps, &mut c);
        // systemd must NOT appear in the run recorder.
        assert!(
            !ran.borrow().contains(&"systemd".to_string()),
            "systemd.run was called after fetch_binaries (Required) failed: {:?}",
            ran.borrow()
        );
        assert_eq!(ran.borrow().as_slice(), &["fetch_binaries".to_string()]);
        assert_eq!(c.failures.derive_status(), "failed");
        assert_eq!(c.failures.required, vec!["fetch_binaries".to_string()]);
    }

    #[test]
    fn optional_failure_degrades_but_does_not_block() {
        let ran = recorder();
        let steps: Vec<Box<dyn Step>> = vec![
            Box::new(TestStep {
                id: "dkms",
                requires: vec![],
                checkpoint: None,
                kind: StepKind::Optional,
                outcome: StepOutcome::Failed("no compiler".to_string()),
                ran,
            }),
            Box::new(TestStep {
                id: "systemd",
                requires: vec![],
                checkpoint: None,
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            }),
        ];
        let mut c = ctx();
        run_graph(steps, &mut c);
        // Both ran; the optional failure degrades but did not abort systemd.
        assert!(ran.borrow().contains(&"systemd".to_string()));
        assert_eq!(c.failures.derive_status(), "degraded");
    }

    #[test]
    fn marked_checkpoint_is_skipped_unless_force() {
        let ran = recorder();
        let cp_dir = Box::leak(Box::new(tempfile::tempdir().unwrap()));
        let checkpoint = Checkpoint::with_root(cp_dir.path());
        checkpoint.mark("deps").unwrap();

        let make_steps = || -> Vec<Box<dyn Step>> {
            vec![Box::new(TestStep {
                id: "deps",
                requires: vec![],
                checkpoint: Some("deps"),
                kind: StepKind::Required,
                outcome: StepOutcome::Ok,
                ran,
            })]
        };

        // Not force: the marked checkpoint short-circuits → not run.
        let mut c = Ctx::for_test(checkpoint.clone());
        run_graph(make_steps(), &mut c);
        assert!(!ran.borrow().contains(&"deps".to_string()));

        // Force: the checkpoint is ignored → the step runs.
        let mut c2 = Ctx::for_test(checkpoint);
        c2.force = true;
        run_graph(make_steps(), &mut c2);
        assert!(ran.borrow().contains(&"deps".to_string()));
    }

    #[test]
    fn successful_step_marks_its_checkpoint() {
        let ran = recorder();
        let cp_dir = Box::leak(Box::new(tempfile::tempdir().unwrap()));
        let checkpoint = Checkpoint::with_root(cp_dir.path());
        let steps: Vec<Box<dyn Step>> = vec![Box::new(TestStep {
            id: "deps",
            requires: vec![],
            checkpoint: Some("deps"),
            kind: StepKind::Required,
            outcome: StepOutcome::Ok,
            ran,
        })];
        let mut c = Ctx::for_test(checkpoint.clone());
        run_graph(steps, &mut c);
        assert!(checkpoint.is_done("deps"));
    }
}
