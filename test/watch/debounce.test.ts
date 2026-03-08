import { describe, expect, it } from "vitest";
import { createDebouncedBatch } from "../../src/watch/debounce.js";

describe("createDebouncedBatch", () => {
  it("add and flush returns accumulated items", () => {
    const batch = createDebouncedBatch<string>((s) => s);
    batch.add("a");
    batch.add("b");
    batch.add("c");
    const items = batch.flush();
    expect(items).toHaveLength(3);
    expect(items).toContain("a");
    expect(items).toContain("b");
    expect(items).toContain("c");
  });

  it("flush clears the batch", () => {
    const batch = createDebouncedBatch<string>((s) => s);
    batch.add("a");
    batch.flush();
    expect(batch.flush()).toHaveLength(0);
  });

  it("deduplicates by key (last item wins)", () => {
    type Item = { path: string; content: string };
    const batch = createDebouncedBatch<Item>((item) => item.path);
    batch.add({ path: "src/a.ts", content: "v1" });
    batch.add({ path: "src/a.ts", content: "v2" });
    batch.add({ path: "src/b.ts", content: "v1" });
    const items = batch.flush();
    expect(items).toHaveLength(2);
    const aItem = items.find((i) => i.path === "src/a.ts");
    expect(aItem?.content).toBe("v2");
  });

  it("pending count reflects number of unique keys", () => {
    const batch = createDebouncedBatch<string>((s) => s);
    expect(batch.pending).toBe(0);
    batch.add("a");
    expect(batch.pending).toBe(1);
    batch.add("b");
    expect(batch.pending).toBe(2);
    batch.add("a"); // duplicate
    expect(batch.pending).toBe(2);
    batch.flush();
    expect(batch.pending).toBe(0);
  });

  it("flush on empty batch returns empty array", () => {
    const batch = createDebouncedBatch<string>((s) => s);
    expect(batch.flush()).toEqual([]);
  });
});
