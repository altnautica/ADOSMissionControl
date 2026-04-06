"use client";

/**
 * @module BlocklyEditor
 * @description Blockly visual block editor for ADOS drone scripting (Tier 5).
 * Renders Blockly workspace with ADOS custom blocks and generates Python code.
 * @license GPL-3.0-only
 */

import { useRef, useEffect, useCallback, useState } from "react";
import { Play, Square, Save, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BlocklyEditorProps {
  onCodeGenerated: (code: string) => void;
  onRun: () => void;
  onSave: () => void;
  isRunning: boolean;
  fileName: string;
  initialState?: string;
  onStateChange?: (state: string) => void;
  onSwitchToCode: () => void;
}

export function BlocklyEditor({
  onCodeGenerated,
  onRun,
  onSave,
  isRunning,
  fileName,
  initialState,
  onStateChange,
  onSwitchToCode,
}: BlocklyEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<unknown>(null);
  const [generatedCode, setGeneratedCode] = useState("");
  const [showCode, setShowCode] = useState(true);
  const initRef = useRef(false);

  const updateCode = useCallback(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    import("@/lib/blockly/ados-python-generator").then(({ generateScript }) => {
      const code = generateScript(workspace as never);
      setGeneratedCode(code);
      onCodeGenerated(code);
    });
  }, [onCodeGenerated]);

  // Initialize Blockly workspace
  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    // Dynamic import to avoid SSR issues
    Promise.all([
      import("blockly"),
      import("@/lib/blockly/ados-blocks"),
      import("@/lib/blockly/ados-theme"),
      import("@/lib/blockly/block-categories"),
      import("@/lib/blockly/ados-python-generator"),
    ]).then(([Blockly, _blocks, { adosTheme }, { toolboxCategories }]) => {
      if (!containerRef.current) return;

      const workspace = Blockly.inject(containerRef.current, {
        toolbox: toolboxCategories,
        theme: adosTheme,
        grid: {
          spacing: 20,
          length: 3,
          colour: "#1A1A25",
          snap: true,
        },
        zoom: {
          controls: true,
          wheel: true,
          startScale: 0.9,
          maxScale: 2,
          minScale: 0.3,
          scaleSpeed: 1.1,
        },
        trashcan: true,
        move: {
          scrollbars: { horizontal: true, vertical: true },
          drag: true,
          wheel: false,
        },
        renderer: "zelos",
        sounds: false,
      });

      workspaceRef.current = workspace;

      // Load initial state if provided (JSON serialization)
      if (initialState) {
        try {
          const state = JSON.parse(initialState);
          Blockly.serialization.workspaces.load(state, workspace);
        } catch {
          // Invalid state, start fresh
        }
      }

      // Listen for changes
      workspace.addChangeListener((event: { type: string }) => {
        if (
          event.type === "block_change" ||
          event.type === "move" ||
          event.type === "delete" ||
          event.type === "create" ||
          event.type === "var_create" ||
          event.type === "var_rename" ||
          event.type === "var_delete"
        ) {
          updateCode();

          // Serialize to JSON for persistence
          if (onStateChange) {
            const state = Blockly.serialization.workspaces.save(workspace);
            onStateChange(JSON.stringify(state));
          }
        }
      });

      // Initial code generation
      updateCode();
    });

    return () => {
      if (workspaceRef.current) {
        (workspaceRef.current as { dispose: () => void }).dispose();
        workspaceRef.current = null;
        initRef.current = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col flex-1 min-w-0 border border-border-default rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default">
        <span className="text-xs text-text-secondary font-mono truncate">
          {fileName.replace(".py", ".blockly")}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCode(!showCode)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 text-xs transition-colors rounded",
            showCode
              ? "bg-bg-tertiary text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
          title="Toggle generated code preview"
        >
          <Code2 size={12} />
          Code
        </button>
        <button
          onClick={onSwitchToCode}
          className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
          title="Switch to code editor with generated Python"
        >
          Edit as Python
        </button>
        <button
          onClick={onSave}
          className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
          title="Save"
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
              : "bg-status-success/20 text-status-success hover:bg-status-success/30"
          )}
        >
          {isRunning ? <Square size={12} /> : <Play size={12} />}
          {isRunning ? "Running..." : "Run"}
        </button>
      </div>

      {/* Workspace + Code Preview */}
      <div className="flex flex-1 min-h-0">
        {/* Blockly workspace */}
        <div ref={containerRef} className="flex-1 min-h-[300px]" />

        {/* Generated code preview */}
        {showCode && (
          <div className="w-[300px] border-l border-border-default bg-[#0A0A0F] overflow-auto">
            <div className="px-3 py-1.5 border-b border-border-default bg-bg-secondary">
              <span className="text-xs text-text-tertiary">Generated Python</span>
            </div>
            <pre className="p-3 text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
              {generatedCode || "// Drag blocks to generate code"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
