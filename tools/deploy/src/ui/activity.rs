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

/// The first whitespace-delimited token of `s`, or `""`.
fn first_token(s: &str) -> &str {
    s.split_whitespace().next().unwrap_or("")
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

/// apt / dpkg progress → headline.
pub fn apt_activity(line: &str) -> Option<String> {
    let l = line.trim();
    if let Some(rest) = l.strip_prefix("Unpacking ") {
        let pkg = first_token(rest);
        if !pkg.is_empty() {
            return Some(format!("unpacking {pkg}"));
        }
    }
    if let Some(rest) = l.strip_prefix("Setting up ") {
        let pkg = first_token(rest);
        if !pkg.is_empty() {
            return Some(format!("configuring {pkg}"));
        }
    }
    if l.starts_with("Get:") {
        return Some("downloading packages".to_string());
    }
    None
}

/// pip progress → headline.
pub fn pip_activity(line: &str) -> Option<String> {
    let l = line.trim();
    if let Some(rest) = l.strip_prefix("Collecting ") {
        let pkg = first_token(rest);
        if !pkg.is_empty() {
            return Some(format!("resolving {pkg}"));
        }
    }
    if let Some(rest) = l.strip_prefix("Building wheel for ") {
        let pkg = first_token(rest);
        if !pkg.is_empty() {
            return Some(format!("building {pkg}"));
        }
    }
    if let Some(rest) = l.strip_prefix("Downloading ") {
        let name = first_token(rest).rsplit('/').next().unwrap_or("");
        if !name.is_empty() {
            return Some(format!("downloading {name}"));
        }
    }
    if l.starts_with("Installing collected packages") {
        return Some("installing agent package".to_string());
    }
    None
}

/// git clone progress → headline.
pub fn git_activity(line: &str) -> Option<String> {
    let l = line.trim();
    if l.starts_with("Cloning into") {
        return Some("cloning repository".to_string());
    }
    if l.starts_with("Receiving objects:") {
        return Some(match percent(l) {
            Some(p) => format!("receiving objects {p}"),
            None => "receiving objects".to_string(),
        });
    }
    if l.starts_with("Resolving deltas:") {
        return Some(match percent(l) {
            Some(p) => format!("resolving deltas {p}"),
            None => "resolving deltas".to_string(),
        });
    }
    if l.starts_with("Updating files:") {
        return Some(match percent(l) {
            Some(p) => format!("checking out {p}"),
            None => "checking out files".to_string(),
        });
    }
    None
}

/// DKMS kernel-module build → headline.
pub fn dkms_activity(line: &str) -> Option<String> {
    let l = line.trim();
    if l.contains("Building module")
        || l.contains("Building initial module")
        || l.contains("Building for")
    {
        return Some("compiling 8812eu kernel module".to_string());
    }
    if l.contains("Installing module") || l.starts_with("depmod") {
        return Some("installing kernel module".to_string());
    }
    None
}

/// wfb-ng userspace build (make + setup.py) → headline.
pub fn wfb_activity(line: &str) -> Option<String> {
    let l = line.trim();
    let lower = l.to_ascii_lowercase();
    if lower.contains("running install")
        || lower.starts_with("installing ")
        || lower.contains("setup.py")
    {
        return Some("installing radio stack".to_string());
    }
    if lower.starts_with("gcc")
        || lower.starts_with("g++")
        || lower.starts_with("cc ")
        || lower.starts_with("make[")
        || lower.starts_with("make ")
        || lower.contains(".c ")
        || lower.contains(".o ")
    {
        return Some("compiling radio stack".to_string());
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
    fn apt_headlines() {
        assert_eq!(
            apt_activity("Unpacking gstreamer1.0-tools (1.22.0) ...").as_deref(),
            Some("unpacking gstreamer1.0-tools")
        );
        assert_eq!(
            apt_activity("Setting up ffmpeg (7:5.1.6) ...").as_deref(),
            Some("configuring ffmpeg")
        );
        assert_eq!(
            apt_activity("Get:12 http://deb.debian.org bookworm/main arm64 libfoo").as_deref(),
            Some("downloading packages")
        );
        assert_eq!(apt_activity("Reading package lists..."), None);
    }

    #[test]
    fn pip_headlines() {
        assert_eq!(
            pip_activity("Collecting msgpack==1.0.5").as_deref(),
            Some("resolving msgpack==1.0.5")
        );
        assert_eq!(
            pip_activity("  Building wheel for ados-drone-agent (pyproject.toml)").as_deref(),
            Some("building ados-drone-agent")
        );
        assert_eq!(
            pip_activity("Installing collected packages: msgpack, ados").as_deref(),
            Some("installing agent package")
        );
    }

    #[test]
    fn git_headlines_extract_percent() {
        assert_eq!(
            git_activity("Receiving objects:  73% (146/200)").as_deref(),
            Some("receiving objects 73%")
        );
        assert_eq!(
            git_activity("Cloning into '/opt/ados/source'...").as_deref(),
            Some("cloning repository")
        );
    }

    #[test]
    fn dkms_and_wfb_headlines() {
        assert_eq!(
            dkms_activity("Building module(s)....").as_deref(),
            Some("compiling 8812eu kernel module")
        );
        assert_eq!(
            wfb_activity("gcc -O2 -c wfb_tx.c -o wfb_tx.o").as_deref(),
            Some("compiling radio stack")
        );
        assert_eq!(
            wfb_activity("running install").as_deref(),
            Some("installing radio stack")
        );
    }
}
