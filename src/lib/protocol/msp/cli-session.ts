/**
 * MSP flight-controller CLI session: a raw-ASCII command channel over the
 * serial link, shared by Betaflight and iNav.
 *
 * Both firmwares enter their CLI when `#` arrives outside an MSP frame and
 * then speak plain, un-framed ASCII until the CLI is left. The MSP parser would
 * drop that text (and a stray `$` would corrupt its state), so while a session
 * is active the adapter routes inbound bytes here instead of into the parser
 * and pauses MSP polling.
 *
 * The firmwares differ in how the CLI is left. Betaflight accepts
 * `exit noreboot` / `save noreboot`, and `save noreboot` stays in the CLI.
 * iNav's `exit` and `save` always reboot the flight controller.
 *
 * @module protocol/msp/cli-session
 */

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** How a firmware's CLI is left and persisted. */
export interface CliDialect {
  /** Line that leaves the CLI. */
  readonly exitLine: string;
  /** Line that writes EEPROM. */
  readonly saveLine: string;
  /** True when the save line also leaves the CLI (the FC reboots). */
  readonly saveLeavesCli: boolean;
}

/** Betaflight: `exit noreboot` leaves without a reboot; `save noreboot` persists and stays in the CLI. */
export const BETAFLIGHT_CLI: CliDialect = { exitLine: "exit noreboot", saveLine: "save noreboot", saveLeavesCli: false };

/** iNav: `exit` and `save` take no arguments and both reboot the flight controller. */
export const INAV_CLI: CliDialect = { exitLine: "exit", saveLine: "save", saveLeavesCli: true };

/** Adapter-provided I/O for a CLI session. */
export interface CliIo {
  /** Write raw bytes to the serial link. */
  send(bytes: Uint8Array): void;
  /**
   * Flip the adapter's inbound-byte routing to this session and pause MSP
   * polling (active=true), or restore MSP parsing and polling (active=false).
   */
  setActive(active: boolean): void;
}

const IDLE_MS = 400;
const PROMPT_GRACE_MS = 80;
const CMD_TIMEOUT_MS = 4000;

/**
 * True when the buffer's last line is the FC's interactive `#` prompt (just
 * `#` + optional space, the FC waiting for input) rather than a `# comment`
 * line inside a `dump` (which has text after the `#`).
 */
function endsWithPrompt(buf: string): boolean {
  const lastLine = buf.slice(buf.lastIndexOf("\n") + 1);
  return /^\s*#\s*$/.test(lastLine);
}

/**
 * A single connected CLI session. Not concurrency-safe: enter → run…* → exit
 * is a serial sequence owned by one caller at a time.
 */
export class MspCliSession {
  private readonly decoder = new TextDecoder();
  private buffer = "";
  private notify: (() => void) | null = null;
  /** The FC is in its CLI (a `#` was sent and no leave line since). */
  private inCli = false;
  /** Inbound bytes still route here after a typed leave line, so its reply reaches the terminal. */
  private draining: ReturnType<typeof setTimeout> | null = null;
  private interactiveCb: ((text: string) => void) | null = null;

  constructor(
    private readonly io: CliIo,
    readonly dialect: CliDialect,
  ) {}

  /** True while inbound bytes belong to the CLI rather than the MSP parser. */
  get isActive(): boolean {
    return this.inCli || this.draining !== null;
  }

  /** Feed raw inbound bytes (called by the adapter while a session is active). */
  feed(data: Uint8Array): void {
    const text = this.decoder.decode(data, { stream: true });
    if (this.interactiveCb) {
      this.interactiveCb(text); // interactive terminal: stream, don't buffer for collect
      return;
    }
    this.buffer += text;
    this.notify?.();
  }

  // ── Interactive terminal mode (for the CLI panel) ───────────

  /**
   * Stream all inbound CLI text to `cb`. The CLI is entered by the first
   * command, so opening a terminal does not pause telemetry on its own.
   */
  attachInteractive(cb: (text: string) => void): void {
    this.interactiveCb = cb;
  }

  /**
   * Send one typed command line. Enters the CLI first when needed. A typed
   * `exit` is sent as the dialect's exit line, and a save that leaves the CLI
   * (iNav) is followed by resuming MSP once its reply has drained, so the
   * adapter never keeps routing MSP replies into the terminal.
   */
  sendInteractive(line: string): void {
    const verb = line.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    if (!this.inCli) this.enterRaw();
    if (verb === "exit") {
      this.leave(this.dialect.exitLine);
      return;
    }
    if (verb === "save") {
      if (this.dialect.saveLeavesCli) this.leave(this.dialect.saveLine);
      else this.io.send(enc(`${this.dialect.saveLine}\r\n`));
      return;
    }
    this.io.send(enc(`${line}\r\n`));
  }

  /** Close the interactive session, leaving the CLI if it was entered. */
  detachInteractive(): void {
    this.interactiveCb = null;
    const held = this.isActive;
    if (this.inCli) {
      this.io.send(enc(`${this.dialect.exitLine}\r\n`));
      this.inCli = false;
    }
    clearTimeout(this.draining ?? undefined);
    this.draining = null;
    if (held) this.io.setActive(false);
  }

  /** Enter the CLI (`#`). Returns the banner text. Idempotent. */
  async enter(): Promise<string> {
    if (this.inCli) return "";
    this.buffer = "";
    this.enterRaw();
    return this.collect(CMD_TIMEOUT_MS);
  }

  /** Send one CLI command and collect its output up to the next prompt. */
  async run(cmd: string, timeoutMs = CMD_TIMEOUT_MS): Promise<string> {
    if (!this.inCli) throw new Error("CLI session is not active");
    this.buffer = "";
    this.io.send(enc(`${cmd}\r\n`));
    return this.collect(timeoutMs);
  }

  /** Leave the CLI with the dialect's exit line. */
  async exit(): Promise<void> {
    if (!this.inCli) return;
    try {
      this.buffer = "";
      this.io.send(enc(`${this.dialect.exitLine}\r\n`));
      await this.collect(CMD_TIMEOUT_MS).catch(() => undefined);
    } finally {
      this.inCli = false;
      this.io.setActive(false);
    }
  }

  private enterRaw(): void {
    if (this.draining) {
      // Routing never left the CLI; just cancel the pending hand-back.
      clearTimeout(this.draining);
      this.draining = null;
    } else {
      this.io.setActive(true);
    }
    this.inCli = true;
    this.io.send(enc("#\r\n"));
  }

  private leave(line: string): void {
    this.io.send(enc(`${line}\r\n`));
    this.inCli = false;
    this.draining = setTimeout(() => {
      this.draining = null;
      this.io.setActive(false);
    }, IDLE_MS);
  }

  /**
   * Resolve when the CLI prompt returns, the stream goes idle, or a timeout
   * elapses. A prompt schedules a short grace rather than resolving inline, so a
   * TCP chunk that happens to end at a mid-`dump` `#` cannot cut the read short:
   * if more bytes follow, the timer re-arms; if the stream is truly done, the
   * grace elapses.
   */
  private collect(timeoutMs: number): Promise<string> {
    const { promise, resolve } = Promise.withResolvers<string>();
    let idle: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(idle);
      clearTimeout(hard);
      this.notify = null;
      resolve(this.buffer);
    };
    const onData = (): void => {
      clearTimeout(idle);
      idle = setTimeout(finish, endsWithPrompt(this.buffer) ? PROMPT_GRACE_MS : IDLE_MS);
    };
    const hard = setTimeout(finish, timeoutMs);
    this.notify = onData;
    onData(); // arm the timer / catch an already-complete buffer
    return promise;
  }
}
