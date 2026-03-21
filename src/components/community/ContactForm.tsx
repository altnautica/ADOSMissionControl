"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { communityApi } from "@/lib/community-api";

export function ContactForm() {
  const t = useTranslations("contact");
  const submit = useMutation(communityApi.contact.submit);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError(t("errorRequired"));
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await submit({
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim() || undefined,
        message: message.trim(),
        source: "command-community",
      });
      setSuccess(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Not authenticated")) {
        setError(t("errorAuth"));
      } else {
        setError(t("errorGeneral"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="text-sm text-status-success bg-status-success/10 px-4 py-3 rounded">
          <p className="font-medium">{t("successTitle")}</p>
          <p className="mt-1 text-status-success/80">
            {t("successDescription")}
          </p>
        </div>
        <button
          onClick={() => setSuccess(false)}
          className="mt-4 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          {t("sendAnother")}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-text-primary mb-1">{t("title")}</h1>
      <p className="text-sm text-text-tertiary mb-6">
        {t("subtitle")}
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="text-xs text-status-error bg-status-error/10 px-3 py-2 rounded">
            {error}
          </div>
        )}

        <div>
          <label className="text-xs text-text-tertiary block mb-1">
            {t("name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={100}
            className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div>
          <label className="text-xs text-text-tertiary block mb-1">
            {t("email")}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            maxLength={200}
            className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div>
          <label className="text-xs text-text-tertiary block mb-1">
            {t("subject")}{" "}
            <span className="text-text-tertiary/60">({t("subjectOptional")})</span>
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("subjectPlaceholder")}
            maxLength={200}
            className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div>
          <label className="text-xs text-text-tertiary block mb-1">
            {t("message")}
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            maxLength={5000}
            placeholder={t("messagePlaceholder")}
            className="w-full bg-bg-primary border border-border-default rounded px-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary resize-y"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-1.5 text-sm font-medium bg-accent-primary text-bg-primary rounded hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? t("sending") : t("send")}
          </button>
        </div>
      </form>
    </div>
  );
}
