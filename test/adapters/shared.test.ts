import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { enumerate, fingerprint } from "../../src/adapters/shared.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-shared-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) results.push(item);
  return results;
}

describe("enumerate", () => {
  it("yields all text files", async () => {
    writeFile("a.ts", "const x = 1");
    writeFile("b.ts", "const y = 2");
    const entries = await collect(enumerate(tmpDir, [], []));
    expect(entries.map((e) => e.relativePath).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("excludes node_modules by default", async () => {
    writeFile("src/index.ts", "export {}");
    writeFile("node_modules/foo/index.js", "module.exports = {}");
    const entries = await collect(enumerate(tmpDir, [], []));
    expect(entries.every((e) => !e.relativePath.includes("node_modules"))).toBe(true);
  });

  it("excludes Bun lockfiles by default", async () => {
    writeFile("src/index.ts", "export {}");
    writeFile("bun.lock", "lock");
    writeFile("bun.lockb", "binary");
    const entries = await collect(enumerate(tmpDir, [], []));
    expect(entries.every((e) => !e.relativePath.startsWith("bun.lock"))).toBe(true);
  });

  it("respects include globs", async () => {
    writeFile("src/index.ts", "");
    writeFile("README.md", "");
    const entries = await collect(enumerate(tmpDir, ["**/*.ts"], []));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.relativePath).toBe("src/index.ts");
  });

  it("respects custom exclude globs", async () => {
    writeFile("src/a.ts", "");
    writeFile("src/b.test.ts", "");
    const entries = await collect(enumerate(tmpDir, [], ["**/*.test.ts"]));
    expect(entries.every((e) => !e.relativePath.endsWith(".test.ts"))).toBe(true);
  });

  it("skips binary files (.png)", async () => {
    writeFile("image.png", "fake binary");
    writeFile("code.ts", "");
    const entries = await collect(enumerate(tmpDir, [], []));
    expect(entries.every((e) => !e.relativePath.endsWith(".png"))).toBe(true);
  });

  it("yields empty for empty dir", async () => {
    const entries = await collect(enumerate(tmpDir, [], []));
    expect(entries).toHaveLength(0);
  });
});

describe("fingerprint", () => {
  it("returns same hash for same content", async () => {
    writeFile("f.ts", "hello");
    const abs = path.join(tmpDir, "f.ts");
    const e = { absolutePath: abs, relativePath: "f.ts", sizeBytes: 5 };
    const h1 = await fingerprint(e);
    const h2 = await fingerprint(e);
    expect(h1).toBe(h2);
  });

  it("returns different hash after content change", async () => {
    writeFile("g.ts", "version1");
    const abs = path.join(tmpDir, "g.ts");
    const e = { absolutePath: abs, relativePath: "g.ts", sizeBytes: 8 };
    const h1 = await fingerprint(e);
    fs.writeFileSync(abs, "version2");
    const h2 = await fingerprint(e);
    expect(h1).not.toBe(h2);
  });
});
