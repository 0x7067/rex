import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createResource } from "../../src/core/resource.js";
import { addResource, getResourceById } from "../../src/core/registry.js";
const mocks = vi.hoisted(() => ({ embed: vi.fn(), call: vi.fn() }));
vi.mock("../../src/indexing/embedder.js", () => ({
  embed: mocks.embed,
  countTokens: async (text: string) => Math.ceil(text.length / 4),
  getEmbedContextSize: () => 4096,
  getEmbedModel: () => "nomic-ai/nomic-embed-text-v1.5",
  getEmbeddingSource: () => "fixture.gguf",
}));
vi.mock("../../src/provider/interface.js", () => ({
  getProvider: () => ({ call: mocks.call }),
}));
const { syncResource } = await import("../../src/core/sync.js");
const { getResourceChunks, getSummaries, resetDb } =
  await import("../../src/indexing/store.js");
const provider = {
  name: "ollama",
  model: null,
  endpoint: null,
} satisfies Parameters<typeof syncResource>[1];
let root: string;
beforeEach(async () => {
  await resetDb();
  root = fs.mkdtempSync(
    path.join(
      fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(),
      "rex-sync-",
    ),
  );
  process.env["REX_HOME"] = path.join(root, "state");
  vi.clearAllMocks();
  mocks.call.mockResolvedValue("Generated overview");
  mocks.embed.mockImplementation(async (texts: string[]) =>
    texts.map(() => {
      const vector = new Float32Array(768);
      vector[0] = 1;
      return vector;
    }),
  );
});
afterEach(async () => {
  await resetDb();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env["REX_HOME"];
});
function resource() {
  const r = createResource({
    name: "fixture",
    type: "local",
    source: root,
    normalized_source: root,
    notes: "",
    include_rules: ["*.ts"],
    exclude_rules: [],
    snapshot_metadata: { type: "local", absolute_path: root },
  });
  addResource(r);
  return r;
}
describe("resource sync consistency", () => {
  it("summarizes unchanged and changed content together after incremental sync", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "UNCHANGED_A");
    fs.writeFileSync(path.join(root, "b.ts"), "OLD_B");
    const r = resource();
    await syncResource(r, provider);
    mocks.call.mockClear();
    fs.writeFileSync(path.join(root, "b.ts"), "NEW_B");
    expect((await syncResource(getResourceById(r.id), provider)).status).toBe(
      "ok",
    );
    const prompt = mocks.call.mock.calls[0]?.[0];
    expect(prompt).toContain("UNCHANGED_A");
    expect(prompt).toContain("NEW_B");
    expect(prompt).not.toContain("OLD_B");
    expect(await getSummaries([r.id])).toHaveLength(3);
  });
  it("regenerates summaries after a deletion-only change", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "KEEP_A");
    fs.writeFileSync(path.join(root, "b.ts"), "DELETE_B");
    const r = resource();
    await syncResource(r, provider);
    fs.unlinkSync(path.join(root, "b.ts"));
    mocks.call.mockClear();
    await syncResource(getResourceById(r.id), provider);
    expect(mocks.call).toHaveBeenCalledTimes(3);
    expect(mocks.call.mock.calls[0]?.[0]).toContain("KEEP_A");
    expect(mocks.call.mock.calls[0]?.[0]).not.toContain("DELETE_B");
  });
  it("records summary failures as partial and repairs summaries on the next unchanged sync", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "content");
    const r = resource();
    mocks.call.mockRejectedValueOnce(new Error("fixture provider unavailable"));
    expect((await syncResource(r, provider)).status).toBe("partial");
    expect(getResourceById(r.id).last_sync_status).toBe("partial");
    expect(getResourceById(r.id).last_sync_at).toBeNull();
    expect((await syncResource(getResourceById(r.id), provider)).status).toBe(
      "ok",
    );
    expect(await getSummaries([r.id])).toHaveLength(3);
  });
  it("preserves the last successful rows and timestamp when embedding fails", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "before");
    const r = resource();
    await syncResource(r, provider);
    const saved = getResourceById(r.id);
    fs.writeFileSync(path.join(root, "a.ts"), "after");
    mocks.embed.mockRejectedValueOnce(new Error("embedding unavailable"));
    expect((await syncResource(saved, provider)).status).toBe("partial");
    expect((await getResourceChunks(r.id))[0]?.text).toBe("before");
    expect(getResourceById(r.id).last_sync_at).toBe(saved.last_sync_at);
  });
  it("does not regenerate summaries for an unchanged healthy resource", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "content");
    const r = resource();
    await syncResource(r, provider);
    mocks.call.mockClear();
    expect(
      (await syncResource(getResourceById(r.id), provider)).filesChanged,
    ).toBe(0);
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("returns a failed status when its local source disappears", async () => {
    const r = resource();
    const source = path.join(root, "gone");
    const missing = { ...r, normalized_source: source };
    expect((await syncResource(missing, provider)).status).toBe("failed");
    expect(getResourceById(r.id).last_sync_status).toBe("failed");
  });
});
