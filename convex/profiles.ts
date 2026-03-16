import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Internal helper: fetch profile by userId using .first() instead of .unique().
 * Resilient to duplicate profiles — always returns the oldest (first-created) one.
 * Includes fallback for legacy compound userId format (userId|sessionId).
 */
async function getProfileByUserId(
  ctx: QueryCtx | MutationCtx,
  userId: string
) {
  // Direct lookup with stable userId
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  if (profile) return profile;

  // Fallback: find legacy profile with compound format (userId|sessionId)
  // Handles transition period before migrateProfileUserIds runs
  const allProfiles = await ctx.db.query("profiles").collect();
  return allProfiles.find((p) => p.userId.startsWith(userId + "|")) ?? null;
}

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await getProfileByUserId(ctx, userId);
    if (!profile) return null;

    // If profile has no email, try to get it from auth user record
    if (!profile.email) {
      const user = await ctx.db.get(userId as any);
      if (user && typeof user === "object" && "email" in user && user.email) {
        return { ...profile, email: user.email as string };
      }
    }
    return profile;
  },
});

export const updateMyProfile = mutation({
  args: {
    fullName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    showName: v.optional(v.boolean()),
    showEmail: v.optional(v.boolean()),
    showLinkedin: v.optional(v.boolean()),
    showPhone: v.optional(v.boolean()),
    investorType: v.optional(v.string()),
    investorTypeOther: v.optional(v.string()),
    ticketSize: v.optional(v.string()),
    notifyUpdates: v.optional(v.boolean()),
    notifyMilestones: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await getProfileByUserId(ctx, userId);
    if (!profile) throw new Error("Profile not found");

    const updates: Record<string, unknown> = {};
    if (args.fullName !== undefined) updates.fullName = args.fullName;
    if (args.email !== undefined) updates.email = args.email;
    if (args.phone !== undefined) updates.phone = args.phone;
    if (args.company !== undefined) updates.company = args.company;
    if (args.linkedin !== undefined) updates.linkedin = args.linkedin;
    if (args.showName !== undefined) updates.showName = args.showName;
    if (args.showEmail !== undefined) updates.showEmail = args.showEmail;
    if (args.showLinkedin !== undefined) updates.showLinkedin = args.showLinkedin;
    if (args.showPhone !== undefined) updates.showPhone = args.showPhone;
    if (args.investorType !== undefined) updates.investorType = args.investorType;
    if (args.investorTypeOther !== undefined) updates.investorTypeOther = args.investorTypeOther;
    if (args.ticketSize !== undefined) updates.ticketSize = args.ticketSize;
    if (args.notifyUpdates !== undefined)
      updates.notifyUpdates = args.notifyUpdates;
    if (args.notifyMilestones !== undefined)
      updates.notifyMilestones = args.notifyMilestones;

    await ctx.db.patch(profile._id, updates);
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await getProfileByUserId(ctx, userId);
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    return await ctx.db.query("profiles").collect();
  },
});

export const updateRole = mutation({
  args: {
    profileId: v.id("profiles"),
    role: v.union(v.literal("pending"), v.literal("investor"), v.literal("admin"), v.literal("rejected"), v.literal("alpha_tester")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const admin = await getProfileByUserId(ctx, userId);
    if (!admin || admin.role !== "admin") throw new Error("Admin access required");

    // Prevent self-demotion
    const target = await ctx.db.get(args.profileId);
    if (target && target.userId === userId) {
      throw new Error("Cannot change your own role");
    }

    await ctx.db.patch(args.profileId, { role: args.role });
  },
});

export const ensureProfile = mutation({
  args: {
    fullName: v.optional(v.string()),
    company: v.optional(v.string()),
    investorType: v.optional(v.string()),
    investorTypeOther: v.optional(v.string()),
    ticketSize: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if profile already exists (uses .first() — safe with duplicates)
    const existing = await getProfileByUserId(ctx, userId);
    if (existing) {
      // If found via legacy compound userId, migrate it in-place
      if (existing.userId !== userId) {
        await ctx.db.patch(existing._id, { userId });
      }

      // Backfill email from auth user table if profile is missing it
      const updates: Record<string, unknown> = {};
      if (!existing.email) {
        const user = await ctx.db.get(userId as any);
        if (user && typeof user === "object" && "email" in user && (user as any).email) {
          updates.email = (user as any).email;
        }
      }

      // Upsert: merge non-empty args into empty fields (fill-if-missing)
      if (args.fullName && !existing.fullName) updates.fullName = args.fullName;
      if (args.company && !existing.company) updates.company = args.company;
      if (args.investorType && !existing.investorType) updates.investorType = args.investorType;
      if (args.investorTypeOther && !existing.investorTypeOther) updates.investorTypeOther = args.investorTypeOther;
      if (args.ticketSize && !existing.ticketSize) updates.ticketSize = args.ticketSize;
      if (args.linkedin && !existing.linkedin) updates.linkedin = args.linkedin;
      if (args.phone && !existing.phone) updates.phone = args.phone;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }
      return existing._id;
    }

    // First user is admin, everyone else starts as pending
    let role: "pending" | "investor" | "admin" = "pending";
    const anyProfile = await ctx.db.query("profiles").first();
    if (!anyProfile) {
      role = "admin";
    }

    // Get email from auth user table if identity doesn't have it
    let authEmail = identity.email;
    if (!authEmail) {
      const user = await ctx.db.get(userId as any);
      if (user && typeof user === "object" && "email" in user) {
        authEmail = (user as any).email;
      }
    }

    return await ctx.db.insert("profiles", {
      userId,
      role,
      fullName: args.fullName || (identity.name ?? undefined),
      email: authEmail ?? undefined,
      company: args.company,
      investorType: args.investorType,
      investorTypeOther: args.investorTypeOther,
      ticketSize: args.ticketSize,
      linkedin: args.linkedin,
      phone: args.phone,
      showName: false,
      showEmail: false,
      showLinkedin: false,
      showPhone: false,
      notifyUpdates: true,
      notifyMilestones: true,
    });
  },
});

async function deduplicateProfilesImpl(ctx: MutationCtx) {
    const allProfiles = await ctx.db.query("profiles").collect();

    // Group by userId
    const byUser = new Map<string, typeof allProfiles>();
    for (const p of allProfiles) {
      const group = byUser.get(p.userId) ?? [];
      group.push(p);
      byUser.set(p.userId, group);
    }

    let mergedCount = 0;
    let deletedCount = 0;

    for (const [, profiles] of byUser) {
      if (profiles.length <= 1) continue;

      // Sort by creation time (oldest first — _creationTime is built-in)
      profiles.sort((a, b) => a._creationTime - b._creationTime);
      const canonical = profiles[0];
      const duplicates = profiles.slice(1);

      // Merge data from duplicates into canonical (fill-if-missing)
      const updates: Record<string, unknown> = {};
      for (const dup of duplicates) {
        if (dup.fullName && !canonical.fullName && !updates.fullName)
          updates.fullName = dup.fullName;
        if (dup.email && !canonical.email && !updates.email)
          updates.email = dup.email;
        if (dup.phone && !canonical.phone && !updates.phone)
          updates.phone = dup.phone;
        if (dup.company && !canonical.company && !updates.company)
          updates.company = dup.company;
        if (dup.linkedin && !canonical.linkedin && !updates.linkedin)
          updates.linkedin = dup.linkedin;
        if (dup.investorType && !canonical.investorType && !updates.investorType)
          updates.investorType = dup.investorType;
        if (dup.investorTypeOther && !canonical.investorTypeOther && !updates.investorTypeOther)
          updates.investorTypeOther = dup.investorTypeOther;
        if (dup.ticketSize && !canonical.ticketSize && !updates.ticketSize)
          updates.ticketSize = dup.ticketSize;
        // Prefer highest role: admin > investor > pending > rejected
        const roleRank: Record<string, number> = { admin: 3, investor: 2, alpha_tester: 2, pilot: 1, pending: 1, rejected: 0 };
        const currentRole = (updates.role as string) ?? canonical.role;
        if ((roleRank[dup.role] ?? 0) > (roleRank[currentRole] ?? 0)) {
          updates.role = dup.role;
        }
      }

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(canonical._id, updates);
        mergedCount++;
      }

      // Delete duplicates
      for (const dup of duplicates) {
        await ctx.db.delete(dup._id);
        deletedCount++;
      }
    }

    return { mergedCount, deletedCount };
}

export const deduplicateProfiles = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const admin = await getProfileByUserId(ctx, userId);
    if (!admin || admin.role !== "admin") throw new Error("Admin access required");
    return await deduplicateProfilesImpl(ctx);
  },
});

/** CLI-callable version (no auth required). */
export const deduplicateProfilesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await deduplicateProfilesImpl(ctx);
  },
});

/**
 * One-time migration: strip compound "userId|sessionId" down to stable "userId".
 * Run from Convex dashboard after deploying the getAuthUserId fix.
 */
export const migrateProfileUserIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allProfiles = await ctx.db.query("profiles").collect();
    let migratedCount = 0;

    for (const profile of allProfiles) {
      if (profile.userId.includes("|")) {
        const stableId = profile.userId.split("|")[0];
        await ctx.db.patch(profile._id, { userId: stableId });
        migratedCount++;
      }
    }

    return { migratedCount, total: allProfiles.length };
  },
});
