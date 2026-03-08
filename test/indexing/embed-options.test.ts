import { describe, it, expect } from "vitest";
import {
  createEmbedBatches,
  formatBatchProgress,
  formatEmbedSummary,
} from "../../src/indexing/embed-options.js";

describe("formatBatchProgress", () => {
  it("formats progress with timing info", () => {
    const result = formatBatchProgress({
      batchStart: 128,
      totalChunks: 512,
      batchSize: 128,
      elapsedMs: 45,
    });
    expect(result).toBe(
      "Embedding chunks... (128/512) — 45ms/batch, 2844 chunks/sec",
    );
  });

  it("handles zero elapsedMs without crashing", () => {
    const result = formatBatchProgress({
      batchStart: 0,
      totalChunks: 128,
      batchSize: 128,
      elapsedMs: 0,
    });
    expect(result).toContain("Embedding chunks... (0/128)");
    expect(result).not.toMatch(/Infinity|NaN/);
  });

  it("formats first batch (batchStart = 0)", () => {
    const result = formatBatchProgress({
      batchStart: 0,
      totalChunks: 256,
      batchSize: 128,
      elapsedMs: 100,
    });
    expect(result).toBe(
      "Embedding chunks... (0/256) — 100ms/batch, 1280 chunks/sec",
    );
  });
});

describe("formatEmbedSummary", () => {
  it("formats summary with chunks and throughput", () => {
    const result = formatEmbedSummary({ totalChunks: 512, totalMs: 1200 });
    expect(result).toBe("Embedded 512 chunks in 1.2s (427 chunks/sec)");
  });

  it("handles zero totalChunks without crashing", () => {
    const result = formatEmbedSummary({ totalChunks: 0, totalMs: 100 });
    expect(result).toContain("Embedded 0 chunks");
    expect(result).not.toMatch(/Infinity|NaN/);
  });

  it("handles zero totalMs without crashing", () => {
    const result = formatEmbedSummary({ totalChunks: 100, totalMs: 0 });
    expect(result).toContain("Embedded 100 chunks");
    expect(result).not.toMatch(/Infinity|NaN/);
  });
});

describe("createEmbedBatches", () => {
  it("splits batches when item count exceeds the cap", () => {
    const batches = createEmbedBatches(
      Array.from({ length: 70 }, (_, i) => ({
        text: `chunk-${i}`,
        estimated_tokens: 2,
      })),
    );

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(64);
    expect(batches[1]).toHaveLength(6);
  });

  it("splits batches when total character count exceeds the cap", () => {
    const big = "x".repeat(25000);
    const batches = createEmbedBatches([
      { text: big, estimated_tokens: 6250 },
      { text: big, estimated_tokens: 6250 },
      { text: "tail", estimated_tokens: 1 },
    ]);

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(2);
  });
});
