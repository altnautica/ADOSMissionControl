/**
 * @module community-types
 * @description TypeScript types for the community board feature.
 * Mirrors the Convex schema defined in website/convex/schema.ts.
 * @license GPL-3.0-only
 */

export type ItemType = "feature" | "bug";

export type ItemStatus =
  | "backlog"
  | "in_discussion"
  | "planned"
  | "in_progress"
  | "released"
  | "wont_do";

export type ItemCategory = "command" | "ados" | "website" | "general";

export type ItemPriority = "low" | "medium" | "high" | "critical";

export interface CommunityItem {
  _id: string;
  type: ItemType;
  title: string;
  body: string;
  authorId: string;
  authorName?: string;
  status: ItemStatus;
  category: ItemCategory;
  priority?: ItemPriority;
  upvoteCount: number;
  eta?: string;
  resolvedVersion?: string;
  translations?: Record<string, { title: string; description: string }>;
  _creationTime: number;
}

export interface ChangelogEntry {
  _id: string;
  version: string;
  title: string;
  body: string;
  bodyHtml?: string;
  publishedAt: number;
  authorName?: string;
  tags?: string[];
  published: boolean;
  source?: "auto" | "manual";
  commitSha?: string;
  commitUrl?: string;
  commitDate?: number;
  editedByAdmin?: boolean;
  repo?: string;
  translations?: Record<string, { title: string; description: string }>;
  _creationTime: number;
}

export interface CommunityComment {
  _id: string;
  targetType: string;
  targetId: string;
  authorId: string;
  authorName?: string;
  authorRole?: string;
  body: string;
  deleted?: boolean;
  _creationTime: number;
}
