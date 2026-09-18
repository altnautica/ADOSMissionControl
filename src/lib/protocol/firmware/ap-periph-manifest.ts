// Exempt from 300 LOC soft rule: self-contained firmware-index manifest
// client. The HTML-listing parser, IndexedDB cache layer, and embedded
// baseline fallback table form one cohesive client around a single public
// surface; the bulk is the embedded baseline data and there is no
// caller-facing seam to split on.
/**
 * AP_Periph firmware index parser.
 *
 * The upstream server does not publish a JSON manifest for the
 * AP_Periph build tree. Instead, the index is a plain Apache
 * mod_autoindex HTML listing: a top-level page enumerates release
 * channels (`stable/`, `beta/`, `latest/`, dated build folders), each
 * channel page enumerates per-board folders, and each board folder
 * carries the binary set (`AP_Periph.bin`, `AP_Periph_with_bl.hex`,
 * `AP_Periph.apj`, plus version / git / features text files).
 *
 * This client fetches those HTML pages through a server-side proxy
 * route (CORS workaround) and parses them with a regex matcher over
 * the `<a href="...">` rows. Results are cached in IndexedDB via
 * idb-keyval with a 24 h TTL, with an in-memory map shadowing the
 * persistent layer for hot reads. When the network fails, an
 * embedded baseline of known boards is served as a fallback so the
 * picker stays usable offline.
 *
 * @module protocol/firmware/ap-periph-manifest
 */

import { del, get, set } from "idb-keyval";

// ── Constants ──────────────────────────────────────────────

const UPSTREAM_BASE = "https://firmware.ardupilot.org/AP_Periph";
const PROXY_BASE = "/api/ap-periph-manifest";
const CACHE_PREFIX = "dronecan-firmware:v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ── Types ──────────────────────────────────────────────────

export type BoardFileKind =
  | "app"
  | "with-bl"
  | "apj"
  | "elf"
  | "version-txt"
  | "features-txt"
  | "git-version-txt"
  | "other";

export interface BoardFile {
  name: string;
  sizeBytes: number | null;
  url: string;
  kind: BoardFileKind;
}

export interface BoardManifest {
  board: string;
  channel: string;
  files: BoardFile[];
  version: string | null;
  gitCommit: string | null;
  dateLabel: string | null;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  etag?: string;
}

// ── Embedded baseline (offline fallback) ───────────────────

/**
 * Stable-channel board list captured from the upstream index. Used
 * when both the network and the persistent cache are unavailable so
 * the picker can still render. Kept as a flat string array, sorted
 * to match the upstream alphabetical listing.
 */
export const EMBEDDED_BOARD_LIST: readonly string[] = [
  "AR-F407SmartBat",
  "ARK_CANNODE",
  "ARK_GPS",
  "ARK_RTK_GPS",
  "AeroFox-Airspeed",
  "AeroFox-Airspeed-DLVR",
  "AeroFox-GNSS_F9P",
  "AeroFox-PMU",
  "BirdCANdy",
  "BotBloxDroneNet",
  "BotBloxSwitch",
  "C-RTK2-HP",
  "CUAV_GPS",
  "CarbonixF405",
  "CubeBlack-periph",
  "CubeNode",
  "CubeNode-ETH",
  "CubeOrange-periph",
  "CubePilot-CANMod",
  "CubePilot-PPPGW",
  "CubeRedPrimary-PPPGW",
  "FreeflyRTK",
  "Here4AP",
  "Hitec-Airspeed",
  "HitecMosaic",
  "HolybroF4_PMU",
  "HolybroG4_Airspeed",
  "HolybroG4_Compass",
  "HolybroG4_GPS",
  "HolybroGPS",
  "MFE_AirSpeed_CAN",
  "MFE_POS3_CAN",
  "MatekG474-DShot",
  "MatekG474-GPS",
  "MatekG474-Periph",
  "MatekH743-periph",
  "MatekL431-ADSB",
  "MatekL431-APDTelem",
  "MatekL431-Airspeed",
  "MatekL431-BattMon",
  "MatekL431-BatteryTag",
  "MatekL431-DShot",
  "MatekL431-EFI",
  "MatekL431-GPS",
  "MatekL431-HWTelem",
  "MatekL431-MagHiRes",
  "MatekL431-Periph",
  "MatekL431-Proximity",
  "MatekL431-RC",
  "MatekL431-Rangefinder",
  "MatekL431-Serial",
  "MatekL431-bdshot",
  "Nucleo-G491",
  "Nucleo-L476",
  "Nucleo-L496",
  "Pixhawk6X-PPPGW",
  "Pixracer-periph",
  "Sierra-F405",
  "Sierra-F412",
  "Sierra-F9P",
  "Sierra-L431",
  "Sierra-PrecisionPoint",
  "Sierra-TrueNavIC",
  "Sierra-TrueNavPro",
  "Sierra-TrueNavPro-G4",
  "Sierra-TrueNorth",
  "Sierra-TrueSpeed",
  "TBS-L431-Airspeed",
  "TBS-L431-BattMon",
  "TBS-L431-CurrMon",
  "TBS-L431-PWM",
  "VM-L431-Periph-Pico",
  "VM-L431-SRV-Hub-4CHP",
  "ZubaxGNSS",
  "f103-ADSB",
  "f103-Airspeed",
  "f103-GPS",
  "f103-QiotekPeriph",
  "f103-RangeFinder",
  "f303-GPS",
  "f303-HWESC",
  "f303-M10025",
  "f303-M10070",
  "f303-MatekGPS",
  "f303-PWM",
  "f303-TempSensor",
  "f303-Universal",
  "f405-MatekAirspeed",
  "f405-MatekGPS",
  "kha_eth",
  "mRo-M10095",
  "mRoCANPWM-M10126",
  "mRoKitCANrevC",
  "rGNSS",
  "sitl_periph_battery_tag",
  "sitl_periph_battmon",
  "sitl_periph_gps",
  "sitl_periph_universal",
  "sw-boom-f407",
  "sw-nav-f405",
  "sw-spar-f407",
  "uav-dev-powermodule",
  "uav-dev_m10s",
];

const EMBEDDED_CHANNEL_LIST: readonly string[] = ["stable", "beta", "latest"];

// ── HTML parser ────────────────────────────────────────────

/**
 * Parsed entry from an Apache mod_autoindex listing. `isDir` is true
 * when the href ends with a slash. `sizeBytes` is the file size column
 * when the row carries one (folders return null).
 */
export interface IndexEntry {
  name: string;
  href: string;
  isDir: boolean;
  sizeBytes: number | null;
}

const ANCHOR_RE = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;

/**
 * Parse the body of an Apache mod_autoindex page into entry rows.
 * Skips the parent-directory link, query-string sort links, and any
 * anchor whose href differs from its display text (those are header
 * sort controls in mod_autoindex). Size column is best-effort: the
 * raw row text after the anchor is scanned for a trailing byte count
 * or a human-readable size suffix (K, M, G).
 */
export function parseDirectoryIndex(html: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const seen = new Set<string>();

  ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const href = match[1];
    const text = match[2];

    // Skip parent / sort controls / fragments.
    if (!href || href.startsWith("?") || href.startsWith("#")) continue;
    if (href === "../" || href === "/") continue;
    // mod_autoindex header rows wrap the column title in an anchor whose
    // href does not appear as a row entry (e.g. "?C=N;O=D"). Those got
    // filtered above. The remaining hrefs whose display text differs
    // structurally from the href can still be valid (e.g. truncated
    // names ending with "..>"); we just normalize the name.
    const isDir = href.endsWith("/");
    const name = isDir ? href.replace(/\/$/, "") : href;
    if (!name || seen.has(href)) continue;
    seen.add(href);

    // Look for a trailing size column on the same line (mod_autoindex
    // emits the size right after the closing </a>, separated by spaces).
    let sizeBytes: number | null = null;
    if (!isDir) {
      const tail = html.slice(match.index + match[0].length, match.index + match[0].length + 80);
      const sizeMatch = tail.match(/\s+(\d+(?:\.\d+)?)\s*([KMG]?)\s/);
      if (sizeMatch) {
        const n = Number(sizeMatch[1]);
        const unit = sizeMatch[2];
        const mult = unit === "K" ? 1024 : unit === "M" ? 1024 * 1024 : unit === "G" ? 1024 * 1024 * 1024 : 1;
        if (Number.isFinite(n)) {
          sizeBytes = Math.round(n * mult);
        }
      }
    }

    entries.push({ name: decodeURIComponent(name), href, isDir, sizeBytes });
  }

  return entries;
}

/**
 * Classify a file name inside an AP_Periph board folder. Used to
 * route the OTA flasher to the `.bin`, the SWD/UART tool to the
 * `.hex` / `.apj`, and to surface the text companions in the UI.
 */
export function classifyBoardFile(name: string): BoardFileKind {
  if (name === "AP_Periph.bin") return "app";
  if (name === "AP_Periph_with_bl.hex") return "with-bl";
  if (name === "AP_Periph.apj") return "apj";
  if (name === "AP_Periph.elf") return "elf";
  if (name === "firmware-version.txt") return "version-txt";
  if (name === "features.txt") return "features-txt";
  if (name === "git-version.txt") return "git-version-txt";
  return "other";
}

/**
 * Channel rows are folder entries whose name matches the known
 * release names or a year-month build label (e.g. `2026-05`).
 */
export function isChannelName(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (lower === "stable" || lower === "beta" || lower === "latest") return true;
  // Year-month dated folders, optionally with a build suffix.
  return /^\d{4}-\d{2}(-[A-Za-z0-9._-]+)?$/.test(name);
}

/** Common vendor prefix groupings for the board picker. */
export function groupBoardsByVendor(boards: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const push = (vendor: string, board: string) => {
    const list = out.get(vendor);
    if (list) list.push(board);
    else out.set(vendor, [board]);
  };

  for (const board of boards) {
    if (/^MatekL431/i.test(board) || /^MatekG474/i.test(board) || /^MatekH743/i.test(board) || /^f4?05-Matek/i.test(board) || /^f303-MatekGPS/i.test(board)) {
      push("Matek", board);
    } else if (/^Sierra-/i.test(board)) {
      push("Sierra", board);
    } else if (/^Holybro/i.test(board)) {
      push("Holybro", board);
    } else if (/^Cube/i.test(board)) {
      push("CubePilot", board);
    } else if (/^ARK_/i.test(board)) {
      push("ARK", board);
    } else if (/^AeroFox/i.test(board)) {
      push("AeroFox", board);
    } else if (/^TBS-L431/i.test(board)) {
      push("TBS", board);
    } else if (/^Hitec/i.test(board)) {
      push("Hitec", board);
    } else if (/^mRo/i.test(board)) {
      push("mRo", board);
    } else if (/^Sw-|^sw-/i.test(board)) {
      push("Swift", board);
    } else if (/^Nucleo-/i.test(board)) {
      push("ST Nucleo", board);
    } else if (/^Pixracer|^Pixhawk/i.test(board)) {
      push("Pixhawk", board);
    } else if (/^f103-/i.test(board) || /^f303-/i.test(board) || /^f405-/i.test(board)) {
      push("F1/F3/F4 reference", board);
    } else if (/^sitl_/i.test(board)) {
      push("SITL", board);
    } else if (/^uav-dev/i.test(board)) {
      push("UAV-DEV", board);
    } else if (/^VM-L431/i.test(board)) {
      push("VimDrones", board);
    } else if (/^MFE_/i.test(board)) {
      push("MFE", board);
    } else if (/^BotBlox/i.test(board)) {
      push("BotBlox", board);
    } else {
      push("Other", board);
    }
  }

  for (const list of out.values()) list.sort();
  return out;
}

// ── Cache helpers ──────────────────────────────────────────

const memCache = new Map<string, CacheEntry<unknown>>();

async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  const fromMem = memCache.get(key);
  if (fromMem) return fromMem as CacheEntry<T>;
  try {
    const persisted = (await get(key)) as CacheEntry<T> | undefined;
    if (persisted) {
      memCache.set(key, persisted as CacheEntry<unknown>);
      return persisted;
    }
  } catch {
    // IndexedDB unavailable (SSR, private mode, etc.) — fall back silently.
  }
  return null;
}

async function cachePut<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  memCache.set(key, entry as CacheEntry<unknown>);
  try {
    await set(key, entry);
  } catch {
    // Ignore persistence failures; in-memory is still primed.
  }
}

function isFresh(entry: CacheEntry<unknown> | null): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

// ── Network ────────────────────────────────────────────────

function proxyUrl(path: string): string {
  return `${PROXY_BASE}?path=${encodeURIComponent(path)}`;
}

async function fetchIndex(path: string, etag?: string): Promise<{ html: string; etag?: string } | null> {
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(proxyUrl(path), { headers });
  if (res.status === 304) return null;
  if (!res.ok) {
    throw new Error(`AP_Periph index ${path} returned ${res.status}`);
  }
  const html = await res.text();
  const newEtag = res.headers.get("etag") ?? undefined;
  return { html, etag: newEtag };
}

async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(proxyUrl(path));
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Public client ──────────────────────────────────────────

export class ApPeriphManifest {
  /**
   * List release channels (top-level folders under
   * `firmware.ardupilot.org/AP_Periph/`). Returns the embedded
   * baseline if the upstream cannot be reached.
   */
  async listChannels(): Promise<string[]> {
    const key = `${CACHE_PREFIX}:channels`;
    const cached = await cacheGet<string[]>(key);
    if (isFresh(cached)) return cached!.data;

    try {
      const fetched = await fetchIndex("", cached?.etag);
      if (!fetched) {
        return cached?.data ?? [...EMBEDDED_CHANNEL_LIST];
      }
      const entries = parseDirectoryIndex(fetched.html);
      const channels = entries
        .filter((e) => e.isDir && isChannelName(e.name))
        .map((e) => e.name)
        .sort(channelSort);
      await cachePut(key, { data: channels, fetchedAt: Date.now(), etag: fetched.etag });
      return channels;
    } catch {
      if (cached) return cached.data;
      return [...EMBEDDED_CHANNEL_LIST];
    }
  }

  /**
   * List board folders inside a channel. Falls back to the embedded
   * baseline when the upstream is unreachable and the cache is empty.
   */
  async listBoards(channel: string): Promise<string[]> {
    const safe = sanitizeSegment(channel);
    const key = `${CACHE_PREFIX}:${safe}:boards`;
    const cached = await cacheGet<string[]>(key);
    if (isFresh(cached)) return cached!.data;

    try {
      const fetched = await fetchIndex(`${safe}/`, cached?.etag);
      if (!fetched) {
        return cached?.data ?? [...EMBEDDED_BOARD_LIST];
      }
      const entries = parseDirectoryIndex(fetched.html);
      const boards = entries
        .filter((e) => e.isDir && !isChannelName(e.name))
        .map((e) => e.name)
        .sort();
      await cachePut(key, { data: boards, fetchedAt: Date.now(), etag: fetched.etag });
      return boards;
    } catch {
      if (cached) return cached.data;
      return [...EMBEDDED_BOARD_LIST];
    }
  }

  /**
   * Fetch the file listing for a board folder plus the inline text
   * companions (`firmware-version.txt`, `git-version.txt`).
   */
  async getBoardManifest(channel: string, board: string): Promise<BoardManifest> {
    const safeChannel = sanitizeSegment(channel);
    const safeBoard = sanitizeSegment(board);
    const key = `${CACHE_PREFIX}:${safeChannel}:${safeBoard}:manifest`;
    const cached = await cacheGet<BoardManifest>(key);
    if (isFresh(cached)) return cached!.data;

    const folderPath = `${safeChannel}/${safeBoard}/`;
    const fetched = await fetchIndex(folderPath, cached?.etag);
    if (!fetched) {
      if (cached) return cached.data;
      throw new Error(`AP_Periph board ${board} index returned no content`);
    }

    const entries = parseDirectoryIndex(fetched.html);
    const files: BoardFile[] = entries
      .filter((e) => !e.isDir)
      .map((e) => ({
        name: e.name,
        sizeBytes: e.sizeBytes,
        url: `${UPSTREAM_BASE}/${safeChannel}/${safeBoard}/${e.href}`,
        kind: classifyBoardFile(e.name),
      }));

    const [versionTxt, gitTxt] = await Promise.all([
      fetchText(`${folderPath}firmware-version.txt`),
      fetchText(`${folderPath}git-version.txt`),
    ]);

    const manifest: BoardManifest = {
      board,
      channel,
      files,
      version: cleanText(versionTxt),
      gitCommit: extractGitCommit(gitTxt),
      dateLabel: extractDate(gitTxt),
    };

    await cachePut(key, { data: manifest, fetchedAt: Date.now(), etag: fetched.etag });
    return manifest;
  }

  /**
   * Convenience: fetch the OTA payload (`AP_Periph.bin`). Throws when
   * the board folder does not advertise an app binary.
   *
   * The bytes are checked against the size the directory index advertises
   * before they are handed to the flasher. Upstream publishes no hash beside
   * the binary, so the advertised length is the only integrity signal there
   * is — and this used to return the fetched body with NO check at all, so a
   * truncated response (a proxy timeout, a partial transfer) went straight
   * into a CAN bootloader write.
   */
  async downloadFirmware(channel: string, board: string): Promise<Uint8Array> {
    const manifest = await this.getBoardManifest(channel, board);
    const app = manifest.files.find((f) => f.kind === "app");
    if (!app) {
      throw new Error(`AP_Periph board ${board} (${channel}) does not publish AP_Periph.bin`);
    }
    const res = await fetch(`/api/firmware?url=${encodeURIComponent(app.url)}`);
    if (!res.ok) {
      throw new Error(`Failed to download AP_Periph.bin: ${res.status} ${res.statusText}`);
    }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length === 0) {
      throw new Error("Refusing to flash: AP_Periph.bin downloaded as an empty file");
    }
    if (app.sizeBytes !== undefined && bytes.length !== app.sizeBytes) {
      throw new Error(
        `Refusing to flash: AP_Periph.bin is ${bytes.length} bytes but the index advertises ${app.sizeBytes} — the download is incomplete or the index is stale`,
      );
    }
    return bytes;
  }

  /** Clear every cached entry (memory + IndexedDB). */
  async clearCache(): Promise<void> {
    const keys = Array.from(memCache.keys());
    memCache.clear();
    for (const k of keys) {
      try {
        await del(k);
      } catch {
        // Ignore — best effort eviction.
      }
    }
  }
}

// ── Internal helpers ───────────────────────────────────────

function sanitizeSegment(segment: string): string {
  // Strip any directory traversal or stray slashes; leave the rest of
  // the upstream-defined name verbatim so the proxy receives the
  // exact path mod_autoindex exposes.
  return segment.replace(/[^A-Za-z0-9._-]/g, "");
}

function channelSort(a: string, b: string): number {
  const rank = (n: string): number => {
    const lower = n.toLowerCase();
    if (lower === "stable") return 0;
    if (lower === "beta") return 1;
    if (lower === "latest") return 2;
    return 3;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  // Dated folders sort newest-first lexicographically reversed.
  return b.localeCompare(a);
}

function cleanText(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractGitCommit(value: string | null): string | null {
  if (!value) return null;
  const sha = value.match(/[0-9a-f]{7,40}/i);
  return sha ? sha[0] : null;
}

function extractDate(value: string | null): string | null {
  if (!value) return null;
  const dated = value.match(/\d{4}-\d{2}-\d{2}/);
  return dated ? dated[0] : null;
}
