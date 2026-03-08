import fs from "node:fs";
import path from "node:path";
import type { Resource, SnapshotMetadata } from "../core/resource.js";
import type { FileEntry, ResourceAdapter } from "./adapter.js";

export class LocalAdapter implements ResourceAdapter {
  readonly type = "local" as const;

  detect(source: string): boolean {
    // Detect local paths: relative paths starting with ./ or ../, absolute paths,
    // or paths that don't look like URLs or package identifiers
    if (source.startsWith("https://") || source.startsWith("http://") || source.startsWith("git@")) {
      return false;
    }
    // A bare name like "express" looks like a package — but if it exists on disk, treat it as local
    if (/^[a-z][\w-]*(@[\d.]+)?$/.test(source) && !fs.existsSync(source)) {
      return false;
    }
    return source.startsWith("./") || source.startsWith("../") || source.startsWith("/") || fs.existsSync(source);
  }

  async normalize(source: string): Promise<string> {
    const resolved = path.resolve(source);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Local path does not exist: ${resolved}`);
    }
    return resolved;
  }

  async materialize(
    normalizedSource: string,
    _targetDir: string,
  ): Promise<SnapshotMetadata> {
    if (!fs.existsSync(normalizedSource)) {
      throw new Error(`Local path does not exist: ${normalizedSource}`);
    }
    return {
      type: "local",
      absolute_path: normalizedSource,
    };
  }

  reference(entry: FileEntry, resource: Resource): string {
    return `${resource.name}: ${entry.relativePath}`;
  }
}

export const localAdapter = new LocalAdapter();
