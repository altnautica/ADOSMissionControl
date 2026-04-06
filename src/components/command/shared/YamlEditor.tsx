"use client";

/**
 * @module YamlEditor
 * @description Monaco editor in YAML mode for ADOS mission definitions (Tier 3).
 * @license GPL-3.0-only
 */

import { useRef, useEffect } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Play, Square, Save, Upload, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

const YAML_TEMPLATE = `# ADOS Mission Definition
# Docs: https://docs.altnautica.com/yaml-missions

mission:
  name: "My Mission"
  version: 1
  description: "A simple waypoint mission"

takeoff:
  altitude: 30
  speed: 3.0

waypoints:
  - lat: 12.9716
    lon: 77.5946
    alt: 30
    hold: 2
    action: photo

  - lat: 12.9720
    lon: 77.5950
    alt: 30
    speed: 5.0

end_action: rtl

safety:
  max_altitude: 120
  geofence_radius: 500
  min_battery: 20
`;

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  onSave: () => void;
  onPreview?: () => void;
  isRunning: boolean;
  fileName: string;
}

export function YamlEditorPanel({
  value,
  onChange,
  onRun,
  onSave,
  onPreview,
  isRunning,
  fileName,
}: YamlEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Reuse the ADOS dark theme (defined by MonacoEditor on first mount)
    try {
      monaco.editor.setTheme("ados-dark");
    } catch {
      // Theme not yet defined, define it
      monaco.editor.defineTheme("ados-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6a737d" },
          { token: "keyword", foreground: "3A82FF" },
          { token: "string", foreground: "DFF140" },
          { token: "number", foreground: "DFF140" },
        ],
        colors: {
          "editor.background": "#0A0A0F",
          "editor.foreground": "#E8E8ED",
          "editorLineNumber.foreground": "#4A4A5A",
          "editorLineNumber.activeForeground": "#8A8A9A",
          "editor.selectionBackground": "#3A82FF30",
          "editor.lineHighlightBackground": "#1A1A25",
          "editorCursor.foreground": "#3A82FF",
        },
      });
      monaco.editor.setTheme("ados-dark");
    }
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.addCommand(2097, () => onSave());
  }, [onSave]);

  const displayValue = value || YAML_TEMPLATE;

  return (
    <div className="flex flex-col flex-1 min-w-0 border border-border-default rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default">
        <span className="text-xs text-text-secondary font-mono truncate flex-1">
          {fileName.replace(".py", ".yaml")}
        </span>
        {onPreview && (
          <button
            onClick={onPreview}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
            title="Preview waypoints on map"
          >
            <Eye size={12} />
            Preview
          </button>
        )}
        <button
          onClick={onSave}
          className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
          title="Save (Ctrl+S)"
        >
          <Save size={12} />
          Save
        </button>
        <button
          onClick={onRun}
          disabled={isRunning}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors",
            isRunning
              ? "bg-status-error/20 text-status-error"
              : "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
          )}
        >
          {isRunning ? <Square size={12} /> : <Upload size={12} />}
          {isRunning ? "Uploading..." : "Upload & Run"}
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-[200px]">
        <Editor
          defaultLanguage="yaml"
          value={displayValue}
          onChange={(v) => onChange(v ?? "")}
          onMount={handleMount}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            minimap: { enabled: false },
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            padding: { top: 8 },
            renderLineHighlight: "line",
            tabSize: 2,
            wordWrap: "on",
            folding: true,
            foldingStrategy: "indentation",
          }}
          theme="ados-dark"
        />
      </div>
    </div>
  );
}
