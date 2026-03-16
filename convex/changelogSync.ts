"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { marked } from "marked";

const REPOS = [
  { owner: "altnautica", name: "ADOSMissionControl", label: "ADOS Mission Control" },
  { owner: "altnautica", name: "ADOSDroneAgent", label: "ADOS Drone Agent" },
];

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-20b";
const BATCH_SIZE = 10;
const MAX_COMMIT_MSG_CHARS = 500;
const MAX_SEED_PAGES = 5; // 5 pages × 100 = 500 commits max

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

interface GroqCommitSummary {
  title: string;
  body: string;
  tags: string[];
}

// Configure marked for simple output (no GFM extensions that might break)
marked.setOptions({
  breaks: false,
  gfm: true,
});

function getGithubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Altnautica-Changelog-Sync",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `token ${token}`;
  } else {
    console.warn("[changelog-sync] GITHUB_TOKEN not set. Using unauthenticated API (60 req/hr).");
  }
  return headers;
}

function commitUrl(owner: string, name: string, sha: string): string {
  return `https://github.com/${owner}/${name}/commit/${sha}`;
}

function getFullMessage(commit: GitHubCommit): string {
  return commit.commit.message.substring(0, MAX_COMMIT_MSG_CHARS);
}

const VALID_TAGS = ["feature", "fix", "improvement", "refactor", "docs", "ui", "performance", "security"];

function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return ["improvement"];
  const valid = tags.filter((t): t is string => typeof t === "string" && VALID_TAGS.includes(t));
  return valid.length > 0 ? valid : ["improvement"];
}

/** Batch commits to Groq, get per-commit summaries */
async function summarizeBatch(
  commits: GitHubCommit[],
  groqKey: string,
  repoLabel: string
): Promise<GroqCommitSummary[] | null> {
  const systemPrompt = `You summarize git commits for a software changelog. Project: ${repoLabel} by Altnautica (open-source drone software).

Given N commits, return a JSON array of N objects in the SAME order:
[
  {"title": "Short summary (max 80 chars)", "body": "2-3 sentence markdown description", "tags": ["feature"]},
  ...
]

Tags: feature, fix, improvement, refactor, docs, ui, performance, security (pick 1-2).
For trivial commits (bump version, merge, typo), keep body to one short sentence.
JSON array only. No code fences.`;

  const userMessage = commits
    .map((c, i) => `${i + 1}. [${c.sha.substring(0, 7)}] ${getFullMessage(c)}`)
    .join("\n");

  try {
    const res = await fetch(GROQ_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[changelog-sync] Groq API error: ${res.status} — ${errText}`);
      return null;
    }

    const data = await res.json();
    const content = (data.choices?.[0]?.message?.content ?? "").trim();

    if (!content) {
      console.warn("[changelog-sync] Groq returned empty content.");
      return null;
    }

    // Try to parse JSON array, with repair for truncated output
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Attempt to repair truncated JSON array
      // Strip code fences if present
      let cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      // Try closing unclosed strings and objects
      if (cleaned.startsWith("[") && !cleaned.endsWith("]")) {
        // Find last complete object
        const lastClose = cleaned.lastIndexOf("}");
        if (lastClose > 0) {
          cleaned = cleaned.substring(0, lastClose + 1) + "]";
        }
      }
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn("[changelog-sync] Could not repair Groq JSON. Raw:", content.substring(0, 200));
        return null;
      }
    }

    if (!Array.isArray(parsed)) {
      console.warn("[changelog-sync] Groq returned non-array. Falling back.");
      return null;
    }

    return parsed as GroqCommitSummary[];
  } catch (err) {
    console.error("[changelog-sync] Groq batch summarization failed:", err);
    return null;
  }
}

/** Create fallback summary when Groq is unavailable */
function fallbackSummary(commit: GitHubCommit): GroqCommitSummary {
  const firstLine = commit.commit.message.split("\n")[0] || "Update";
  const body = commit.commit.message.length > firstLine.length
    ? commit.commit.message.substring(firstLine.length + 1).trim()
    : firstLine;
  return {
    title: firstLine.substring(0, 80),
    body: body || firstLine,
    tags: ["improvement"],
  };
}

/** Process a batch of commits: summarize with Groq, convert to HTML, insert */
async function processBatch(
  ctx: { runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
  commits: GitHubCommit[],
  groqKey: string | undefined,
  adminId: string,
  repo: { owner: string; name: string; label: string }
) {
  let summaries: GroqCommitSummary[];

  if (groqKey) {
    const groqResult = await summarizeBatch(commits, groqKey, repo.label);
    if (groqResult && groqResult.length === commits.length) {
      summaries = groqResult;
    } else {
      // Groq returned wrong count or failed, use fallback
      console.warn("[changelog-sync] Groq returned mismatched count or failed. Using fallback for this batch.");
      summaries = commits.map(fallbackSummary);
    }
  } else {
    summaries = commits.map(fallbackSummary);
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const summary = summaries[i];
    const title = (summary.title || "Update").substring(0, 200);
    const body = summary.body || commit.commit.message.split("\n")[0];
    const tags = validateTags(summary.tags);

    // Convert markdown body to HTML
    let bodyHtml: string;
    try {
      const result = marked(body);
      bodyHtml = typeof result === "string" ? result : await result;
    } catch {
      bodyHtml = `<p>${body}</p>`;
    }

    const commitDate = Date.parse(commit.commit.author.date);

    await ctx.runMutation(internal.changelogSyncMutations.insertCommitEntry, {
      title,
      body,
      bodyHtml,
      tags,
      commitSha: commit.sha,
      commitUrl: commitUrl(repo.owner, repo.name, commit.sha),
      commitDate: isNaN(commitDate) ? Date.now() : commitDate,
      authorId: adminId,
      repo: repo.name,
    });
  }
}

/** Fetch a single page of commits from GitHub */
async function fetchCommitPage(
  owner: string,
  name: string,
  page: number,
  perPage: number = 100
): Promise<{ commits: GitHubCommit[]; hasMore: boolean } | null> {
  const url = `https://api.github.com/repos/${owner}/${name}/commits?sha=main&per_page=${perPage}&page=${page}`;
  try {
    const res = await fetch(url, { headers: getGithubHeaders() });

    if (res.status === 403) {
      console.warn(`[changelog-sync] GitHub rate limit hit (403) for ${owner}/${name}.`);
      return null;
    }
    if (!res.ok) {
      console.error(`[changelog-sync] GitHub API error for ${owner}/${name}: ${res.status} ${res.statusText}`);
      return null;
    }

    const commits: GitHubCommit[] = await res.json();
    return {
      commits,
      hasMore: commits.length === perPage,
    };
  } catch (err) {
    console.error(`[changelog-sync] Failed to fetch GitHub commits for ${owner}/${name}:`, err);
    return null;
  }
}

// ── Hourly sync (cron) ─────────────────────────────────────────

export const syncFromGithub = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get admin profile once
    const admin = await ctx.runQuery(
      internal.changelogSyncMutations.getAdminProfile
    );
    if (!admin) {
      console.warn("[changelog-sync] No admin profile found. Cannot create entries.");
      return;
    }

    const groqKey = process.env.GROQ_API_KEY;

    for (const repo of REPOS) {
      const repoSlug = `${repo.owner}/${repo.name}`;
      console.log(`[changelog-sync] Checking ${repoSlug}...`);

      // 1. Get current sync state for this repo
      const syncState = await ctx.runQuery(
        internal.changelogSyncMutations.getSyncState,
        { repo: repoSlug }
      );
      const lastSha = syncState?.lastSyncedSha ?? null;

      if (!lastSha) {
        console.log(`[changelog-sync] No sync state for ${repoSlug}. Run seedFromGithub first.`);
        continue;
      }

      // 2. Fetch latest commits
      const result = await fetchCommitPage(repo.owner, repo.name, 1);
      if (!result || result.commits.length === 0) {
        console.log(`[changelog-sync] No commits fetched for ${repoSlug}.`);
        continue;
      }

      // 3. Filter to new commits since lastSha
      const lastIdx = result.commits.findIndex((c) => c.sha === lastSha);
      if (lastIdx === 0) {
        console.log(`[changelog-sync] No new commits for ${repoSlug} since last sync.`);
        continue;
      }

      const newCommits = lastIdx === -1 ? result.commits : result.commits.slice(0, lastIdx);
      if (newCommits.length === 0) {
        console.log(`[changelog-sync] No new commits to process for ${repoSlug}.`);
        continue;
      }

      console.log(`[changelog-sync] Processing ${newCommits.length} new commits for ${repoSlug}.`);

      // 4. Process in batches (oldest first)
      const chronological = [...newCommits].reverse();

      for (let i = 0; i < chronological.length; i += BATCH_SIZE) {
        const batch = chronological.slice(i, i + BATCH_SIZE);
        await processBatch(
          ctx as unknown as { runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
          batch, groqKey, admin._id, repo
        );

        // Update sync state after each batch succeeds
        const lastInBatch = batch[batch.length - 1];
        await ctx.runMutation(internal.changelogSyncMutations.updateSyncState, {
          lastSyncedSha: lastInBatch.sha,
          lastSyncedAt: Date.now(),
          repo: repoSlug,
        });
      }

      // Update to the absolute newest SHA
      await ctx.runMutation(internal.changelogSyncMutations.updateSyncState, {
        lastSyncedSha: newCommits[0].sha,
        lastSyncedAt: Date.now(),
        repo: repoSlug,
      });

      console.log(`[changelog-sync] Done with ${repoSlug}. Processed ${newCommits.length} commits.`);
    }
  },
});

// ── Seed action (manual, first run) ────────────────────────────

export const seedFromGithub = internalAction({
  args: {},
  handler: async (ctx) => {
    console.log("[changelog-seed] Starting full seed from GitHub...");

    // 1. Get admin profile
    const admin = await ctx.runQuery(
      internal.changelogSyncMutations.getAdminProfile
    );
    if (!admin) {
      console.error("[changelog-seed] No admin profile found. Sign up first.");
      return;
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      console.warn("[changelog-seed] GROQ_API_KEY not set. Entries will use raw commit messages.");
    }

    for (const repo of REPOS) {
      const repoSlug = `${repo.owner}/${repo.name}`;
      console.log(`[changelog-seed] Seeding ${repoSlug}...`);

      // 2. Fetch all commits (paginated)
      const allCommits: GitHubCommit[] = [];
      for (let page = 1; page <= MAX_SEED_PAGES; page++) {
        const result = await fetchCommitPage(repo.owner, repo.name, page);
        if (!result) break;
        allCommits.push(...result.commits);
        console.log(`[changelog-seed] [${repo.name}] Fetched page ${page}: ${result.commits.length} commits (total: ${allCommits.length})`);
        if (!result.hasMore) break;
      }

      if (allCommits.length === 0) {
        console.log(`[changelog-seed] No commits found for ${repoSlug}.`);
        continue;
      }

      // 3. Process oldest-first
      const chronological = [...allCommits].reverse();

      let processed = 0;
      for (let i = 0; i < chronological.length; i += BATCH_SIZE) {
        const batch = chronological.slice(i, i + BATCH_SIZE);
        await processBatch(
          ctx as unknown as { runMutation: (ref: unknown, args: unknown) => Promise<unknown> },
          batch, groqKey, admin._id, repo
        );
        processed += batch.length;
        console.log(`[changelog-seed] [${repo.name}] Processed ${processed}/${chronological.length} commits`);
      }

      // 4. Set sync state to newest commit
      await ctx.runMutation(internal.changelogSyncMutations.updateSyncState, {
        lastSyncedSha: allCommits[0].sha,
        lastSyncedAt: Date.now(),
        repo: repoSlug,
      });

      console.log(`[changelog-seed] Done with ${repoSlug}. Seeded ${processed} commits.`);
    }

    console.log("[changelog-seed] Full seed complete.");
  },
});
