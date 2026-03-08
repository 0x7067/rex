import { getEmbedModel } from "./embedder.js";

export const CHUNKER_VERSION = "boundary-v2";
export const INDEX_SCHEMA_VERSION = "2";

export interface IndexProfile {
  embed_model: string;
  chunker_version: string;
  index_schema_version: string;
}

export function getCurrentIndexProfile(): IndexProfile {
  return {
    embed_model: getEmbedModel(),
    chunker_version: CHUNKER_VERSION,
    index_schema_version: INDEX_SCHEMA_VERSION,
  };
}

export function sameIndexProfile(
  left: IndexProfile | null | undefined,
  right: IndexProfile = getCurrentIndexProfile(),
): boolean {
  if (!left) return false;
  return left.embed_model === right.embed_model &&
    left.chunker_version === right.chunker_version &&
    left.index_schema_version === right.index_schema_version;
}
