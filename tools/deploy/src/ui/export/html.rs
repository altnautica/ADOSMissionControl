//! Render a styled `compose()` grid to HTML — a `<pre>` of colored spans, plus a
//! standalone document wrapper and a dep-free animated frame-player.

use super::ansi_cells::{parse_grid, CHARCOAL};

const FONT: &str = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/// Render the grid to a `<pre class="ados-term">…</pre>` fragment.
pub fn to_pre(lines: &[String]) -> String {
    let grid = parse_grid(lines);
    let mut s = String::from("<pre class=\"ados-term\">");
    for row in &grid {
        let mut c = 0;
        while c < row.len() {
            let fg = row[c].fg;
            let bg = row[c].bg;
            let bold = row[c].bold;
            let mut text = String::new();
            while c < row.len() && row[c].fg == fg && row[c].bg == bg && row[c].bold == bold {
                text.push(row[c].ch);
                c += 1;
            }
            let mut style = format!("color:{}", hex(fg));
            if bg != CHARCOAL {
                style.push_str(&format!(";background:{}", hex(bg)));
            }
            if bold {
                style.push_str(";font-weight:700");
            }
            s.push_str(&format!(
                "<span style=\"{style}\">{}</span>",
                html_escape(&text)
            ));
        }
        s.push('\n');
    }
    s.push_str("</pre>");
    s
}

/// Wrap a `<pre>` fragment in a standalone, self-contained HTML document.
pub fn to_document(lines: &[String], title: &str) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\n<title>{}</title>\n<style>{}</style>\n</head><body>\n{}\n</body></html>\n",
        html_escape(title),
        base_css(),
        to_pre(lines)
    )
}

/// A self-contained animated player that cycles through `frames` (each a grid),
/// dep-free (frames as data + a tiny replay script). Used for the website hero.
pub fn to_player(frames: &[Vec<String>], title: &str, frame_ms: u32) -> String {
    let pres: Vec<String> = frames
        .iter()
        .map(|f| to_pre(f).replace('`', "\\`"))
        .collect();
    let joined = pres
        .iter()
        .map(|p| format!("`{p}`"))
        .collect::<Vec<_>>()
        .join(",\n");
    format!(
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\n<title>{}</title>\n<style>{}</style>\n</head><body>\n<div id=\"ados-player\"></div>\n<script>\nconst FRAMES=[{}];\nconst el=document.getElementById('ados-player');\nlet i=0;\nfunction tick(){{el.innerHTML=FRAMES[i];i=(i+1)%FRAMES.length;}}\ntick();\nif(!window.matchMedia||!window.matchMedia('(prefers-reduced-motion: reduce)').matches){{setInterval(tick,{});}}\n</script>\n</body></html>\n",
        html_escape(title),
        base_css(),
        joined,
        frame_ms
    )
}

fn base_css() -> String {
    format!(
        "html,body{{margin:0;background:{bg};}}body{{padding:20px;}}.ados-term{{font-family:{font};font-size:14px;line-height:18px;background:{bg};color:#d2d2d2;padding:14px;border-radius:8px;display:inline-block;white-space:pre;overflow-x:auto;}}",
        bg = hex(CHARCOAL),
        font = FONT
    )
}

fn hex((r, g, b): (u8, u8, u8)) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pre_wraps_spans() {
        let pre = to_pre(&["\x1b[38;2;235;193;87mA\x1b[39mb".to_string()]);
        assert!(pre.starts_with("<pre"));
        assert!(pre.contains("#ebc157"));
        assert!(pre.contains("</pre>"));
    }

    #[test]
    fn document_is_self_contained() {
        let doc = to_document(&["x".to_string()], "Menu");
        assert!(doc.starts_with("<!doctype html>"));
        assert!(doc.contains("<title>Menu</title>"));
        assert!(!doc.contains("prefers-reduced-motion")); // static doc, no script
    }

    #[test]
    fn player_embeds_frames_and_reduced_motion_guard() {
        let f1 = vec!["a".to_string()];
        let f2 = vec!["b".to_string()];
        let p = to_player(&[f1, f2], "Demo", 800);
        assert!(p.contains("FRAMES=["));
        assert!(p.contains("prefers-reduced-motion"));
        assert!(p.contains("setInterval"));
    }
}
