import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createResource } from "../../src/core/resource.js";

const mockEmbed = vi.fn();
const mockCountTokens = vi.fn();
const mockGetEmbedContextSize = vi.fn();
const mockGetChunkFingerprints = vi.fn();
const mockDeleteChunks = vi.fn();
const mockDeleteChunksForFile = vi.fn();
const mockWriteChunks = vi.fn();

vi.mock("../../src/indexing/embedder.js", () => ({
  countTokens: (...args: unknown[]) => mockCountTokens(...args),
  embed: (...args: unknown[]) => mockEmbed(...args),
  getEmbedContextSize: (...args: unknown[]) => mockGetEmbedContextSize(...args),
  getEmbedModel: () => "nomic-ai/nomic-embed-text-v1.5",
}));

vi.mock("../../src/indexing/store.js", () => ({
  deleteChunks: (...args: unknown[]) => mockDeleteChunks(...args),
  deleteChunksForFile: (...args: unknown[]) => mockDeleteChunksForFile(...args),
  getChunkFingerprints: (...args: unknown[]) => mockGetChunkFingerprints(...args),
  writeChunks: (...args: unknown[]) => mockWriteChunks(...args),
}));

const { embedAndStoreChunks, indexResourceFiles, prepareChunksForEntry } = await import("../../src/indexing/pipeline.js");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-pipeline-test-"));
  process.env["REX_HOME"] = tmpDir;
  vi.clearAllMocks();
  mockGetEmbedContextSize.mockReturnValue(4096);
  mockGetChunkFingerprints.mockResolvedValue(new Map());
  mockDeleteChunks.mockResolvedValue(undefined);
  mockDeleteChunksForFile.mockResolvedValue(undefined);
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

describe("prepareChunksForEntry", () => {
  it("re-splits token-dense chunks before embedding and preserves file line spans", async () => {
    const denseFile = path.join(tmpDir, "dense.ts");
    const lines = Array.from({ length: 40 }, (_, index) => `line-${index + 1} ${"x".repeat(50)}`);
    fs.writeFileSync(denseFile, lines.join("\n"));

    mockCountTokens.mockImplementation(async (text: string) =>
      text.length > 1500 ? 5000 : 1200
    );

    const prepared = await prepareChunksForEntry(
      {
        absolutePath: denseFile,
        relativePath: "src/dense.ts",
        sizeBytes: fs.statSync(denseFile).size,
      },
      "resource-1",
      "resource",
    );

    expect(prepared).not.toBeNull();
    expect(prepared?.chunks.length).toBeGreaterThan(1);
    expect(prepared?.chunks.map((chunk) => chunk.chunk_index)).toEqual(
      prepared?.chunks.map((_, index) => index),
    );
    expect(prepared?.chunks[0]?.start_line).toBe(1);
    expect(prepared?.chunks.at(-1)?.end_line).toBe(40);
  });
});

describe("indexResourceFiles", () => {
  it("skips token counting for unchanged files after fingerprint matching", async () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    const filePath = path.join(srcDir, "unchanged.ts");
    fs.writeFileSync(filePath, "export const unchanged = true;\n");

    const fingerprint = crypto
      .createHash("sha256")
      .update(fs.readFileSync(filePath))
      .digest("hex");
    mockGetChunkFingerprints.mockResolvedValue(new Map([["src/unchanged.ts", fingerprint]]));

    const resource = createResource({
      name: "fixture",
      type: "local",
      source: tmpDir,
      normalized_source: tmpDir,
      notes: "",
      include_rules: [],
      exclude_rules: [],
      snapshot_metadata: {
        type: "local",
        absolute_path: tmpDir,
      },
    });

    const result = await indexResourceFiles({
      resource,
      materializedDir: tmpDir,
      includeRules: [],
      excludeRules: [],
    });

    expect(result.filesChanged).toBe(0);
    expect(result.chunksUpdated).toBe(0);
    expect(mockCountTokens).not.toHaveBeenCalled();
  });
});
