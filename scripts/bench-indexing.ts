import { performance } from "node:perf_hooks";
import { chunkText } from "../src/indexing/chunker.js";
import { createEmbedBatches } from "../src/indexing/embed-options.js";

const entry = {
  absolutePath: "/tmp/bench.ts",
  relativePath: "src/bench.ts",
  sizeBytes: 0,
};

const resourceId = "bench-resource";
const resourceName = "bench";
const fingerprint = "bench-fingerprint";

const fixture = [
  "## Architecture",
  "",
  ...Array.from({ length: 80 }, (_, i) => `export function section${i}() { return "${"x".repeat(180)}"; }`),
  "",
  ...Array.from({ length: 120 }, (_, i) => `const line${i} = "${"y".repeat(120)}";`),
].join("\n");

const iterations = 200;

const chunkStart = performance.now();
let chunks = [];
for (let i = 0; i < iterations; i++) {
  chunks = chunkText(fixture, entry, resourceId, resourceName, fingerprint);
}
const chunkMs = performance.now() - chunkStart;

const batchStart = performance.now();
let batches = [];
for (let i = 0; i < iterations; i++) {
  batches = createEmbedBatches(chunks);
}
const batchMs = performance.now() - batchStart;

console.log(JSON.stringify({
  fixture_chars: fixture.length,
  iterations,
  chunk_count: chunks.length,
  batch_count: batches.length,
  avg_chunk_ms: Number((chunkMs / iterations).toFixed(3)),
  avg_batch_ms: Number((batchMs / iterations).toFixed(3)),
  avg_chunk_tokens: chunks.length === 0
    ? 0
    : Math.round(
      chunks.reduce((sum, chunk) => sum + chunk.estimated_tokens, 0) /
        chunks.length,
    ),
}, null, 2));
