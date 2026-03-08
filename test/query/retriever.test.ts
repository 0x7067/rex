import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ChunkRow } from "../../src/indexing/store.js";

const mockEmbedOne = vi.fn();
const mockSearchChunks = vi.fn();

vi.mock("../../src/indexing/embedder.js", () => ({
  embedOne: mockEmbedOne,
}));

vi.mock("../../src/indexing/store.js", () => ({
  searchChunks: mockSearchChunks,
}));

const { retrieve } = await import("../../src/query/retriever.js");

const DUMMY_VECTOR = new Float32Array(768).fill(0);

function makeRow(resourceId: string, distance: number, index: number): ChunkRow {
  return {
    id: `${resourceId}-${index}`,
    resource_id: resourceId,
    resource_name: `resource-${resourceId}`,
    file_path: `file-${index}.ts`,
    fingerprint: "fp",
    chunk_index: index,
    start_line: index * 10 + 1,
    end_line: index * 10 + 5,
    text: `text ${index}`,
    vector: [],
    indexed_at: new Date().toISOString(),
    distance,
  };
}

describe("retrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedOne.mockResolvedValue(DUMMY_VECTOR);
  });

  it("returns empty array for empty resourceIds without calling embedOne", async () => {
    const result = await retrieve("what?", []);
    expect(result).toEqual([]);
    expect(mockEmbedOne).not.toHaveBeenCalled();
  });

  it("enforces per-resource cap", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => makeRow("r1", i * 0.1, i));
    mockSearchChunks.mockResolvedValue(rows);

    const result = await retrieve("q", ["r1"], { perResourceCap: 10, totalCap: 100 });
    expect(result).toHaveLength(10);
  });

  it("sorts globally by distance after per-resource capping (lower distance first)", async () => {
    // r1 rows are less relevant (higher distance), r2 rows are more relevant (lower distance)
    const r1rows = Array.from({ length: 3 }, (_, i) => makeRow("r1", 0.8 + i * 0.01, i));
    const r2rows = Array.from({ length: 3 }, (_, i) => makeRow("r2", 0.1 + i * 0.01, i));
    // searchChunks returns r1 first (map insertion order would keep r1 first)
    mockSearchChunks.mockResolvedValue([...r1rows, ...r2rows]);

    const result = await retrieve("q", ["r1", "r2"], { perResourceCap: 10, totalCap: 100 });

    const scores = result.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
    // The first chunk should be from r2 (lower distance)
    expect(result[0]!.resource_id).toBe("r2");
  });

  it("populates score with the actual distance value", async () => {
    const rows = [makeRow("r1", 0.42, 0)];
    mockSearchChunks.mockResolvedValue(rows);

    const result = await retrieve("q", ["r1"]);
    expect(result[0]!.score).toBe(0.42);
  });

  it("preserves chunk line spans from the store", async () => {
    const rows = [makeRow("r1", 0.42, 2)];
    mockSearchChunks.mockResolvedValue(rows);

    const result = await retrieve("q", ["r1"]);
    expect(result[0]!.start_line).toBe(21);
    expect(result[0]!.end_line).toBe(25);
  });

  it("enforces totalCap after global sort", async () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => makeRow("r1", 0.5 + i * 0.01, i)),
      ...Array.from({ length: 5 }, (_, i) => makeRow("r2", 0.6 + i * 0.01, i)),
    ];
    mockSearchChunks.mockResolvedValue(rows);

    const result = await retrieve("q", ["r1", "r2"], { perResourceCap: 10, totalCap: 6 });
    expect(result).toHaveLength(6);
  });

  it("collapses duplicate file hits when requested", async () => {
    mockSearchChunks.mockResolvedValue([
      {
        ...makeRow("r1", 0.1, 0),
        file_path: "src/chunker.ts",
      },
      {
        ...makeRow("r1", 0.11, 1),
        file_path: "src/chunker.ts",
      },
      {
        ...makeRow("r1", 0.12, 2),
        file_path: "src/retriever.ts",
      },
    ]);

    const result = await retrieve("q", ["r1"], {
      perResourceCap: 10,
      totalCap: 10,
      collapseByFile: true,
    });

    expect(result.map((chunk) => chunk.file_path)).toEqual([
      "src/chunker.ts",
      "src/retriever.ts",
    ]);
  });

  it("keeps split chunks from the same file in chunk order when scores tie", async () => {
    mockSearchChunks.mockResolvedValue([
      {
        ...makeRow("r1", 0.1, 2),
        file_path: "src/dense.ts",
        start_line: 11,
        end_line: 20,
      },
      {
        ...makeRow("r1", 0.1, 1),
        file_path: "src/dense.ts",
        start_line: 1,
        end_line: 10,
      },
    ]);

    const result = await retrieve("q", ["r1"], {
      perResourceCap: 10,
      totalCap: 10,
      collapseByFile: false,
    });

    expect(result.map((chunk) => chunk.chunk_index)).toEqual([1, 2]);
    expect(result.map((chunk) => [chunk.start_line, chunk.end_line])).toEqual([
      [1, 10],
      [11, 20],
    ]);
  });

  it("biases fast codex retrieval away from tooling artifacts and toward source files", async () => {
    mockSearchChunks.mockResolvedValue([
      {
        ...makeRow("r1", 0.1, 0),
        file_path: ".crush/.gitignore",
      },
      {
        ...makeRow("r1", 0.11, 1),
        file_path: "src/indexing/chunker.ts",
      },
      {
        ...makeRow("r1", 0.12, 2),
        file_path: "test/indexing/chunker.test.ts",
      },
    ]);

    const result = await retrieve("q", ["r1"], {
      perResourceCap: 10,
      totalCap: 10,
      pathBias: "codex-fast",
    });

    expect(result[0]?.file_path).toBe("src/indexing/chunker.ts");
    expect(result[result.length - 1]?.file_path).toBe(".crush/.gitignore");
  });
});
