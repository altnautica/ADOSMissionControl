"use client";

/**
 * @module atlas/viewers/RerunViewer
 * @description Mounts the Rerun web viewer on a world artifact (an `.rrd`
 * recording). Client-only: the viewer is a WASM bundle, reached through an
 * in-effect dynamic import so it never enters the static graph (and never loads
 * under SSR or a test render).
 *
 * We do NOT hand Rerun the recording URL to fetch itself. The artifact is reached
 * through the same-origin proxy `/api/lan-pair/artifact?host=…&path=…`, whose
 * query string (no `.rrd` extension) Rerun's own loader does not reliably open —
 * it silently falls back to its empty "welcome" screen. Instead we fetch the
 * recording bytes through the same proxy the other viewers use (which also gives
 * a real download progress bar for a large recording) and push them into the
 * viewer over a log channel (`open_channel().send_rrd`). A failed fetch/start
 * surfaces an error overlay rather than a silent blank.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import type { WebViewer, LogChannel } from "@rerun-io/web-viewer";
import { ViewerError } from "./ViewerError";
import { ViewerLoading } from "./ViewerLoading";
import {
  fetchArrayBufferWithProgress,
  type FetchProgress,
} from "@/lib/net/fetch-with-progress";

/** Poll a getter until it is true (Rerun exposes readiness as a getter, with no
 * guaranteed event), bounded so a viewer that never becomes ready gives up. */
async function waitReady(
  check: () => boolean,
  tries = 300,
  stepMs = 50,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return check();
}

export default function RerunViewer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Serializes construct-after-stop across effect runs so a StrictMode
  // double-mount or a url change can't stack two WebViewer canvases on the host.
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<FetchProgress | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setFailed(false);
    setLoading(true);
    setProgress(null);
    const abort = new AbortController();
    let cancelled = false;
    let viewer: WebViewer | null = null;
    let channel: LogChannel | null = null;

    const run = lifecycle.current.then(async () => {
      if (cancelled || !hostRef.current) return;
      try {
        const { WebViewer } = await import("@rerun-io/web-viewer");
        if (cancelled || !hostRef.current) return;
        host.replaceChildren();
        const v = new WebViewer();
        viewer = v;
        // Start empty; the recording is pushed as bytes below.
        await v.start(null, host, null);
        if (cancelled) return;

        // Fetch the recording through our proxy (key rides the query string),
        // with a determinate progress bar for the large download.
        const buffer = await fetchArrayBufferWithProgress(url, {
          signal: abort.signal,
          onProgress: (p) => {
            if (!cancelled) setProgress(p);
          },
        });
        if (cancelled) return;

        await waitReady(() => v.ready);
        const ch = v.open_channel("atlas-world");
        channel = ch;
        await waitReady(() => ch.ready);
        if (cancelled) return;
        ch.send_rrd(new Uint8Array(buffer));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setFailed(true);
        }
      }
    });
    lifecycle.current = run;

    return () => {
      cancelled = true;
      abort.abort();
      // Tear down only after this run settles; the next effect's start is chained
      // on it, so it waits for the teardown.
      lifecycle.current = run.then(() => {
        try {
          channel?.close();
        } catch {
          /* already gone */
        }
        try {
          viewer?.stop();
        } catch {
          /* already gone */
        }
      });
    };
  }, [url]);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      {/* `absolute inset-0` — a definite-size box (see SplatViewer); Rerun's
          canvas needs a real height, not a collapsing percentage height. */}
      <div ref={hostRef} className="absolute inset-0" />
      {loading && !failed && (
        <ViewerLoading
          percent={progress?.percent ?? undefined}
          receivedBytes={progress?.receivedBytes}
          totalBytes={progress?.totalBytes ?? undefined}
          label="Loading world"
        />
      )}
      {failed && <ViewerError what="Rerun" />}
    </div>
  );
}
