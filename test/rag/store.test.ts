import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createChunkRows,
  getResourceChunks,
  replaceResourceChunks,
  resetDb,
  searchChunks,
  searchHybridChunks,
  writeChunks,
} from "../../src/indexing/store.js";
let root: string;
beforeEach(async () => {
  await resetDb();
  root = fs.mkdtempSync(
    path.join(
      fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(),
      "rex-native-rag-",
    ),
  );
  process.env["REX_HOME"] = root;
});
afterEach(async () => {
  await resetDb();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env["REX_HOME"];
});
function vector(component = 0) {
  const value = new Float32Array(768);
  value[component] = 1;
  return value;
}
function chunk(resource: string, text: string, file = "src/example.ts") {
  return {
    resource_id: resource,
    resource_name: resource,
    file_path: file,
    fingerprint: text,
    chunk_index: 0,
    start_line: 1,
    end_line: 2,
    text,
    chunk_hash: text,
    estimated_tokens: 10,
  };
}
describe("native LanceDB hybrid index", () => {
  it("rescues an exact identifier that the dense top-1 misses", async () => {
    await writeChunks(
      [
        chunk("a", "general cache management", "src/general.ts"),
        chunk("a", "ZXQ_4911 retry_budget_exhausted", "src/retry.ts"),
      ],
      [vector(0), vector(1)],
    );
    expect((await searchChunks(vector(0), ["a"], 1))[0]?.file_path).toBe(
      "src/general.ts",
    );
    const hits = await searchHybridChunks("ZXQ_4911", vector(0), ["a"], 2);
    expect(hits[0]?.file_path).toBe("src/retry.ts");
    expect(hits[0]?.relevance).toBeGreaterThan(0);
  });
  it("filters both lexical and dense candidates by immutable resource ID", async () => {
    await writeChunks(
      [chunk("a", "secret_marker"), chunk("b", "secret_marker")],
      [vector(), vector()],
    );
    expect(
      (await searchHybridChunks("secret_marker", vector(), ["b"], 10)).map(
        (row) => row.resource_id,
      ),
    ).toEqual(["b"]);
  });
  it("atomically replaces one resource while preserving other resources", async () => {
    await writeChunks(
      [chunk("a", "before"), chunk("b", "keep")],
      [vector(), vector()],
    );
    await replaceResourceChunks(
      "a",
      createChunkRows([chunk("a", "after")], [vector()]),
    );
    expect((await getResourceChunks("a")).map((row) => row.text)).toEqual([
      "after",
    ]);
    expect((await getResourceChunks("b")).map((row) => row.text)).toEqual([
      "keep",
    ]);
    await replaceResourceChunks("a", []);
    expect(await getResourceChunks("a")).toEqual([]);
    expect(await getResourceChunks("b")).toHaveLength(1);
  });
  it("rejects cross-resource replacement before committing", async () => {
    await writeChunks([chunk("a", "before")], [vector()]);
    await expect(
      replaceResourceChunks(
        "a",
        createChunkRows([chunk("b", "wrong")], [vector()]),
      ),
    ).rejects.toThrow("another resource");
    expect((await getResourceChunks("a"))[0]?.text).toBe("before");
  });
  it("handles quoted source paths and rejects invalid embedding dimensions", async () => {
    await writeChunks([chunk("a", "quoted", "src/it's.ts")], [vector()]);
    expect((await getResourceChunks("a"))[0]?.file_path).toBe("src/it's.ts");
    await expect(
      writeChunks([chunk("a", "bad")], [new Float32Array(3)]),
    ).rejects.toThrow();
    expect(await getResourceChunks("a")).toHaveLength(1);
  });
});

describe("database initialization recovery", () => {
  it("does not cache an initialization error after its cause is fixed", async () => {
    const blocked = path.join(root, "blocked");
    fs.writeFileSync(blocked, "fixture");
    process.env["REX_HOME"] = blocked;
    await expect(getResourceChunks("a")).rejects.toThrow();
    fs.unlinkSync(blocked);
    fs.mkdirSync(blocked);
    expect(await getResourceChunks("a")).toEqual([]);
  });
});
