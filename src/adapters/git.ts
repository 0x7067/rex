import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import type { Resource, SnapshotMetadata } from "../core/resource.js";
import type { FileEntry, ResourceAdapter } from "./adapter.js";

const GIT_URL_PATTERN = /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/;

function normalizeGitUrl(source: string): string {
  let url = source.trim();
  // Only append .git suffix for remote URLs (not file://)
  if (!url.endsWith(".git") && !url.startsWith("file://")) {
    url = `${url}.git`;
  }
  return url;
}

function repoName(url: string): string {
  const base = url.replace(/\.git$/, "").split("/").pop() ?? "repo";
  return base;
}

export class GitAdapter implements ResourceAdapter {
  readonly type = "git" as const;

  detect(source: string): boolean {
    return GIT_URL_PATTERN.test(source);
  }

  async normalize(source: string): Promise<string> {
    if (!this.detect(source)) {
      throw new Error(`Not a git URL: ${source}`);
    }
    return normalizeGitUrl(source);
  }

  async materialize(
    normalizedSource: string,
    targetDir: string,
  ): Promise<SnapshotMetadata> {
    const git = simpleGit();

    let clonePath: string;
    let branch = "main";
    let lastCommitSha = "";

    const name = repoName(normalizedSource);
    clonePath = path.join(targetDir, name);

    // Ensure the parent snapshots directory exists
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      // Check if clone already exists (guard against simpleGit throwing synchronously)
      const isRepo = fs.existsSync(clonePath)
        ? await simpleGit(clonePath).checkIsRepo().catch(() => false)
        : false;

      if (isRepo) {
        // Pull latest
        await simpleGit(clonePath).pull();
      } else {
        // Fresh clone
        await git.clone(normalizedSource, clonePath);
      }

      const cloneGit = simpleGit(clonePath);
      const branchSummary = await cloneGit.branchLocal();
      branch = branchSummary.current || "main";
      const log = await cloneGit.log({ maxCount: 1 });
      lastCommitSha = log.latest?.hash ?? "";
    } catch (err) {
      throw new Error(
        `Failed to materialize git repo ${normalizedSource}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      type: "git",
      clone_path: clonePath,
      remote_url: normalizedSource,
      branch,
      last_commit_sha: lastCommitSha,
    };
  }

  reference(entry: FileEntry, resource: Resource): string {
    if (resource.snapshot_metadata.type === "git") {
      const host = new URL(resource.snapshot_metadata.remote_url.replace(/\.git$/, "")).hostname;
      const repoPath = new URL(resource.snapshot_metadata.remote_url.replace(/\.git$/, "")).pathname.replace(/^\//, "");
      return `${resource.name} (${host}/${repoPath}): ${entry.relativePath}`;
    }
    return `${resource.name}: ${entry.relativePath}`;
  }
}

export const gitAdapter = new GitAdapter();
