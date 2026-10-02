/**
 * Server-side proxy for ArduPilot firmware manifest.
 *
 * Bypasses CORS restrictions, decompresses gzip, and filters
 * to APJ-only entries — reducing ~63MB JSON to ~2-3MB.
 */

import { NextResponse } from "next/server";
import { gunzipSync } from "zlib";

import {
  fetchWithTimeout,
  readArrayBufferWithLimit,
} from "@/lib/net/fetch-with-timeout";

const MANIFEST_URL = "https://firmware.ardupilot.org/manifest.json.gz";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024;

interface CachedData {
  timestamp: number;
  data: { firmwares: FilteredEntry[]; formatVersion?: number };
}

interface FilteredEntry {
  board: string;
  vehicleType: string;
  version: string;
  releaseType: string;
  url: string;
  format: string;
  gitHash?: string;
  buildDate?: string;
  /** APJ_BOARD_ID of the build, checked against the connected FC before flashing. */
  boardId?: number;
}

let cache: CachedData | null = null;

export async function GET() {
  // Return cached if fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const res = await fetchWithTimeout(MANIFEST_URL);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream returned ${res.status}` },
        { status: 502 },
      );
    }

    const compressed = Buffer.from(
      await readArrayBufferWithLimit(res, MAX_COMPRESSED_BYTES),
    );
    const text = gunzipSync(compressed, {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    }).toString("utf-8");
    const json = JSON.parse(text);

    const fwArray: unknown[] = json.firmware || json.firmwares || [];
    const firmwares: FilteredEntry[] = [];

    for (const entry of fwArray as Record<string, unknown>[]) {
      const format = (entry.format as string) || "";
      if (format !== "apj") continue; // only flashable APJ files

      const board = (entry.platform as string) || (entry.board as string) || "";
      const url = (entry.url as string) || "";
      if (!board || !url) continue;

      firmwares.push({
        board,
        vehicleType: (entry["vehicletype"] as string) || "",
        version: (entry["mav-firmware-version"] as string) || "",
        releaseType: (entry["mav-firmware-version-type"] as string) || "",
        url,
        format,
        gitHash: (entry["git-sha"] as string) || undefined,
        buildDate: (entry["build-date"] as string) || undefined,
        boardId: typeof entry["board_id"] === "number" ? entry["board_id"] : undefined,
      });
    }

    const data = { firmwares, formatVersion: json["format-version"] };
    cache = { timestamp: Date.now(), data };

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
