import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import {
  CONTACT_GLOBAL_POLICY,
  CONTACT_POLICY,
  consumeAttempt,
  sha256Hex,
} from "./lib/rateLimit";

/**
 * Field caps. `submit` is fully anonymous and every accepted call both writes a
 * row and schedules an outbound Discord webhook, so an unbounded `v.string()`
 * was an anonymous write of arbitrary size with an amplification attached.
 * Generous against a real enquiry, finite against a script.
 */
const MAX_SHORT_FIELD = 200;
const MAX_MESSAGE = 5000;

function boundedField(value: string, name: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${name} too long`);
  return trimmed;
}

function boundedOptional(
  value: string | undefined,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedField(value, name, max) || undefined;
}

export const submit = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
    message: v.string(),
    source: v.optional(v.string()),
    company: v.optional(v.string()),
    investorType: v.optional(v.string()),
    linkedin: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = boundedField(args.name, "name", MAX_SHORT_FIELD);
    const email = boundedField(args.email, "email", MAX_SHORT_FIELD);
    const message = boundedField(args.message, "message", MAX_MESSAGE);
    if (!name || !email || !message) {
      throw new Error("name, email and message required");
    }

    // Bucketed by the submitted address, hashed so the limiter table is not a
    // second copy of the contact list, plus a global backstop for an address
    // that changes every call. Consumed before the insert, so a burst is
    // stopped before it reaches the webhook scheduler.
    await consumeAttempt(
      ctx,
      `contact:${await sha256Hex(email.toLowerCase())}`,
      CONTACT_POLICY,
    );
    await consumeAttempt(ctx, "contact:global", CONTACT_GLOBAL_POLICY);

    const bounded = {
      name,
      email,
      message,
      subject: boundedOptional(args.subject, "subject", MAX_SHORT_FIELD),
      source: boundedOptional(args.source, "source", MAX_SHORT_FIELD),
      company: boundedOptional(args.company, "company", MAX_SHORT_FIELD),
      investorType: boundedOptional(
        args.investorType,
        "investorType",
        MAX_SHORT_FIELD,
      ),
      linkedin: boundedOptional(args.linkedin, "linkedin", MAX_SHORT_FIELD),
    };

    const id = await ctx.db.insert("contactSubmissions", bounded);
    await ctx.scheduler.runAfter(
      0,
      internal.discordNotify.sendContactSubmission,
      bounded,
    );
    return id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    return await ctx.db.query("contactSubmissions").order("desc").collect();
  },
});
