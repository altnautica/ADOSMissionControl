"use client";

/**
 * Media tab — thumbnail grid of photos/videos linked to a flight.
 *
 * Phase 20b — media display + lightbox.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { get as idbGet } from "idb-keyval";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, X, Image, MapPin } from "lucide-react";
import type { FlightRecord, FlightMedia } from "@/lib/types";

interface MediaTabProps {
  record: FlightRecord;
}

export function MediaTab({ record }: MediaTabProps) {
  const media = record.media ?? [];

  if (media.length === 0) {
    return (
      <Card title="Media" padding={true}>
        <div className="flex flex-col items-center gap-2 py-8">
          <Image size={24} className="text-text-tertiary" />
          <p className="text-[10px] text-text-tertiary">
            No media linked to this flight. Use the Import Media button to add photos or videos.
          </p>
        </div>
      </Card>
    );
  }

  return <MediaGrid media={media} flightId={record.id} />;
}

function MediaGrid({ media, flightId }: { media: FlightMedia[]; flightId: string }) {
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map());
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Load blob URLs for thumbnails
  useEffect(() => {
    let cancelled = false;
    const urls = new Map<string, string>();

    void Promise.all(
      media.map(async (m) => {
        try {
          const blob = await idbGet(m.blobKey) as Blob | undefined;
          if (blob && !cancelled) {
            urls.set(m.id, URL.createObjectURL(blob));
          }
        } catch {
          // Skip missing blobs
        }
      }),
    ).then(() => {
      if (!cancelled) setThumbUrls(new Map(urls));
    });

    return () => {
      cancelled = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [media]);

  const sorted = useMemo(
    () => [...media].sort((a, b) => a.capturedAt - b.capturedAt),
    [media],
  );

  const handleExportZip = useCallback(async () => {
    // Simple ZIP-less bundle: download each file individually
    for (const m of sorted) {
      try {
        const blob = await idbGet(m.blobKey) as Blob | undefined;
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${flightId}-${new Date(m.capturedAt).toISOString().replace(/[:.]/g, "-")}-${m.name}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Skip
      }
    }
  }, [sorted, flightId]);

  return (
    <>
      <Card title={`Media (${sorted.length})`} padding={true}>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-2">
          {sorted.map((m, idx) => {
            const url = thumbUrls.get(m.id);
            const isImage = m.type.startsWith("image/");
            return (
              <button
                key={m.id}
                onClick={() => setLightboxIdx(idx)}
                className="relative aspect-square rounded border border-border-default overflow-hidden bg-bg-tertiary hover:border-accent-primary transition-colors group"
              >
                {url && isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full text-[10px] text-text-tertiary">
                    {isImage ? "Loading…" : "Video"}
                  </div>
                )}
                {m.lat !== undefined && (
                  <MapPin size={10} className="absolute top-1 right-1 text-accent-primary" />
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-[8px] text-text-tertiary truncate opacity-0 group-hover:opacity-100 transition-opacity">
                  {m.name}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={<Download size={12} />} onClick={() => void handleExportZip()}>
            Export all
          </Button>
        </div>
      </Card>

      {lightboxIdx !== null && (
        <Lightbox
          media={sorted}
          urls={thumbUrls}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNavigate={setLightboxIdx}
        />
      )}
    </>
  );
}

// ── Lightbox ─────────────────────────────────────────────────

function Lightbox({
  media,
  urls,
  index,
  onClose,
  onNavigate,
}: {
  media: FlightMedia[];
  urls: Map<string, string>;
  index: number;
  onClose: () => void;
  onNavigate: (idx: number) => void;
}) {
  const item = media[index];
  const url = urls.get(item.id);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      if (e.key === "ArrowRight" && index < media.length - 1) onNavigate(index + 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, media.length, onClose, onNavigate]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {url && item.type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={item.name} className="max-w-full max-h-[80vh] object-contain rounded" />
        ) : url && item.type.startsWith("video/") ? (
          <video src={url} controls className="max-w-full max-h-[80vh] rounded" />
        ) : (
          <div className="text-text-tertiary text-xs">Loading…</div>
        )}

        <div className="mt-2 flex items-center gap-3 text-[10px] text-text-tertiary font-mono">
          <span>{item.name}</span>
          <span>{new Date(item.capturedAt).toLocaleString()}</span>
          {item.lat !== undefined && item.lon !== undefined && (
            <span>{item.lat.toFixed(5)}, {item.lon.toFixed(5)}</span>
          )}
          <span>{index + 1} / {media.length}</span>
        </div>

        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-text-tertiary hover:text-text-primary p-1"
        >
          <X size={16} />
        </button>

        {index > 0 && (
          <button
            onClick={() => onNavigate(index - 1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary text-2xl px-2"
          >
            ‹
          </button>
        )}
        {index < media.length - 1 && (
          <button
            onClick={() => onNavigate(index + 1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary text-2xl px-2"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
