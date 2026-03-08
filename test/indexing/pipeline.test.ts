import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mockEmbed = vi.fn();
const mockWriteChunks = vi.fn();

vi.mock("../../src/indexing/embedder.js", () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
  getEmbedModel: () => "nomic-embed-text",
}));

vi.mock("../../src/indexing/store.js", () => ({
  writeChunks: (...args: unknown[]) => mockWriteChunks(...args),
}));

const { embedAndStoreChunks } = await import("../../src/indexing/pipeline.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-pipeline-test-"));
  process.env["REX_HOME"] = tmpDir;
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["REX_HOME"];
});

function makeChunk(id: string, text: string) {
  return {
    resource_id: "resource-1",
    resource_name: "resource",
    file_path: "src/file.ts",
    fingerprint: "fp",
    chunk_index: 0,
    start_line: 1,
    end_line: text.length === 0 ? 1 : text.split("\n").length,
    text,
    chunk_hash: id,
    estimated_tokens: Math.max(1, Math.ceil(text.length / 4)),
  };
}

describe("embedAndStoreChunks", () => {
  it("reuses cached embeddings for identical chunk hashes", async () => {
    mockEmbed.mockResolvedValue([new Float32Array([0.1, 0.2, 0.3])]);

    const chunk = makeChunk("a".repeat(64), "hello world");

    await embedAndStoreChunks([chunk]);
    await embedAndStoreChunks([chunk]);

    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockWriteChunks).toHaveBeenCalledTimes(2);
  });

  it("throws when embed returns fewer vectors than requested", async () => {
    mockEmbed.mockResolvedValue([]);

    const chunk = makeChunk("b".repeat(64), "hello world");

    await expect(embedAndStoreChunks([chunk])).rejects.toThrow(
      "Embedding returned 0 vectors for 1 chunks",
    );
    expect(mockWriteChunks).not.toHaveBeenCalled();
  });
});
