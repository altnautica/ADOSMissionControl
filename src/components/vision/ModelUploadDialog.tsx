"use client";

/**
 * @module vision/ModelUploadDialog
 * @description Two-stage dialog to sideload a custom vision model to one
 * drone's agent. Stage 1 is the drag-drop / file-pick surface (the same
 * pattern as the plugin install dialog's PickStage, accepting the model
 * file formats). Stage 2 collects the metadata the agent's custom-catalog
 * needs (name, detection classes, head family, input dimensions, runtime,
 * board match) and commits via the parent-supplied `onUpload` so the parent
 * owns routing (LAN proxy in the real path, the mock in demo).
 *
 * @license GPL-3.0-only
 */

import { useCallback, useRef, useState } from "react";
import { Upload, AlertTriangle, FileBox } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  VisionUploadMeta,
  VisionUploadResult,
} from "@/lib/agent/vision-client";

const ACCEPT = ".rknn,.onnx,.tflite";

const RUNTIME_OPTIONS = [
  { value: "onnx", label: "ONNX (CPU / portable)" },
  { value: "rknn", label: "RKNN (Rockchip NPU)" },
  { value: "tflite", label: "TFLite" },
];

/** Guess the runtime from a file extension so the form pre-fills sanely. */
function runtimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".rknn")) return "rknn";
  if (lower.endsWith(".tflite")) return "tflite";
  return "onnx";
}

interface ModelUploadDialogProps {
  open: boolean;
  onClose: () => void;
  /** Commit the upload. Resolves with the agent's result envelope. */
  onUpload: (file: File, meta: VisionUploadMeta) => Promise<VisionUploadResult>;
  /** Fired after a successful upload so the parent can refresh its list. */
  onUploaded?: (result: VisionUploadResult) => void;
}

export function ModelUploadDialog({
  open,
  onClose,
  onUpload,
  onUploaded,
}: ModelUploadDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [name, setName] = useState("");
  const [classes, setClasses] = useState("person,car");
  const [head, setHead] = useState("yolov8");
  const [inputW, setInputW] = useState("640");
  const [inputH, setInputH] = useState("640");
  const [runtime, setRuntime] = useState("onnx");
  const [boardMatch, setBoardMatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setDragActive(false);
    setName("");
    setClasses("person,car");
    setHead("yolov8");
    setInputW("640");
    setInputH("640");
    setRuntime("onnx");
    setBoardMatch("");
    setBusy(false);
    setError(null);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, reset, onClose]);

  const accept = useCallback((picked: File) => {
    setFile(picked);
    setError(null);
    setName((prev) => prev || picked.name.replace(/\.[^.]+$/, ""));
    setRuntime(runtimeFromName(picked.name));
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const picked = e.dataTransfer.files?.[0];
      if (picked) accept(picked);
    },
    [accept],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      if (picked) accept(picked);
    },
    [accept],
  );

  const submit = useCallback(async () => {
    if (!file) return;
    const parsedClasses = classes
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (parsedClasses.length === 0) {
      setError("Enter at least one detection class.");
      return;
    }
    const w = Number(inputW);
    const h = Number(inputH);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
      setError("Enter a valid input width and height.");
      return;
    }
    const meta: VisionUploadMeta = {
      name: name.trim() || file.name,
      classes: parsedClasses,
      head: head.trim(),
      inputWidth: w,
      inputHeight: h,
      runtime,
      boardMatch: boardMatch
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean),
    };
    setBusy(true);
    setError(null);
    try {
      const result = await onUpload(file, meta);
      if (result.status === "error") {
        setError(result.message || "Upload failed.");
        setBusy(false);
        return;
      }
      onUploaded?.(result);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusy(false);
    }
  }, [
    file,
    classes,
    inputW,
    inputH,
    name,
    head,
    runtime,
    boardMatch,
    onUpload,
    onUploaded,
    reset,
    onClose,
  ]);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload custom model"
      size="md"
      closeBlocked={busy}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!file || busy}
            loading={busy}
          >
            Upload to drone
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {file ? (
          <div className="flex items-center gap-3 rounded border border-border-default bg-bg-tertiary px-3 py-2">
            <FileBox className="h-4 w-4 shrink-0 text-accent-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">{file.name}</p>
              <p className="text-[11px] text-text-tertiary">
                {(file.size / 1_000_000).toFixed(1)} MB
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Replace
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={onPick}
            />
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center",
              dragActive
                ? "border-accent-primary bg-accent-primary/5"
                : "border-border-default",
            )}
          >
            <Upload className="h-8 w-8 text-text-tertiary" />
            <p className="text-sm text-text-primary">
              Drag a model file here, or pick one.
            </p>
            <p className="text-[11px] text-text-tertiary">
              <code>.rknn</code>, <code>.onnx</code>, <code>.tflite</code>,{" "}
              <code>.engine</code>
            </p>
            <label className="cursor-pointer text-xs text-accent-primary underline">
              <input
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={onPick}
              />
              Choose file
            </label>
          </div>
        )}

        {file ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Model name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Detection classes (comma-separated)"
                value={classes}
                onChange={(e) => setClasses(e.target.value)}
                disabled={busy}
              />
            </div>
            <Input
              label="Head family"
              value={head}
              onChange={(e) => setHead(e.target.value)}
              disabled={busy}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">Runtime</span>
              <Select
                options={RUNTIME_OPTIONS}
                value={runtime}
                onChange={setRuntime}
                disabled={busy}
              />
            </div>
            <Input
              label="Input width"
              type="number"
              value={inputW}
              onChange={(e) => setInputW(e.target.value)}
              disabled={busy}
            />
            <Input
              label="Input height"
              type="number"
              value={inputH}
              onChange={(e) => setInputH(e.target.value)}
              disabled={busy}
            />
            <div className="sm:col-span-2">
              <Input
                label="Board match (optional, comma-separated board ids)"
                value={boardMatch}
                onChange={(e) => setBoardMatch(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
