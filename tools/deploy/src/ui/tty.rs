//! Interactive full-screen terminal I/O for the deployer, on `crossterm`.
//!
//! This is the cross-platform counterpart of the drone-agent installer's
//! `/dev/tty` terminal handle. The installer opens `/dev/tty` directly because it
//! runs under `curl … | sudo bash` (fd 0 is the piped script, not the keyboard);
//! the deployer is never invoked that way, so that Linux-only constraint is gone
//! and the backend is `crossterm` — raw mode, the alternate screen, and event +
//! size reads that work identically on macOS, Windows, and Linux.
//!
//! The public surface (`Tty`, `KeyEvent`, `Input`, `parse_key`, `probe_size`,
//! `take_interrupt`) matches the installer's exactly, so the vendored pure
//! `wizard::{frame,render,widgets}` and `ui::fullscreen` compose the same frames
//! and read the same keys with no change. Rendering still builds the whole frame
//! with `wizard::frame` (a pure, host-independent compositor) and writes it to
//! stdout in one `write_all` with absolute cursor placement. Raw mode + the
//! alternate screen are restored on `Drop` and by a panic hook (a backstop for
//! release builds that abort on panic).

use std::io::{IsTerminal, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use ratatui::crossterm::event::{
    self, Event, KeyCode, KeyEvent as CtKeyEvent, KeyEventKind, KeyModifiers,
};
use ratatui::crossterm::{cursor, execute, terminal};

use crate::ui::theme::Theme;
use crate::wizard::frame::{self, Chrome, Screen, TermSize};

/// A single decoded key event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyEvent {
    Up,
    Down,
    Left,
    Right,
    Enter,
    Space,
    Esc,
    Backspace,
    Tab,
    CtrlC,
    Char(char),
    /// The terminal was resized; the caller should repaint at the new size.
    Resize,
    /// A key we do not act on. Widgets ignore it.
    Unknown,
}

/// The outcome of a timed read: a decoded key, or a tick when the timeout
/// elapsed with no key (so an animated spinner can advance).
pub enum Input {
    Key(KeyEvent),
    Tick,
}

/// Decode a raw byte burst into a [`KeyEvent`]. Retained (and unit-tested)
/// because the same escape grammar underlies terminal input everywhere; the
/// crossterm event path is the live source, this is the pure decoder.
pub fn parse_key(bytes: &[u8]) -> KeyEvent {
    let Some(&b0) = bytes.first() else {
        return KeyEvent::Unknown;
    };
    match b0 {
        0x0D | 0x0A => KeyEvent::Enter,
        0x09 => KeyEvent::Tab,
        0x7F | 0x08 => KeyEvent::Backspace,
        0x03 => KeyEvent::CtrlC,
        0x1B => {
            if bytes.len() >= 3 && bytes[1] == b'[' {
                match bytes[2] {
                    b'A' => KeyEvent::Up,
                    b'B' => KeyEvent::Down,
                    b'C' => KeyEvent::Right,
                    b'D' => KeyEvent::Left,
                    _ => KeyEvent::Unknown,
                }
            } else {
                KeyEvent::Esc
            }
        }
        0x20 => KeyEvent::Space,
        b if b >= 0x20 => match std::str::from_utf8(bytes) {
            Ok(s) => s
                .chars()
                .next()
                .map(KeyEvent::Char)
                .unwrap_or(KeyEvent::Unknown),
            Err(_) => KeyEvent::Unknown,
        },
        _ => KeyEvent::Unknown,
    }
}

/// Map a crossterm key event to our [`KeyEvent`]. `None` for key-release/repeat
/// noise and modifiers we do not act on (so the caller keeps polling).
fn map_ct_key(k: CtKeyEvent) -> Option<KeyEvent> {
    // On Windows crossterm delivers Press AND Release; only act on Press.
    if k.kind == KeyEventKind::Release {
        return None;
    }
    let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
    Some(match k.code {
        KeyCode::Up => KeyEvent::Up,
        KeyCode::Down => KeyEvent::Down,
        KeyCode::Left => KeyEvent::Left,
        KeyCode::Right => KeyEvent::Right,
        KeyCode::Enter => KeyEvent::Enter,
        KeyCode::Esc => KeyEvent::Esc,
        KeyCode::Backspace => KeyEvent::Backspace,
        KeyCode::Tab => KeyEvent::Tab,
        KeyCode::Char(c) if ctrl && (c == 'c' || c == 'C') => KeyEvent::CtrlC,
        KeyCode::Char(' ') => KeyEvent::Space,
        KeyCode::Char(c) => KeyEvent::Char(c),
        _ => KeyEvent::Unknown,
    })
}

/// Probe the terminal size, falling back to a sane 80x24.
pub fn probe_size() -> TermSize {
    match terminal::size() {
        Ok((c, r)) => TermSize {
            cols: usize::from(c.max(1)),
            rows: usize::from(r.max(1)),
        },
        Err(_) => TermSize { cols: 80, rows: 24 },
    }
}

/// The pending-interrupt flag, set when a Ctrl-C key arrives during the
/// write-only deploy phase. The render loop checks it each tick and exits
/// cleanly (leaving the alt screen via `Drop`).
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

/// Read and clear the pending-interrupt flag.
pub fn take_interrupt() -> bool {
    INTERRUPTED.swap(false, Ordering::SeqCst)
}

/// A raw, restore-on-drop handle to the terminal, drawn to as a full-screen
/// alternate-screen app on stdout.
pub struct Tty {
    /// The chrome (step of steps + label) drawn around the current screen.
    chrome: Chrome,
    /// The size the last frame was drawn for; a change triggers a full clear.
    last_size: Option<TermSize>,
}

impl Tty {
    /// Enter raw mode + the alternate screen. Returns `Ok(None)` when stdout or
    /// stdin is not a terminal (CI / piped), so the caller falls back to the
    /// line-based renderer.
    pub fn open() -> std::io::Result<Option<Tty>> {
        if !std::io::stdout().is_terminal() || !std::io::stdin().is_terminal() {
            return Ok(None);
        }
        terminal::enable_raw_mode()?;
        let mut out = std::io::stdout();
        if execute!(out, terminal::EnterAlternateScreen, cursor::Hide).is_err() {
            let _ = terminal::disable_raw_mode();
            return Ok(None);
        }
        install_panic_reset();
        Ok(Some(Tty {
            chrome: Chrome::default(),
            last_size: None,
        }))
    }

    /// Whether an interactive terminal is available.
    pub fn is_available() -> bool {
        std::io::stdout().is_terminal() && std::io::stdin().is_terminal()
    }

    /// The current terminal size.
    pub fn size(&self) -> TermSize {
        probe_size()
    }

    /// The inner text width a widget's body lines have.
    pub fn body_width(&self) -> usize {
        crate::wizard::render::panel_body_width(frame::panel_width(probe_size().cols))
    }

    /// Set the chrome (progress rail) for the screens that follow. A `total` of
    /// zero hides the rail.
    pub fn set_chrome(&mut self, step: usize, total: usize, label: &str) {
        self.chrome = Chrome {
            step,
            total,
            label: label.to_string(),
        };
    }

    /// Draw a full-screen frame: header + rail + centered body panel + footer.
    pub fn render(&mut self, theme: &Theme, section: &str, body: &[String], footer: &str) {
        let size = probe_size();
        let cleared = self.last_size != Some(size);
        let screen = Screen {
            section,
            body,
            footer,
        };
        let grid = frame::compose(theme, &self.chrome, &screen, size);
        let out = frame::to_ansi(&grid, cleared, theme);
        self.write(&out);
        self.last_size = Some(size);
    }

    /// Present a pre-composed full-screen grid (the deploy split-view owns its
    /// own layout while reusing this single-syscall writer).
    pub fn present(&mut self, grid: &[String], theme: &Theme) {
        let size = probe_size();
        let cleared = self.last_size != Some(size);
        let out = frame::to_ansi(grid, cleared, theme);
        self.write(&out);
        self.last_size = Some(size);
    }

    /// Force the next present/render to fully clear the screen (the
    /// wizard→deploy handoff).
    pub fn force_clear_next(&mut self) {
        self.last_size = None;
    }

    /// Discard any queued (type-ahead) terminal input, so a stray keystroke made
    /// during the write-only deploy does not dismiss the completion card.
    pub fn flush_input(&mut self) {
        while matches!(event::poll(Duration::ZERO), Ok(true)) {
            let _ = event::read();
        }
    }

    /// No-op on crossterm: Ctrl-C is delivered as a key event in raw mode and is
    /// handled by [`Tty::read_input`] / [`Tty::poll_interrupt`] (which set the
    /// interrupt flag). Kept for surface parity with the installer's tty.
    pub fn enable_signals(&mut self) {}

    /// Non-blocking: drain any pending key events and, if a Ctrl-C is among them,
    /// set the interrupt flag. The deploy render loop calls this each tick (it
    /// otherwise blocks on the progress channel and never reads the keyboard), so
    /// Ctrl-C aborts a running deploy — the loop observes [`take_interrupt`],
    /// leaves the alt screen, and exits 130.
    pub fn poll_interrupt(&mut self) {
        while matches!(event::poll(Duration::ZERO), Ok(true)) {
            if let Ok(Event::Key(k)) = event::read() {
                if map_ct_key(k) == Some(KeyEvent::CtrlC) {
                    INTERRUPTED.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    /// Block for one key press. A resize returns [`KeyEvent::Resize`].
    pub fn read_key(&mut self) -> std::io::Result<KeyEvent> {
        loop {
            match event::read()? {
                Event::Key(k) => {
                    if let Some(ev) = map_ct_key(k) {
                        return Ok(ev);
                    }
                }
                Event::Resize(_, _) => return Ok(KeyEvent::Resize),
                _ => {}
            }
        }
    }

    /// Block up to `ms` for a key press. On timeout returns [`Input::Tick`]. A
    /// Ctrl-C also sets the interrupt flag so a render loop polling ticks can
    /// exit via [`take_interrupt`].
    pub fn read_input(&mut self, ms: u64) -> Input {
        match event::poll(Duration::from_millis(ms)) {
            Ok(true) => match event::read() {
                Ok(Event::Key(k)) => match map_ct_key(k) {
                    Some(KeyEvent::CtrlC) => {
                        INTERRUPTED.store(true, Ordering::SeqCst);
                        Input::Key(KeyEvent::CtrlC)
                    }
                    Some(ev) => Input::Key(ev),
                    None => Input::Tick,
                },
                Ok(Event::Resize(_, _)) => Input::Key(KeyEvent::Resize),
                _ => Input::Tick,
            },
            Ok(false) => Input::Tick,
            Err(_) => Input::Tick,
        }
    }

    /// Write bytes to stdout and flush.
    fn write(&mut self, s: &str) {
        let mut out = std::io::stdout();
        let _ = out.write_all(s.as_bytes());
        let _ = out.flush();
    }
}

impl Drop for Tty {
    fn drop(&mut self) {
        restore_terminal();
    }
}

/// Leave the alternate screen, show the cursor, and un-raw the terminal.
/// Best-effort; safe to call more than once.
fn restore_terminal() {
    let mut out = std::io::stdout();
    let _ = execute!(out, terminal::LeaveAlternateScreen, cursor::Show);
    let _ = terminal::disable_raw_mode();
}

/// Install a one-shot panic hook that restores the terminal (release builds
/// abort on panic, so `Drop` never runs). The previous hook is chained.
fn install_panic_reset() {
    static ONCE: OnceLock<()> = OnceLock::new();
    if ONCE.set(()).is_err() {
        return;
    }
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        restore_terminal();
        prev(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enter_space_tab_backspace_ctrlc() {
        assert_eq!(parse_key(&[0x0D]), KeyEvent::Enter);
        assert_eq!(parse_key(&[0x20]), KeyEvent::Space);
        assert_eq!(parse_key(&[0x09]), KeyEvent::Tab);
        assert_eq!(parse_key(&[0x7F]), KeyEvent::Backspace);
        assert_eq!(parse_key(&[0x03]), KeyEvent::CtrlC);
    }

    #[test]
    fn arrows_are_three_byte_csi_sequences() {
        assert_eq!(parse_key(&[0x1B, b'[', b'A']), KeyEvent::Up);
        assert_eq!(parse_key(&[0x1B, b'[', b'B']), KeyEvent::Down);
        assert_eq!(parse_key(&[0x1B, b'[', b'C']), KeyEvent::Right);
        assert_eq!(parse_key(&[0x1B, b'[', b'D']), KeyEvent::Left);
    }

    #[test]
    fn lone_escape_is_esc() {
        assert_eq!(parse_key(&[0x1B]), KeyEvent::Esc);
        assert_eq!(parse_key(&[0x1B, b'[', b'H']), KeyEvent::Unknown);
    }

    #[test]
    fn printable_ascii_and_utf8_decode_to_char() {
        assert_eq!(parse_key(b"a"), KeyEvent::Char('a'));
        assert_eq!(parse_key("é".as_bytes()), KeyEvent::Char('é'));
    }

    #[test]
    fn ct_release_is_ignored_press_maps() {
        let press = CtKeyEvent::new(KeyCode::Enter, KeyModifiers::NONE);
        assert_eq!(map_ct_key(press), Some(KeyEvent::Enter));
        let ctrl_c = CtKeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(map_ct_key(ctrl_c), Some(KeyEvent::CtrlC));
        let mut rel = CtKeyEvent::new(KeyCode::Enter, KeyModifiers::NONE);
        rel.kind = KeyEventKind::Release;
        assert_eq!(map_ct_key(rel), None);
    }

    #[test]
    fn probe_size_is_never_zero() {
        let s = probe_size();
        assert!(s.cols >= 1 && s.rows >= 1);
    }
}
