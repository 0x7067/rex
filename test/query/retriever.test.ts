import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChunkRow } from "../../src/indexing/store.js";
const mocks = vi.hoisted(() => ({ embed: vi.fn(), search: vi.fn() }));
vi.mock("../../src/indexing/embedder.js", () => ({ embedOne: mocks.embed }));
vi.mock("../../src/indexing/store.js", () => ({
  searchHybridChunks: mocks.search,
}));
const { retrieve } = await import("../../src/query/retriever.js");
function row(resource: string, index: number): ChunkRow {
  return {
    id: `${resource}-${index}`,
    resource_id: resource,
    resource_name: resource,
    file_path: `file-${index}.ts`,
    fingerprint: "fp",
    chunk_index: index,
    start_line: index + 1,
    end_line: index + 1,
    text: `text ${index}`,
    vector: [],
    indexed_at: "fixture",
    relevance: 1 / (index + 1),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.embed.mockResolvedValue(new Float32Array(768));
});
describe("hybrid retrieval", () => {
  it("does not embed an empty resource selection", async () => {
    expect(await retrieve("q", [])).toEqual([]);
    expect(mocks.embed).not.toHaveBeenCalled();
  });
  it("retrieves each resource independently and gives all three their full cap", async () => {
    mocks.search.mockImplementation(async (_q, _v, ids: string[]) =>
      Array.from({ length: 15 }, (_, i) => row(ids[0] ?? "", i)),
    );
    const result = await retrieve("compare", ["a", "b", "c"]);
    expect(
      ["a", "b", "c"].map(
        (id) => result.filter((r) => r.resource_id === id).length,
      ),
    ).toEqual([10, 10, 10]);
    expect(result.slice(0, 3).map((r) => r.resource_id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(mocks.embed).toHaveBeenCalledOnce();
    expect(mocks.search).toHaveBeenCalledWith(
      "compare",
      expect.any(Float32Array),
      ["b"],
      40,
    );
  });
  it("enforces the total cap while preserving cross-resource coverage", async () => {
    mocks.search.mockImplementation(async (_q, _v, ids: string[]) =>
      Array.from({ length: 10 }, (_, i) => row(ids[0] ?? "", i)),
    );
    const result = await retrieve("q", ["a", "b"], { totalCap: 6 });
    expect(result).toHaveLength(6);
    expect(result.filter((r) => r.resource_id === "b")).toHaveLength(3);
  });
  it("retains RRF scores and original line spans", async () => {
    mocks.search.mockResolvedValue([row("a", 2)]);
    expect(await retrieve("q", ["a"])).toEqual([
      expect.objectContaining({ score: 1 / 3, start_line: 3, end_line: 3 }),
    ]);
  });
  it("deduplicates repeated spans without dropping other spans in the same file", async () => {
    mocks.search.mockResolvedValue([
      row("a", 0),
      row("a", 0),
      { ...row("a", 1), file_path: "file-0.ts" },
    ]);
    expect(await retrieve("q", ["a"])).toHaveLength(2);
    expect(await retrieve("q", ["a"], { collapseByFile: true })).toHaveLength(
      1,
    );
  });
});
