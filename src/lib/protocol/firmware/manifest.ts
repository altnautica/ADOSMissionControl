/**
 * ArduPilot firmware manifest client.
 *
 * Fetches pre-filtered manifest data from our server-side proxy
 * (/api/manifest) which handles CORS, gzip decompression, and
 * APJ-only filtering. Caches in memory with 1-hour TTL.
 *
 * @module protocol/firmware/manifest
 */

import type { FirmwareManifest, ManifestBoard, ManifestFirmware, ParsedFirmware } from "./types";
import { WITH_BL_REQUIRED_MESSAGE } from "./types";
import { parseApjFile } from "./apj-parser";
import { parseHexFile } from "./hex-parser";

// ── Constants ──────────────────────────────────────────────

const PROXY_URL = "/api/manifest";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── ArduPilotManifest ──────────────────────────────────────

export class ArduPilotManifest {
  private manifest: FirmwareManifest | null = null;
  private fetchedAt = 0;

  /** Get the manifest, using in-memory cache if fresh. */
  async getManifest(): Promise<FirmwareManifest> {
    if (this.manifest && Date.now() - this.fetchedAt < CACHE_TTL) {
      return this.manifest;
    }

    const manifest = await this.fetchManifest();
    this.manifest = manifest;
    this.fetchedAt = Date.now();
    return manifest;
  }

  /** Extract unique board names from manifest. */
  async getBoards(): Promise<ManifestBoard[]> {
    const manifest = await this.getManifest();
    const boardMap = new Map<string, Set<string>>();

    for (const fw of manifest.firmwares) {
      if (!fw.board || !fw.vehicleType) continue;

      if (!boardMap.has(fw.board)) {
        boardMap.set(fw.board, new Set());
      }
      boardMap.get(fw.board)!.add(fw.vehicleType);
    }

    return Array.from(boardMap.entries())
      .map(([name, vehicleTypes]) => ({
        name,
        vehicleTypes: Array.from(vehicleTypes).sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get firmware entries for a specific board, optionally filtered. */
  async getFirmwareForBoard(
    boardName: string,
    vehicleType?: string,
    releaseType?: string,
  ): Promise<ManifestFirmware[]> {
    const manifest = await this.getManifest();
    return manifest.firmwares.filter((fw) => {
      if (fw.board !== boardName) return false;
      if (vehicleType && fw.vehicleType !== vehicleType) return false;
      if (releaseType && fw.releaseType !== releaseType) return false;
      return true;
    });
  }

  /** Get unique release types for a board+vehicle combination, sorted. */
  async getVersions(boardName: string, vehicleType: string): Promise<string[]> {
    const firmwares = await this.getFirmwareForBoard(boardName, vehicleType);

    // Collect unique release types
    const releaseTypes = new Set<string>();
    for (const fw of firmwares) {
      if (fw.releaseType) releaseTypes.add(fw.releaseType);
    }

    // Normalize and sort: stable first, then beta, then dev/latest
    const order = (rt: string): number => {
      const lower = rt.toLowerCase();
      if (lower.startsWith("stable") || lower === "official") return 0;
      if (lower === "beta") return 1;
      if (lower === "latest") return 2;
      if (lower === "dev") return 3;
      return 99;
    };

    return Array.from(releaseTypes).sort((a, b) => order(a) - order(b));
  }

  /** The APJ build for a specific board+type+version (URL plus board id). */
  async getApjFirmware(boardName: string, vehicleType: string, releaseType: string): Promise<ManifestFirmware | null> {
    const firmwares = await this.getFirmwareForBoard(boardName, vehicleType, releaseType);
    return firmwares.find((f) => f.format === "apj") ?? null;
  }

  /**
   * Download and parse a firmware file from URL.
   *
   * `withBootloader` selects the absolute `_with_bl.hex` image (bootloader +
   * application at real flash addresses), which DFU and the ST ROM bootloader
   * need. The .apj application image is only for the ArduPilot bootloader, so
   * there is no fallback to it: a missing `_with_bl.hex` is an error.
   */
  async downloadFirmware(url: string, options?: { withBootloader?: boolean }): Promise<ParsedFirmware> {
    if (options?.withBootloader) {
      if (!url.endsWith(".apj")) throw new Error(WITH_BL_REQUIRED_MESSAGE);
      const hexUrl = url.replace(/\.apj$/, "_with_bl.hex");
      let hexResponse: Response;
      try {
        hexResponse = await fetch(`/api/firmware?url=${encodeURIComponent(hexUrl)}`);
      } catch {
        throw new Error(WITH_BL_REQUIRED_MESSAGE);
      }
      if (!hexResponse.ok) throw new Error(WITH_BL_REQUIRED_MESSAGE);
      return parseHexFile(await hexResponse.text());
    }

    const response = await fetch(`/api/firmware?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      throw new Error(`Failed to download firmware: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();

    try {
      return parseApjFile(text);
    } catch (err) {
      if (url.endsWith(".apj")) throw err;
      throw new Error("Unsupported firmware format. Expected .apj file.");
    }
  }

  /** Clear cached manifest. */
  clearCache(): void {
    this.manifest = null;
    this.fetchedAt = 0;
  }

  // ── Private ────────────────────────────────────────────

  private async fetchManifest(): Promise<FirmwareManifest> {
    const response = await fetch(PROXY_URL);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Manifest proxy returned ${response.status}`);
    }

    const json = await response.json();

    if (json.error) {
      throw new Error(json.error);
    }

    const firmwares: ManifestFirmware[] = (json.firmwares || []).map(
      (entry: Record<string, string | number | undefined>) => ({
        board: String(entry.board ?? ""),
        vehicleType: String(entry.vehicleType ?? ""),
        version: String(entry.version ?? ""),
        releaseType: String(entry.releaseType ?? ""),
        url: String(entry.url ?? ""),
        format: String(entry.format || "apj"),
        gitHash: typeof entry.gitHash === "string" ? entry.gitHash : undefined,
        buildDate: typeof entry.buildDate === "string" ? entry.buildDate : undefined,
        boardId: typeof entry.boardId === "number" ? entry.boardId : undefined,
      }),
    );

    return {
      firmwares,
      formatVersion: json.formatVersion,
    };
  }
}
