import { describe, it, expect, vi, beforeEach } from "vitest";
import { createResource } from "../../src/core/resource.js";

// --- module mocks ---
vi.mock("../../src/adapters/local.js", () => ({
  localAdapter: { type: "local", materialize: vi.fn() },
}));
vi.mock("../../src/adapters/git.js", () => ({
  gitAdapter: { type: "git", materialize: vi.fn() },
}));
vi.mock("../../src/adapters/package.js", () => ({
  packageAdapter: { type: "package", materialize: vi.fn() },
}));

const mockEnumerate = vi.fn();
const mockFingerprint = vi.fn();
vi.mock("../../src/adapters/shared.js", () => ({
  enumerate: (...args: unknown[]) => mockEnumerate(...args),
  fingerprint: (...args: unknown[]) => mockFingerprint(...args),
}));

const mockChunkFile = vi.fn();
vi.mock("../../src/indexing/chunker.js", () => ({
  chunkFile: (...args: unknown[]) => mockChunkFile(...args),
}));

const mockEmbed = vi.fn();
vi.mock("../../src/indexing/embedder.js", () => ({
  embed: (...args: unknown[]) => mockEmbed(...args),
  getEmbedModel: () => "nomic-embed-text",
  EMBED_BATCH_SIZE: 128,
}));

const mockGetChunkFingerprints = vi.fn();
const mockDeleteChunks = vi.fn();
const mockDeleteChunksForFile = vi.fn();
const mockDeleteSummaries = vi.fn();
const mockWriteChunks = vi.fn();
const mockCountChunks = vi.fn();
vi.mock("../../src/indexing/store.js", () => ({
  getChunkFingerprints: (...args: unknown[]) => mockGetChunkFingerprints(...args),
  deleteChunks: (...args: unknown[]) => mockDeleteChunks(...args),
  deleteChunksForFile: (...args: unknown[]) => mockDeleteChunksForFile(...args),
  deleteSummaries: (...args: unknown[]) => mockDeleteSummaries(...args),
  writeChunks: (...args: unknown[]) => mockWriteChunks(...args),
  countChunks: (...args: unknown[]) => mockCountChunks(...args),
}));

const mockGenerateSummaries = vi.fn();
vi.mock("../../src/query/answerer.js", () => ({
  generateSummaries: (...args: unknown[]) => mockGenerateSummaries(...args),
}));

const mockIndexResourceFiles = vi.fn();
vi.mock("../../src/indexing/pipeline.js", () => ({
  indexResourceFiles: (...args: unknown[]) => mockIndexResourceFiles(...args),
}));

const mockUpdateResource = vi.fn();
vi.mock("../../src/core/registry.js", () => ({
  updateResource: (...args: unknown[]) => mockUpdateResource(...args),
}));

vi.mock("../../src/core/config.js", () => ({
  snapshotsDir: () => "/tmp/snapshots",
}));

const { syncResource } = await import("../../src/core/sync.js");

const localResource = createResource({
  name: "test-repo",
  type: "local",
  source: "/tmp/test",
  normalized_source: "/tmp/test",
  notes: "",
  include_rules: [],
  exclude_rules: [],
  snapshot_metadata: { type: "local", absolute_path: "/tmp/test" },
});

const providerConfig = { name: "ollama" as const, model: null, endpoint: null };

async function* makeEntries(paths: string[]) {
  for (const p of paths) {
    yield { relativePath: p, absolutePath: `/tmp/test/${p}`, content: "data" };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetChunkFingerprints.mockResolvedValue(new Map());
  mockDeleteChunks.mockResolvedValue(undefined);
  mockDeleteChunksForFile.mockResolvedValue(undefined);
  mockDeleteSummaries.mockResolvedValue(undefined);
  mockWriteChunks.mockResolvedValue(undefined);
  mockCountChunks.mockResolvedValue(5);
  mockGenerateSummaries.mockResolvedValue(undefined);
  mockIndexResourceFiles.mockResolvedValue({
    filesScanned: 1,
    filesChanged: 1,
    chunksUpdated: 1,
    changedChunkTexts: ["chunk text"],
    forcedFullSync: false,
    indexProfile: {
      embed_model: "nomic-embed-text",
      chunker_version: "boundary-v1",
      index_schema_version: "2",
    },
  });
  mockUpdateResource.mockReturnValue(undefined);
});

describe("syncResource", () => {
  it("returns failed status when materialize throws", async () => {
    const { localAdapter } = await import("../../src/adapters/local.js");
    (localAdapter.materialize as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error"),
    );

    const result = await syncResource(localResource, providerConfig);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("network error");
    expect(mockUpdateResource).toHaveBeenCalledWith(
      expect.objectContaining({ last_sync_status: "failed" }),
    );
  });

  it("returns partial status when embed throws mid-sync", async () => {
    const { localAdapter } = await import("../../src/adapters/local.js");
    (localAdapter.materialize as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    mockIndexResourceFiles.mockRejectedValue(new Error("Ollama is not running"));

    const result = await syncResource(localResource, providerConfig);
    expect(result.status).toBe("partial");
    expect(result.error).toContain("Ollama is not running");
    expect(mockUpdateResource).toHaveBeenCalledWith(
      expect.objectContaining({ last_sync_status: "partial", chunk_count: 5 }),
    );
  });

  it("returns ok status and calls generateSummaries when files change", async () => {
    const { localAdapter } = await import("../../src/adapters/local.js");
    (localAdapter.materialize as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const result = await syncResource(localResource, providerConfig);
    expect(result.status).toBe("ok");
    expect(result.filesChanged).toBe(1);
    expect(mockGenerateSummaries).toHaveBeenCalledOnce();
    expect(mockUpdateResource).toHaveBeenCalledWith(
      expect.objectContaining({ last_sync_status: "ok" }),
    );
  });

  it("returns ok with no changes when fingerprints match", async () => {
    const { localAdapter } = await import("../../src/adapters/local.js");
    (localAdapter.materialize as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    mockIndexResourceFiles.mockResolvedValue({
      filesScanned: 1,
      filesChanged: 0,
      chunksUpdated: 0,
      changedChunkTexts: [],
      forcedFullSync: false,
      indexProfile: {
        embed_model: "nomic-embed-text",
        chunker_version: "boundary-v1",
        index_schema_version: "2",
      },
    });

    const result = await syncResource(localResource, providerConfig);
    expect(result.status).toBe("ok");
    expect(result.filesChanged).toBe(0);
    expect(mockGenerateSummaries).not.toHaveBeenCalled();
  });

  it("forces a full reindex when the stored index profile is missing", async () => {
    const { localAdapter } = await import("../../src/adapters/local.js");
    (localAdapter.materialize as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const oldResource = { ...localResource, index_profile: null };
    mockIndexResourceFiles.mockResolvedValue({
      filesScanned: 1,
      filesChanged: 1,
      chunksUpdated: 1,
      changedChunkTexts: ["chunk text"],
      forcedFullSync: true,
      indexProfile: {
        embed_model: "nomic-embed-text",
        chunker_version: "boundary-v1",
        index_schema_version: "2",
      },
    });

    const result = await syncResource(oldResource, providerConfig);

    expect(result.status).toBe("ok");
    expect(mockIndexResourceFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: oldResource,
        fullSync: false,
      }),
    );
    expect(mockUpdateResource).toHaveBeenCalledWith(
      expect.objectContaining({
        index_profile: {
          embed_model: "nomic-embed-text",
          chunker_version: "boundary-v1",
          index_schema_version: "2",
        },
      }),
    );
  });
});
