import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { chunkFile, chunkText } from "../../src/indexing/chunker.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-chunker-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const RESOURCE_ID = "00000000-0000-4000-8000-000000000001";
const RESOURCE_NAME = "test-resource";
const FINGERPRINT = "abc123";

function makeEntry(relativePath: string, absolutePath: string) {
  return { absolutePath, relativePath, sizeBytes: 0 };
}

describe("chunkText", () => {
  it("returns 1 chunk for short text", () => {
    const entry = makeEntry("a.ts", "/tmp/a.ts");
    const chunks = chunkText(
      "hello world",
      entry,
      RESOURCE_ID,
      RESOURCE_NAME,
      FINGERPRINT,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunk_index).toBe(0);
    expect(chunks[0]?.text).toBe("hello world");
  });

  it("returns 0 chunks for empty text", () => {
    const entry = makeEntry("empty.ts", "/tmp/empty.ts");
    const chunks = chunkText("", entry, RESOURCE_ID, RESOURCE_NAME, FINGERPRINT);
    expect(chunks).toHaveLength(0);
  });

  it("splits long text into multiple chunks", () => {
    // 512 tokens * 4 chars/token = 2048 chars per chunk
    const longText = "a".repeat(6000);
    const entry = makeEntry("long.ts", "/tmp/long.ts");
    const chunks = chunkText(longText, entry, RESOURCE_ID, RESOURCE_NAME, FINGERPRINT);
    expect(chunks.length).toBeGreaterThan(1);
    // chunks are consecutive
    expect(chunks[0]?.chunk_index).toBe(0);
    expect(chunks[1]?.chunk_index).toBe(1);
  });

  it("sets correct metadata on each chunk", () => {
    const entry = makeEntry("src/main.ts", "/tmp/src/main.ts");
    const chunks = chunkText(
      "some code",
      entry,
      RESOURCE_ID,
      RESOURCE_NAME,
      FINGERPRINT,
    );
    const c = chunks[0]!;
    expect(c.resource_id).toBe(RESOURCE_ID);
    expect(c.resource_name).toBe(RESOURCE_NAME);
    expect(c.file_path).toBe("src/main.ts");
    expect(c.fingerprint).toBe(FINGERPRINT);
    expect(c.start_line).toBe(1);
    expect(c.end_line).toBe(1);
    expect(c.chunk_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.estimated_tokens).toBeGreaterThan(0);
  });

  it("tracks inclusive line spans for multiline chunks", () => {
    const entry = makeEntry("src/lines.ts", "/tmp/src/lines.ts");
    const chunks = chunkText(
      ["line 1", "line 2", "line 3", "line 4"].join("\n"),
      entry,
      RESOURCE_ID,
      RESOURCE_NAME,
      FINGERPRINT,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.start_line).toBe(1);
    expect(chunks[0]?.end_line).toBe(4);
  });

  it("prefers strong boundaries and avoids overlap on function splits", () => {
    const entry = makeEntry("src/boundaries.ts", "/tmp/src/boundaries.ts");
    const alphaBody = "a".repeat(2200);
    const betaBody = "b".repeat(2200);
    const text =
      `export function alpha() {\n  const alpha = "${alphaBody}";\n}\n\n` +
      `export function beta() {\n  const beta = "${betaBody}";\n}\n`;

    const chunks = chunkText(
      text,
      entry,
      RESOURCE_ID,
      RESOURCE_NAME,
      FINGERPRINT,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text.endsWith("}\n\n")).toBe(true);
    expect(chunks[0]?.text.includes("export function beta")).toBe(false);
    expect(chunks[1]?.text.startsWith("export function beta")).toBe(true);
  });
});

describe("chunkFile", () => {
  it("returns chunks for a real file", () => {
    const filePath = path.join(tmpDir, "code.ts");
    fs.writeFileSync(filePath, "export const x = 42;");
    const entry = makeEntry("code.ts", filePath);
    const chunks = chunkFile(entry, RESOURCE_ID, RESOURCE_NAME, FINGERPRINT);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.text).toContain("export const x");
  });

  it("returns empty array for non-existent file", () => {
    const entry = makeEntry("missing.ts", path.join(tmpDir, "missing.ts"));
    const chunks = chunkFile(entry, RESOURCE_ID, RESOURCE_NAME, FINGERPRINT);
    expect(chunks).toHaveLength(0);
  });
});
