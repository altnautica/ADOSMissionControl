"use client";

/**
 * @module ScriptsTab
 * @description Script management with Console mode and full Monaco IDE editor mode.
 * @license GPL-3.0-only
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Send, Trash2, TerminalSquare, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { ScriptLibrary } from "./shared/ScriptLibrary";
import { MonacoEditorPanel } from "./shared/MonacoEditor";
import { ScriptConsole } from "./shared/ScriptConsole";
import { VariableInspector } from "./shared/VariableInspector";
import type { CommandResult, ScriptInfo } from "@/lib/agent/types";

type Mode = "console" | "editor";

interface HistoryEntry {
  id: number;
  command: string;
  result: CommandResult | null;
  timestamp: number;
}

const quickCommands = [
  { label: "Arm", cmd: "arm" },
  { label: "Disarm", cmd: "disarm" },
  { label: "Takeoff", cmd: "takeoff", args: [10] },
  { label: "Land", cmd: "land" },
  { label: "RTL", cmd: "rtl" },
  { label: "Stabilize", cmd: "mode", args: ["stabilize"] },
  { label: "Loiter", cmd: "mode", args: ["loiter"] },
];

const NEW_SCRIPT_CONTENT = `"""New ADOS script."""
from ados import drone

async def main():
    # Your code here
    pass

main()
`;

export function ScriptsTab() {
  const t = useTranslations("scripts");
  const [mode, setMode] = useState<Mode>("editor");

  // Console state
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [nextId, setNextId] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Editor state
  const [selectedScript, setSelectedScript] = useState<ScriptInfo | null>(null);
  const [editorContent, setEditorContent] = useState("");

  const connected = useAgentConnectionStore((s) => s.connected);
  const sendCommand = useAgentSystemStore((s) => s.sendCommand);
  const scripts = useAgentScriptsStore((s) => s.scripts);
  const fetchScripts = useAgentScriptsStore((s) => s.fetchScripts);
  const saveScript = useAgentScriptsStore((s) => s.saveScript);
  const deleteScript = useAgentScriptsStore((s) => s.deleteScript);
  const runScript = useAgentScriptsStore((s) => s.runScript);
  const scriptOutput = useAgentScriptsStore((s) => s.scriptOutput);
  const runningScript = useAgentScriptsStore((s) => s.runningScript);

  useEffect(() => {
    if (connected) fetchScripts();
  }, [connected, fetchScripts]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  // Select first script when scripts load
  useEffect(() => {
    if (scripts.length > 0 && !selectedScript) {
      setSelectedScript(scripts[0]);
      setEditorContent(scripts[0].content);
    }
  }, [scripts, selectedScript]);

  const executeCommand = useCallback(
    async (cmd: string, args?: unknown[]) => {
      if (!connected) return;
      const id = nextId;
      setNextId((n) => n + 1);
      const result = await sendCommand(cmd, args);
      setHistory((prev) => [
        ...prev,
        { id, command: args ? `${cmd} ${JSON.stringify(args)}` : cmd, result, timestamp: Date.now() },
      ]);
    },
    [connected, sendCommand, nextId]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    executeCommand(cmd, args.length > 0 ? args : undefined);
    setInput("");
  }

  function handleSelectScript(script: ScriptInfo) {
    setSelectedScript(script);
    setEditorContent(script.content);
  }

  function handleNewScript() {
    const newScript: ScriptInfo = {
      id: `new-${Date.now()}`,
      name: "untitled.py",
      content: NEW_SCRIPT_CONTENT,
      lastModified: new Date().toISOString(),
    };
    setSelectedScript(newScript);
    setEditorContent(NEW_SCRIPT_CONTENT);
  }

  async function handleSave() {
    if (!selectedScript) return;
    await saveScript(selectedScript.name, editorContent, selectedScript.suite);
  }

  async function handleRun() {
    if (!selectedScript) return;
    // If script exists on server, run it. Otherwise save first
    const existing = scripts.find((s) => s.id === selectedScript.id);
    if (existing) {
      await runScript(existing.id);
    } else {
      const saved = await saveScript(selectedScript.name, editorContent, selectedScript.suite);
      if (saved) await runScript(saved.id);
    }
  }

  async function handleDelete(id: string) {
    await deleteScript(id);
    if (selectedScript?.id === id) {
      setSelectedScript(null);
      setEditorContent("");
    }
  }

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border-default">
        <button
          onClick={() => setMode("console")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors",
            mode === "console"
              ? "bg-bg-tertiary text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          <TerminalSquare size={12} />
          {t("console")}
        </button>
        <button
          onClick={() => setMode("editor")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors",
            mode === "editor"
              ? "bg-bg-tertiary text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          <Code2 size={12} />
          {t("editor")}
        </button>
      </div>

      {mode === "console" ? (
        /* Console Mode */
        <div className="flex flex-col flex-1 p-4 gap-4 max-w-3xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-tertiary">{t("quick")}</span>
            {quickCommands.map((qc) => (
              <button
                key={qc.cmd + (qc.args ? JSON.stringify(qc.args) : "")}
                onClick={() => executeCommand(qc.cmd, qc.args)}
                className="px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors"
              >
                {qc.label}
              </button>
            ))}
          </div>

          <div
            ref={scrollRef}
            className="flex-1 border border-border-default rounded-lg overflow-y-auto p-3 font-mono text-xs space-y-2 min-h-[200px]"
          >
            {history.length === 0 ? (
              <p className="text-text-tertiary text-center py-8">
                {t("commandHistoryEmpty")}
              </p>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-accent-primary">$</span>
                    <span className="text-text-primary">{entry.command}</span>
                    <span className="text-text-tertiary ml-auto">
                      {new Date(entry.timestamp).toLocaleTimeString("en-IN", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  {entry.result && (
                    <div
                      className={cn(
                        "pl-4",
                        entry.result.success
                          ? "text-status-success"
                          : "text-status-error"
                      )}
                    >
                      {entry.result.message}
                    </div>
                  )}
                  {!entry.result && (
                    <div className="pl-4 text-status-error">{t("noResponse")}</div>
                  )}
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 border border-border-default rounded-lg px-3 py-2 focus-within:border-accent-primary transition-colors">
              <span className="text-accent-primary text-xs font-mono">$</span>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("enterCommandPlaceholder")}
                className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-2 text-accent-primary hover:bg-bg-tertiary rounded transition-colors disabled:opacity-30"
              title={t("sendCommand")}
            >
              <Send size={14} />
            </button>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="p-2 text-text-tertiary hover:text-status-error hover:bg-bg-tertiary rounded transition-colors"
              title={t("clearHistory")}
            >
              <Trash2 size={14} />
            </button>
          </form>
        </div>
      ) : (
        /* Editor Mode */
        <div className="flex flex-1 min-h-0">
          <ScriptLibrary
            scripts={scripts}
            selectedId={selectedScript?.id ?? null}
            onSelect={handleSelectScript}
            onNew={handleNewScript}
            onDelete={handleDelete}
          />
          <div className="flex flex-col flex-1 min-w-0 p-2 gap-2">
            <div className="flex flex-1 min-h-0 gap-2">
              <MonacoEditorPanel
                value={editorContent}
                onChange={setEditorContent}
                onRun={handleRun}
                onSave={handleSave}
                isRunning={runningScript !== null}
                fileName={selectedScript?.name ?? "untitled.py"}
              />
              <VariableInspector />
            </div>
            <ScriptConsole
              output={scriptOutput}
              isRunning={runningScript !== null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
