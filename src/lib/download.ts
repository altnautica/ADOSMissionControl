/**
 * @module download
 * @description Save a Blob through the browser's download flow.
 * @license GPL-3.0-only
 */

/** How long the object URL outlives the click. Revoking it right after
 * `click()` can cancel the download before the browser starts reading it. */
const REVOKE_AFTER_MS = 60_000;

/** Trigger a browser download of `blob` saved as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
