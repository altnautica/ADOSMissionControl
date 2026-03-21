"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { X } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import type { ChangelogEntry } from "@/lib/community-types";

interface ChangelogEditorProps {
  entry?: ChangelogEntry;
  onClose: () => void;
}

export function ChangelogEditor({ entry, onClose }: ChangelogEditorProps) {
  const createChangelog = useMutation(communityApi.changelog.create);
  const updateChangelog = useMutation(communityApi.changelog.update);

  const [version, setVersion] = useState(entry?.version || "");
  const [title, setTitle] = useState(entry?.title || "");
  const [body, setBody] = useState(entry?.body || "");
  const [tagsStr, setTagsStr] = useState(entry?.tags?.join(", ") || "");
  const [published, setPublished] = useState(entry?.published ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [translationLocale, setTranslationLocale] = useState("de");
  const [translationTitle, setTranslationTitle] = useState("");
  const [translationDescription, setTranslationDescription] = useState("");
  const [translations, setTranslations] = useState<Record<string, { title: string; description: string }>>(
    entry?.translations ?? {}
  );

  const addTranslation = () => {
    if (translationLocale && (translationTitle || translationDescription)) {
      setTranslations(prev => ({
        ...prev,
        [translationLocale]: { title: translationTitle, description: translationDescription },
      }));
      setTranslationTitle("");
      setTranslationDescription("");
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!version.trim() || !title.trim() || !body.trim()) {
      setError("Version, title, and body are required.");
      return;
    }

    setSubmitting(true);
    setError("");

    const tags = tagsStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (entry) {
        await updateChangelog({
          id: entry._id as never,
          version: version.trim(),
          title: title.trim(),
          body: body.trim(),
          tags,
          published,
        });
      } else {
        await createChangelog({
          version: version.trim(),
          title: title.trim(),
          body: body.trim(),
          tags,
          published,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-bg-secondary border border-border-default rounded w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-medium text-text-primary">
            {entry ? "Edit Release" : "New Release"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && (
            <div className="text-xs text-status-error bg-status-error/10 px-3 py-2 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="text-[10px] text-text-tertiary block mb-1">Version</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. v1.2.0"
              className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
            />
          </div>

          <div>
            <label className="text-[10px] text-text-tertiary block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Release title"
              className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
            />
          </div>

          <div>
            <label className="text-[10px] text-text-tertiary block mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="What changed in this release?"
              className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary resize-y"
            />
          </div>

          <div>
            <label className="text-[10px] text-text-tertiary block mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="e.g. feature, bugfix, breaking"
              className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="accent-accent-primary"
            />
            <span className="text-xs text-text-secondary">Published</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 text-xs font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Saving..." : entry ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
