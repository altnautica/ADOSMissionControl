//! Pure line reducers for the install live-detail pane.
//!
//! Each `*_activity` maps ONE raw subprocess line to a short human headline, or
//! `None` when the line is not worth surfacing. The headline is the curated line
//! shown in the running step's detail pane; the raw line still scrolls dim
//! underneath, so these only need to catch the useful milestones (fetch /
//! unpack / build / install / percent progress), not parse everything. All pure,
//! no I/O — unit-tested below.

/// Human-readable byte size: `4.2 MB`, `812 KB`, `900 B`.
pub fn fmt_bytes(n: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if n >= GB {
        format!("{:.1} GB", n as f64 / GB as f64)
    } else if n >= MB {
        format!("{:.1} MB", n as f64 / MB as f64)
    } else if n >= KB {
        format!("{:.0} KB", n as f64 / KB as f64)
    } else {
        format!("{n} B")
    }
}

/// The `NN%` substring in `line`, if any (walks the digits left of a `%`).
fn percent(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    let pos = line.find('%')?;
    let mut start = pos;
    while start > 0 && bytes[start - 1].is_ascii_digit() {
        start -= 1;
    }
    if start == pos {
        return None;
    }
    Some(line[start..=pos].to_string())
}

/// docker / docker compose progress → headline (image pull, container create,
/// image build).
pub fn docker_activity(line: &str) -> Option<String> {
    let l = line.trim();
    let lower = l.to_ascii_lowercase();
    if let Some(pct) = percent(l) {
        if lower.contains("pulling") || lower.contains("download") || lower.contains("extract") {
            return Some(format!("pulling images {pct}"));
        }
    }
    if lower.contains("pulling ") || lower.starts_with("pull ") {
        return Some("pulling images".to_string());
    }
    if lower.contains("building ") || lower.starts_with("build ") || lower.contains("=> [") {
        return Some("building mission-control".to_string());
    }
    if lower.contains("creating") || lower.contains("created") {
        return Some("creating containers".to_string());
    }
    if lower.contains("starting") || lower.contains("started") || lower.contains("running") {
        return Some("starting containers".to_string());
    }
    None
}

/// Convex CLI progress → headline (bundle / schema / deploy / env set).
pub fn convex_activity(line: &str) -> Option<String> {
    let l = line.trim();
    let lower = l.to_ascii_lowercase();
    if lower.contains("bundl") {
        return Some("bundling functions".to_string());
    }
    if lower.contains("schema") {
        return Some("pushing schema".to_string());
    }
    if lower.contains("deploy") || lower.contains("pushing") {
        return Some("deploying functions".to_string());
    }
    if lower.contains("environment variable") || lower.contains("env set") {
        return Some("setting environment".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fmt_bytes_scales() {
        assert_eq!(fmt_bytes(900), "900 B");
        assert_eq!(fmt_bytes(2048), "2 KB");
        assert_eq!(fmt_bytes(4_404_019), "4.2 MB");
        assert_eq!(fmt_bytes(3_221_225_472), "3.0 GB");
    }

    #[test]
    fn docker_and_convex_headlines() {
        assert_eq!(
            docker_activity("=> [build 6/9] RUN next build").as_deref(),
            Some("building mission-control")
        );
        assert_eq!(
            convex_activity("Bundled 214 modules").as_deref(),
            Some("bundling functions")
        );
    }
}
