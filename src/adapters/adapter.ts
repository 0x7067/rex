import type { Resource, SnapshotMetadata } from "../core/resource.js";

export interface FileEntry {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}

export interface ResourceAdapter {
  type: "local" | "git" | "package";
  detect(source: string): boolean;
  normalize(source: string): Promise<string>;
  materialize(
    normalizedSource: string,
    targetDir: string,
  ): Promise<SnapshotMetadata>;
  reference(entry: FileEntry, resource: Resource): string;
}
