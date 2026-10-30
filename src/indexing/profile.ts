import crypto from "node:crypto";
import { z } from "zod";
import { getEmbedModel, getEmbeddingSource } from "./embedder.js";

export const CHUNKER_VERSION = "boundary-v3";
export const INDEX_SCHEMA_VERSION = "3";

export const IndexProfileSchema = z.object({
  embed_model: z.string().min(1),
  chunker_version: z.string().min(1),
  index_schema_version: z.string().min(1),
  embed_source: z.string().optional(),
  encoding_version: z.string().optional(),
  vector_dimensions: z.number().int().positive().optional(),
});
export type IndexProfile = z.infer<typeof IndexProfileSchema>;

export function getCurrentIndexProfile(): IndexProfile {
  return {
    embed_model: getEmbedModel(),
    chunker_version: CHUNKER_VERSION,
    index_schema_version: INDEX_SCHEMA_VERSION,
    embed_source: getEmbeddingSource(),
    encoding_version: "nomic-retrieval-with-path-v1",
    vector_dimensions: 768,
  };
}

export function sameIndexProfile(
  left: IndexProfile | null | undefined,
  right: IndexProfile = getCurrentIndexProfile(),
): boolean {
  if (!left) return false;
  return (
    left.embed_model === right.embed_model &&
    left.chunker_version === right.chunker_version &&
    left.index_schema_version === right.index_schema_version &&
    left.embed_source === right.embed_source &&
    left.encoding_version === right.encoding_version &&
    left.vector_dimensions === right.vector_dimensions
  );
}

export function embeddingCacheKey(): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(getCurrentIndexProfile()))
    .digest("hex");
}
