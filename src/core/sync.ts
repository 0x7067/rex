import { localAdapter } from "../adapters/local.js";
import { gitAdapter } from "../adapters/git.js";
import { packageAdapter } from "../adapters/package.js";
import type { ResourceAdapter } from "../adapters/adapter.js";
import { indexResourceFiles } from "../indexing/pipeline.js";
import { countChunks, deleteSummaries } from "../indexing/store.js";
import { generateSummaries } from "../query/answerer.js";
import type { ProviderConfig, Resource } from "./resource.js";
import { updateResource } from "./registry.js";
import { snapshotsDir } from "./config.js";
import { getMaterializedDir } from "../query/resolve-target.js";
import { acquireResourceAddLock, releaseResourceAddLock } from "./locks.js";

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
  if (!acquireResourceAddLock(resource.id))
    return {
      name: resource.name,
      filesChanged: 0,
      chunksUpdated: 0,
      status: "partial",
      error: "Another write is already running for this resource",
    };
  try {
    return await performSync(resource, providerConfig, fullSync, onProgress);
  } finally {
    releaseResourceAddLock(resource.id);
  }
}

async function performSync(
  resource: Resource,
  providerConfig: ProviderConfig,
  fullSync = false,
  onProgress?: (msg: string) => void,
): Promise<SyncResult> {
  const adapter = getAdapter(resource.type);

  // Re-materialize to pick up changes
  onProgress?.(`Materializing ${resource.name}...`);
  try {
    const snapshotMetadata = await adapter.materialize(
      resource.normalized_source,
      snapshotsDir(),
    );
    resource = { ...resource, snapshot_metadata: snapshotMetadata };
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
    if (
      indexResult.filesChanged > 0 ||
      indexResult.forcedFullSync ||
      resource.last_sync_status !== "ok"
    ) {
      if (indexResult.allChunkTexts.length > 0) {
        await generateSummaries(
          resource,
          indexResult.allChunkTexts,
          providerConfig,
          onProgress,
        );
      } else {
        await deleteSummaries(resource.id);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const currentChunkCount = await countChunks(resource.id);
    const partial: Resource = {
      ...resource,
      last_sync_status: "partial",
      last_sync_at: resource.last_sync_at,
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
