"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const FIELD_VALUE_LIMIT = 1024;
const DESCRIPTION_LIMIT = 4000;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1) + "…";
}

function pushField(
  fields: Array<{ name: string; value: string; inline: boolean }>,
  name: string,
  value: string | undefined,
  inline: boolean,
): void {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  fields.push({ name, value: truncate(trimmed, FIELD_VALUE_LIMIT), inline });
}

export const sendContactSubmission = internalAction({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    message: v.string(),
    source: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedin: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn(
        "[discordNotify] DISCORD_WEBHOOK_URL not set; skipping contact notification.",
      );
      return;
    }

    const title = "New contact form submission";
    const color = 0x3b82f6;

    const fields: Array<{ name: string; value: string; inline: boolean }> = [];
    pushField(fields, "Name", args.name, true);
    pushField(fields, "Email", args.email, true);
    pushField(fields, "Subject", args.subject, true);
    pushField(fields, "Source", args.source, true);
    pushField(fields, "Company", args.company, true);
    pushField(fields, "LinkedIn", args.linkedin, false);

    const description = `**Message**\n${truncate(
      args.message.trim() || "(empty)",
      DESCRIPTION_LIMIT - 13,
    )}`;

    const payload = {
      embeds: [
        {
          title,
          color,
          fields,
          description,
          timestamp: new Date().toISOString(),
          footer: { text: "altnautica.com" },
        },
      ],
    };

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Altnautica-Lead-Notifier",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "<unreadable>");
        console.error(
          `[discordNotify] webhook responded ${res.status}: ${body}`,
        );
      }
    } catch (err) {
      console.error("[discordNotify] webhook POST failed:", err);
    }
  },
});
