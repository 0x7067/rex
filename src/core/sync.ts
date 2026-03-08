import { localAdapter } from "../adapters/local.js";
import { gitAdapter } from "../adapters/git.js";
import { packageAdapter } from "../adapters/package.js";
import type { ResourceAdapter } from "../adapters/adapter.js";
import { indexResourceFiles } from "../indexing/pipeline.js";
import {
  countChunks,
  deleteSummaries,
} from "../indexing/store.js";
import { generateSummaries } from "../query/answerer.js";
import type { ProviderConfig, Resource } from "./resource.js";
import { updateResource } from "./registry.js";
import { snapshotsDir } from "./config.js";

const ADAPTERS: ResourceAdapter[] = [localAdapter, gitAdapter, packageAdapter];

function getAdapter(type: string): ResourceAdapter {
  const adapter = ADAPTERS.find((a) => a.type === type);
  if (!adapter) throw new Error(`Unknown resource type: ${type}`);
  return adapter;
}

export interface SyncResult {
  name: string;
  filesChanged: number;
  chunksUpdated: number;
  status: "ok" | "partial" | "failed";
  error?: string;
}

export async function syncResource(
  resource: Resource,
  providerConfig: ProviderConfig,
  fullSync = false,
  onProgress?: (msg: string) => void,
): Promise<SyncResult> {
  const adapter = getAdapter(resource.type);

  // Re-materialize to pick up changes
  onProgress?.(`Materializing ${resource.name}...`);
  try {
    await adapter.materialize(
      resource.normalized_source,
      snapshotsDir(),
    );
  } catch (err) {
    const updated = {
      ...resource,
      last_sync_status: "failed" as const,
    };
    updateResource(updated);
    return {
      name: resource.name,
      filesChanged: 0,
      chunksUpdated: 0,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const materializedDir = getMaterializedDir(resource);

  if (fullSync) {
    await deleteSummaries(resource.id);
  }
  let indexResult;
  try {
    indexResult = await indexResourceFiles({
      resource,
      materializedDir,
      includeRules: resource.include_rules,
      excludeRules: resource.exclude_rules,
      fullSync,
      onProgress,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const currentChunkCount = await countChunks(resource.id);
    const partial: Resource = {
      ...resource,
      last_sync_status: "partial",
      last_sync_at: new Date().toISOString(),
      chunk_count: currentChunkCount,
      index_profile: resource.index_profile,
    };
    updateResource(partial);
    return {
      name: resource.name,
      filesChanged: 0,
      chunksUpdated: 0,
      status: "partial",
      error: errMsg,
    };
  }

  const { filesChanged, chunksUpdated } = indexResult;
  const allChunkTexts = indexResult.changedChunkTexts;

  // Regenerate summaries if anything changed
  if (filesChanged > 0 || indexResult.forcedFullSync) {
    await deleteSummaries(resource.id);
    if (allChunkTexts.length > 0) {
      await generateSummaries(resource, allChunkTexts, providerConfig, onProgress);
    }
  }

  const chunkCount = await countChunks(resource.id);

  const updated: Resource = {
    ...resource,
    last_sync_status: "ok",
    last_sync_at: new Date().toISOString(),
    chunk_count: chunkCount,
    index_profile: indexResult.indexProfile,
  };
  updateResource(updated);

  return {
    name: resource.name,
    filesChanged,
    chunksUpdated,
    status: "ok",
  };
}

function getMaterializedDir(resource: Resource): string {
  switch (resource.snapshot_metadata.type) {
    case "local":
      return resource.snapshot_metadata.absolute_path;
    case "git":
      return resource.snapshot_metadata.clone_path;
    case "package":
      return resource.snapshot_metadata.extract_path;
  }
}
