import fs from "node:fs";
import path from "node:path";
import { embeddingCacheDir } from "../core/config.js";

export function getCachedEmbedding(
  model: string,
  chunkHash: string,
): Float32Array | null {
  const filePath = cachePath(model, chunkHash);
  if (!fs.existsSync(filePath)) return null;

  try {
    const values = JSON.parse(fs.readFileSync(filePath, "utf-8")) as number[];
    if (!Array.isArray(values)) return null;
    return new Float32Array(values);
  } catch {
    return null;
  }
}

export function setCachedEmbedding(
  model: string,
  chunkHash: string,
  vector: Float32Array,
): void {
  const filePath = cachePath(model, chunkHash);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(vector)), "utf-8");
}

function cachePath(model: string, chunkHash: string): string {
  const safeModel = model.replace(/[^a-z0-9._-]/gi, "_");
  return path.join(
    embeddingCacheDir(),
    safeModel,
    chunkHash.slice(0, 2),
    `${chunkHash}.json`,
  );
}
