import crypto from "node:crypto";
import fs from "node:fs";
import { enumerate } from "../adapters/shared.js";
import type { FileEntry } from "../adapters/adapter.js";
import { type Resource } from "../core/resource.js";
import { getCachedEmbedding, setCachedEmbedding } from "./cache.js";
import { chunkText, type Chunk } from "./chunker.js";
import { createEmbedBatches, formatBatchProgress, formatEmbedSummary } from "./embed-options.js";
import { embed, getEmbedModel } from "./embedder.js";
import { getCurrentIndexProfile, sameIndexProfile } from "./profile.js";
import {
  deleteChunks,
  deleteChunksForFile,
  getChunkFingerprints,
  writeChunks,
} from "./store.js";

export interface IndexResourceFilesResult {
  filesScanned: number;
  filesChanged: number;
  chunksUpdated: number;
  changedChunkTexts: string[];
  forcedFullSync: boolean;
  indexProfile: ReturnType<typeof getCurrentIndexProfile>;
}

export async function indexResourceFiles(opts: {
  resource: Resource;
  materializedDir: string;
  includeRules: string[];
  excludeRules: string[];
  fullSync?: boolean;
  onProgress?: ((msg: string) => void) | undefined;
}): Promise<IndexResourceFilesResult> {
  const {
    resource,
    materializedDir,
    includeRules,
    excludeRules,
    fullSync = false,
    onProgress,
  } = opts;

  const indexProfile = getCurrentIndexProfile();
  const forcedFullSync = fullSync || !sameIndexProfile(resource.index_profile, indexProfile);
  const storedFingerprints = forcedFullSync
    ? new Map<string, string>()
    : await getChunkFingerprints(resource.id);

  if (forcedFullSync) {
    await deleteChunks(resource.id);
  }

  const currentPaths = new Set<string>();
  const changedChunks: Chunk[] = [];
  let filesScanned = 0;
  let filesChanged = 0;

  onProgress?.("Scanning files...");
  for await (const entry of enumerate(materializedDir, includeRules, excludeRules)) {
    filesScanned++;
    currentPaths.add(entry.relativePath);

    const prepared = prepareChunksForEntry(entry, resource.id, resource.name);
    if (!prepared) continue;

    const stored = storedFingerprints.get(entry.relativePath);
    if (!forcedFullSync && stored === prepared.fingerprint) {
      continue;
    }

    filesChanged++;
    if (!forcedFullSync && stored !== undefined) {
      await deleteChunksForFile(resource.id, entry.relativePath);
    }

    changedChunks.push(...prepared.chunks);
  }

  if (!forcedFullSync) {
    for (const [filePath] of storedFingerprints) {
      if (!currentPaths.has(filePath)) {
        await deleteChunksForFile(resource.id, filePath);
        filesChanged++;
      }
    }
  }

  const chunksUpdated = await embedAndStoreChunks(changedChunks, onProgress);

  return {
    filesScanned,
    filesChanged,
    chunksUpdated,
    changedChunkTexts: changedChunks.map((chunk) => chunk.text),
    forcedFullSync,
    indexProfile,
  };
}

export async function embedAndStoreChunks(
  chunks: Chunk[],
  onProgress?: (msg: string) => void,
): Promise<number> {
  if (chunks.length === 0) return 0;

  const model = getEmbedModel();
  const vectors = new Array<Float32Array>(chunks.length);
  const missing: Array<{ chunk: Chunk; index: number; text: string; estimated_tokens: number }> = [];
  let cacheHits = 0;

  for (const [index, chunk] of chunks.entries()) {
    const cached = getCachedEmbedding(model, chunk.chunk_hash);
    if (cached) {
      vectors[index] = cached;
      cacheHits++;
      continue;
    }

    missing.push({
      chunk,
      index,
      text: chunk.text,
      estimated_tokens: chunk.estimated_tokens,
    });
  }

  if (cacheHits > 0) {
    onProgress?.(`Reused ${cacheHits}/${chunks.length} cached embeddings...`);
  }

  const embedStart = Date.now();
  let processedMissing = 0;
  for (const batch of createEmbedBatches(missing)) {
    const batchStart = Date.now();
    const embedded = await embed(batch.map((item) => item.text));
    if (embedded.length !== batch.length) {
      throw new Error(
        `Embedding returned ${embedded.length} vectors for ${batch.length} chunks`,
      );
    }
    const batchMs = Date.now() - batchStart;

    for (const [offset, item] of batch.entries()) {
      const vector = embedded[offset];
      if (!vector || vector.length === 0) {
        throw new Error(`Embedding returned an invalid vector for chunk ${item.chunk.chunk_hash}`);
      }
      vectors[item.index] = vector;
      setCachedEmbedding(model, item.chunk.chunk_hash, vector);
    }

    onProgress?.(
      formatBatchProgress({
        batchStart: cacheHits + processedMissing,
        totalChunks: chunks.length,
        batchSize: batch.length,
        elapsedMs: batchMs,
      }),
    );
    processedMissing += batch.length;
  }

  onProgress?.(
    formatEmbedSummary({
      totalChunks: chunks.length,
      totalMs: Date.now() - embedStart,
    }),
  );

  await writeChunks(
    chunks,
    vectors.map((vector) => vector ?? new Float32Array()),
  );
  return chunks.length;
}

function prepareChunksForEntry(
  entry: FileEntry,
  resourceId: string,
  resourceName: string,
): { fingerprint: string; chunks: Chunk[] } | null {
  let content: Buffer;
  try {
    content = fs.readFileSync(entry.absolutePath);
  } catch {
    return null;
  }

  const text = content.toString("utf-8");
  const fingerprint = crypto.createHash("sha256").update(content).digest("hex");

  return {
    fingerprint,
    chunks: chunkText(text, entry, resourceId, resourceName, fingerprint),
  };
}
