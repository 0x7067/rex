import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createResource } from "../../src/core/resource.js";
const mocks = vi.hoisted(() => ({ embed: vi.fn(), tokens: vi.fn() }));
vi.mock("../../src/indexing/embedder.js", () => ({
  embed: mocks.embed,
  countTokens: mocks.tokens,
  getEmbedContextSize: () => 4096,
  getEmbedModel: () => "nomic-ai/nomic-embed-text-v1.5",
  getEmbeddingSource: () => "fixture.gguf",
}));
const { indexResourceFiles, prepareChunksForEntry } =
  await import("../../src/indexing/pipeline.js");
const { getResourceChunks, resetDb } =
  await import("../../src/indexing/store.js");
let root: string;
beforeEach(async () => {
  await resetDb();
  root = fs.mkdtempSync(
    path.join(
      fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(),
      "rex-pipeline-",
    ),
  );
  process.env["REX_HOME"] = path.join(root, "state");
  vi.clearAllMocks();
  mocks.tokens.mockImplementation(async (text: string) =>
    Math.ceil(text.length / 4),
  );
  mocks.embed.mockImplementation(async (texts: string[]) =>
    texts.map(() => {
      const v = new Float32Array(768);
      v[0] = 1;
      return v;
    }),
  );
});
afterEach(async () => {
  await resetDb();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env["REX_HOME"];
});
function resource() {
  return createResource({
    name: "fixture",
    type: "local",
    source: root,
    normalized_source: root,
    notes: "",
    include_rules: [],
    exclude_rules: [],
    snapshot_metadata: { type: "local", absolute_path: root },
  });
}
function index(r: ReturnType<typeof resource>, fullSync = false) {
  return indexResourceFiles({
    resource: r,
    materializedDir: root,
    includeRules: ["*.ts"],
    excludeRules: [],
    fullSync,
  });
}
describe("atomic incremental indexing", () => {
  it("skips tokenization and embedding for unchanged files", async () => {
    fs.writeFileSync(path.join(root, "file.ts"), "const x=1");
    const r = resource();
    await index(r);
    vi.clearAllMocks();
    const result = await index(r);
    expect(result.filesChanged).toBe(0);
    expect(mocks.tokens).not.toHaveBeenCalled();
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(await getResourceChunks(r.id)).toHaveLength(1);
  });
  it("reuses correctly namespaced cached embeddings on a full rebuild", async () => {
    fs.writeFileSync(path.join(root, "file.ts"), "const x=1");
    const r = resource();
    await index(r, true);
    await index(r, true);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
  });
  it("preserves previous rows if full-reindex embedding fails", async () => {
    fs.writeFileSync(path.join(root, "file.ts"), "old content");
    const r = resource();
    await index(r, true);
    fs.writeFileSync(path.join(root, "file.ts"), "new content");
    mocks.embed.mockRejectedValueOnce(new Error("embedding failed"));
    await expect(index(r, true)).rejects.toThrow("embedding failed");
    expect((await getResourceChunks(r.id))[0]?.text).toBe("old content");
  });
  it("rejects missing vectors before modifying the existing index", async () => {
    fs.writeFileSync(path.join(root, "file.ts"), "old content");
    const r = resource();
    await index(r);
    fs.writeFileSync(path.join(root, "file.ts"), "new content");
    mocks.embed.mockResolvedValueOnce([]);
    await expect(index(r)).rejects.toThrow("Embedding returned 0 vectors");
    expect((await getResourceChunks(r.id))[0]?.text).toBe("old content");
  });
  it("deletes removed files while keeping unchanged chunks in the replacement", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "keep");
    fs.writeFileSync(path.join(root, "b.ts"), "delete");
    const r = resource();
    await index(r);
    fs.unlinkSync(path.join(root, "b.ts"));
    const result = await index(r);
    expect((await getResourceChunks(r.id)).map((row) => row.file_path)).toEqual(
      ["a.ts"],
    );
    expect(result.allChunkTexts).toEqual([expect.stringContaining("keep")]);
  });
  it("deletes the final file with an empty atomic replacement", async () => {
    fs.writeFileSync(path.join(root, "file.ts"), "delete");
    const r = resource();
    await index(r);
    fs.unlinkSync(path.join(root, "file.ts"));
    await index(r);
    expect(await getResourceChunks(r.id)).toEqual([]);
  });
  it("re-splits token-dense inputs and preserves line provenance", async () => {
    const file = path.join(root, "dense.ts");
    fs.writeFileSync(
      file,
      Array.from({ length: 40 }, (_, i) => `line ${i} ${"x".repeat(50)}`).join(
        "\n",
      ),
    );
    mocks.tokens.mockImplementation(async (text: string) =>
      text.length > 1500 ? 5000 : 1200,
    );
    const result = await prepareChunksForEntry(
      {
        absolutePath: file,
        relativePath: "dense.ts",
        sizeBytes: fs.statSync(file).size,
      },
      "r",
      "fixture",
    );
    expect(result?.chunks.length).toBeGreaterThan(1);
    expect(result?.chunks[0]?.start_line).toBe(1);
    expect(result?.chunks.at(-1)?.end_line).toBe(40);
  });
});
