import { describe, expect, it } from "vitest";
import {
  embeddingCacheKey,
  getCurrentIndexProfile,
  sameIndexProfile,
} from "../../src/indexing/profile.js";
describe("embedding compatibility", () => {
  it("rejects old indexes lacking the actual source and encoding contract", () => {
    expect(
      sameIndexProfile({
        embed_model: "nomic-ai/nomic-embed-text-v1.5",
        chunker_version: "boundary-v2",
        index_schema_version: "2",
      }),
    ).toBe(false);
  });
  it("rejects different weights, dimensions or encoding even when model labels match", () => {
    const profile = getCurrentIndexProfile();
    for (const changed of [
      { embed_source: "different.gguf" },
      { vector_dimensions: 384 },
      { encoding_version: "raw" },
    ])
      expect(sameIndexProfile({ ...profile, ...changed }, profile)).toBe(false);
  });
  it("pins the default artifact revision and returns a stable cache namespace", () => {
    expect(getCurrentIndexProfile().embed_source).toContain(
      "#0188c9bf409793f810680a5a431e7b899c46104c",
    );
    expect(embeddingCacheKey()).toMatch(/^[a-f0-9]{64}$/);
    expect(embeddingCacheKey()).toBe(embeddingCacheKey());
  });
});
