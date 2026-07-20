//! The failure accumulator the step graph records into, and the final status it
//! derives.
//!
//! A Required failure makes the run `failed`; an Optional failure `degraded`;
//! nothing recorded is `ok`. Mirrors the installer's status contract so the
//! shared `graph::run_graph` engine works unchanged.

/// Accumulated step failures, classified into a run status at the end.
#[derive(Debug, Clone, Default)]
pub struct FailureAccumulator {
    /// Ids of Required steps that failed (any → status `failed`).
    pub required: Vec<String>,
    /// Ids of Optional steps that failed (any → status `degraded`).
    pub optional: Vec<String>,
}

impl FailureAccumulator {
    /// An empty accumulator.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a step failure, classified by whether the step was Required.
    pub fn record(&mut self, id: &str, required: bool) {
        if required {
            self.required.push(id.to_string());
        } else {
            self.optional.push(id.to_string());
        }
    }

    /// The derived run status: `failed` if any Required failed, else `degraded`
    /// if any Optional failed, else `ok`.
    pub fn derive_status(&self) -> String {
        if !self.required.is_empty() {
            "failed".to_string()
        } else if !self.optional.is_empty() {
            "degraded".to_string()
        } else {
            "ok".to_string()
        }
    }

    /// True when nothing failed.
    pub fn is_clean(&self) -> bool {
        self.required.is_empty() && self.optional.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_ladder() {
        let mut f = FailureAccumulator::new();
        assert_eq!(f.derive_status(), "ok");
        f.record("verify", false);
        assert_eq!(f.derive_status(), "degraded");
        f.record("up_convex", true);
        assert_eq!(f.derive_status(), "failed");
        assert_eq!(f.required, vec!["up_convex".to_string()]);
    }
}
