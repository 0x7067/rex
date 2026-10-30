import crypto from "node:crypto";
import fs from "node:fs";
import { enumerate } from "../adapters/shared.js";
import type { FileEntry } from "../adapters/adapter.js";
import { type Resource } from "../core/resource.js";
import { getCachedEmbedding, setCachedEmbedding } from "./cache.js";
import { chunkText, type Chunk } from "./chunker.js";
import {
  createEmbedBatches,
  formatBatchProgress,
  formatEmbedSummary,
} from "./embed-options.js";
import { countTokens, embed, getEmbedContextSize } from "./embedder.js";
import {
  embeddingCacheKey,
  getCurrentIndexProfile,
  sameIndexProfile,
} from "./profile.js";
import {
  createChunkRows,
  getResourceChunks,
  replaceResourceChunks,
  writeChunks,
} from "./store.js";

export interface IndexResourceFilesResult {
  filesScanned: number;
  filesChanged: number;
  chunksUpdated: number;
  changedChunkTexts: string[];
  allChunkTexts: string[];
  forcedFullSync: boolean;
  indexProfile: ReturnType<typeof getCurrentIndexProfile>;
}

const TOKEN_SPLIT_HEADROOM = 128;
const MIN_SPLIT_CHARS = 64;

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
  const forcedFullSync =
    fullSync || !sameIndexProfile(resource.index_profile, indexProfile);
  const previousRows = forcedFullSync
    ? []
    : await getResourceChunks(resource.id);
  const storedFingerprints = new Map(
    previousRows.map((row) => [row.file_path, row.fingerprint]),
  );

  const currentPaths = new Set<string>();
  const changedChunks: Chunk[] = [];
  const changedPaths = new Set<string>();
  let filesScanned = 0;
  let filesChanged = 0;

  onProgress?.("Scanning files...");
  for await (const entry of enumerate(
    materializedDir,
    includeRules,
    excludeRules,
  )) {
    filesScanned++;
    currentPaths.add(entry.relativePath);

    const loaded = loadEntryContent(entry);
    if (!loaded)
      throw new Error(
        `Cannot read ${entry.relativePath}; previous index was preserved`,
      );

    const stored = storedFingerprints.get(entry.relativePath);
    if (!forcedFullSync && stored === loaded.fingerprint) {
      continue;
    }

    const prepared = await prepareChunksFromText(
      entry,
      resource.id,
      resource.name,
      loaded.text,
      loaded.fingerprint,
    );

    filesChanged++;
    changedPaths.add(entry.relativePath);
    changedChunks.push(...prepared.chunks);
  }

  if (!forcedFullSync) {
    for (const [filePath] of storedFingerprints) {
      if (!currentPaths.has(filePath)) {
        filesChanged++;
      }
    }
  }

  const vectors = await embedChunkVectors(changedChunks, onProgress);
  const allRows = [
    ...previousRows.filter(
      (row) =>
        currentPaths.has(row.file_path) && !changedPaths.has(row.file_path),
    ),
    ...createChunkRows(changedChunks, vectors),
  ];
  if (forcedFullSync || filesChanged > 0)
    await replaceResourceChunks(resource.id, allRows);
  const chunksUpdated = changedChunks.length;

  return {
    filesScanned,
    filesChanged,
    chunksUpdated,
    changedChunkTexts: changedChunks.map((chunk) => chunk.text),
    allChunkTexts: allRows
      .sort(
        (a, b) =>
          a.file_path.localeCompare(b.file_path) ||
          a.chunk_index - b.chunk_index,
      )
      .map(
        (row) =>
          `File: ${row.file_path} (lines ${row.start_line}-${row.end_line})\n${row.text}`,
      ),
    forcedFullSync,
    indexProfile,
  };
}

export async function embedAndStoreChunks(
  chunks: Chunk[],
  onProgress?: (msg: string) => void,
): Promise<number> {
  const vectors = await embedChunkVectors(chunks, onProgress);
  await writeChunks(chunks, vectors);
  return chunks.length;
}

async function embedChunkVectors(
  chunks: Chunk[],
  onProgress?: (msg: string) => void,
): Promise<Float32Array[]> {
  if (chunks.length === 0) return [];

  const model = embeddingCacheKey();
  const vectors = new Array<Float32Array>(chunks.length);
  const missing: Array<{
    chunk: Chunk;
    index: number;
    text: string;
    estimated_tokens: number;
  }> = [];
  let cacheHits = 0;

  for (const [index, chunk] of chunks.entries()) {
    const cacheHash = crypto
      .createHash("sha256")
      .update(`${chunk.file_path}\n${chunk.text}`)
      .digest("hex");
    const cached = getCachedEmbedding(model, cacheHash);
    if (cached) {
      vectors[index] = cached;
      cacheHits++;
      continue;
    }

    missing.push({
      chunk,
      index,
      text: `${chunk.file_path}\n${chunk.text}`,
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
        throw new Error(
          `Embedding returned an invalid vector for chunk ${item.chunk.chunk_hash}`,
        );
      }
      vectors[item.index] = vector;
      const cacheHash = crypto
        .createHash("sha256")
        .update(item.text)
        .digest("hex");
      setCachedEmbedding(model, cacheHash, vector);
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

  return vectors;
}

export async function prepareChunksForEntry(
  entry: FileEntry,
  resourceId: string,
  resourceName: string,
): Promise<{ fingerprint: string; chunks: Chunk[] } | null> {
  const loaded = loadEntryContent(entry);
  if (!loaded) return null;
  return prepareChunksFromText(
    entry,
    resourceId,
    resourceName,
    loaded.text,
    loaded.fingerprint,
  );
}

async function enforceChunkTokenLimit(
  chunks: Chunk[],
  safeTokenLimit: number,
): Promise<Chunk[]> {
  const finalized: Chunk[] = [];

  for (const chunk of chunks) {
    const actualTokens = await countTokens(`${chunk.file_path}\n${chunk.text}`);
    if (actualTokens <= safeTokenLimit) {
      finalized.push({
        ...chunk,
        estimated_tokens: actualTokens,
      });
      continue;
    }

    const splitChunks = splitOversizedChunk(
      chunk,
      actualTokens,
      safeTokenLimit,
    );
    if (splitChunks.length === 1 && splitChunks[0]?.text === chunk.text) {
      finalized.push({
        ...chunk,
        estimated_tokens: actualTokens,
      });
      continue;
    }

    finalized.push(
      ...(await enforceChunkTokenLimit(splitChunks, safeTokenLimit)),
    );
  }

  return finalized.map((chunk, index) => ({
    ...chunk,
    chunk_index: index,
  }));
}

function splitOversizedChunk(
  chunk: Chunk,
  actualTokens: number,
  safeTokenLimit: number,
): Chunk[] {
  const proportionalMaxChars = Math.floor(
    ((chunk.text.length * safeTokenLimit) / Math.max(actualTokens, 1)) * 0.9,
  );
  const nextMaxChars = Math.max(
    MIN_SPLIT_CHARS,
    Math.min(chunk.text.length - 1, proportionalMaxChars),
  );

  if (nextMaxChars >= chunk.text.length) {
    return [chunk];
  }

  const nextTargetChars = Math.max(
    Math.floor(nextMaxChars * 0.7),
    Math.min(MIN_SPLIT_CHARS, nextMaxChars - 1),
  );
  const nextOverlapChars = Math.max(
    Math.min(Math.floor(nextTargetChars * 0.1), Math.floor(nextMaxChars * 0.2)),
    16,
  );

  return chunkText(
    chunk.text,
    {
      absolutePath: chunk.file_path,
      relativePath: chunk.file_path,
      sizeBytes: Buffer.byteLength(chunk.text),
    },
    chunk.resource_id,
    chunk.resource_name,
    chunk.fingerprint,
    {
      targetChunkChars: nextTargetChars,
      maxChunkChars: nextMaxChars,
      overlapChars: nextOverlapChars,
      lineOffset: chunk.start_line - 1,
    },
  );
}

function getSafeTokenLimit(): number {
  return Math.max(1, getEmbedContextSize() - TOKEN_SPLIT_HEADROOM);
}

function loadEntryContent(
  entry: FileEntry,
): { text: string; fingerprint: string } | null {
  let content: Buffer;
  try {
    content = fs.readFileSync(entry.absolutePath);
  } catch {
    return null;
  }

  return {
    text: content.toString("utf-8"),
    fingerprint: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

async function prepareChunksFromText(
  entry: FileEntry,
  resourceId: string,
  resourceName: string,
  text: string,
  fingerprint: string,
): Promise<{ fingerprint: string; chunks: Chunk[] }> {
  return {
    fingerprint,
    chunks: await enforceChunkTokenLimit(
      chunkText(text, entry, resourceId, resourceName, fingerprint),
      getSafeTokenLimit(),
    ),
  };
}
