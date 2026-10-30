import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import { z } from "zod";
import { createResource } from "../src/core/resource.js";
import { indexResourceFiles } from "../src/indexing/pipeline.js";
import { disposeEmbedder, embedOne } from "../src/indexing/embedder.js";
import { getCurrentIndexProfile } from "../src/indexing/profile.js";
import {
  resetDb,
  searchChunks,
  searchHybridChunks,
} from "../src/indexing/store.js";
const fixture = z
  .object({
    corpus_paths: z.array(z.string()),
    questions: z.array(
      z.object({
        question: z.string(),
        relevant_paths: z.array(z.string()).min(1),
      }),
    ),
  })
  .parse(
    JSON.parse(
      fs.readFileSync(
        new URL("../test/fixtures/rag-eval.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const project = path.resolve(import.meta.dirname, "..");
const scratch = fs.mkdtempSync(
  path.join(
    fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(),
    "rex-rag-eval-",
  ),
);
const previousHome = process.env["REX_HOME"];
process.env["REX_HOME"] = path.join(scratch, "state");
const corpus = path.join(scratch, "corpus");
const corpusHash = crypto.createHash("sha256");
try {
  for (const relative of fixture.corpus_paths) {
    const target = path.join(corpus, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(project, relative), target);
    corpusHash.update(relative).update("\0").update(fs.readFileSync(target));
  }
  const resource = createResource({
    name: "rex-eval",
    type: "local",
    source: corpus,
    normalized_source: corpus,
    notes: "",
    include_rules: [],
    exclude_rules: [],
    snapshot_metadata: { type: "local", absolute_path: corpus },
  });
  const start = performance.now();
  const indexed = await indexResourceFiles({
    resource,
    materializedDir: corpus,
    includeRules: [],
    excludeRules: [],
    fullSync: true,
  });
  const indexingMs = performance.now() - start;
  const results = [];
  for (const item of fixture.questions) {
    const query = await embedOne(item.question);
    const denseStart = performance.now();
    const dense = await searchChunks(query, [resource.id], 5);
    const denseMs = performance.now() - denseStart;
    const hybridStart = performance.now();
    const hybrid = await searchHybridChunks(
      item.question,
      query,
      [resource.id],
      5,
    );
    const hybridMs = performance.now() - hybridStart;
    const rank = (rows: typeof dense) =>
      rows.findIndex((row) => item.relevant_paths.includes(row.file_path)) + 1;
    results.push({
      question: item.question,
      dense_rank: rank(dense),
      hybrid_rank: rank(hybrid),
      dense_ms: denseMs,
      hybrid_ms: hybridMs,
    });
  }
  const metrics = (mode: "dense" | "hybrid") => {
    const ranks = results.map((row) =>
      mode === "dense" ? row.dense_rank : row.hybrid_rank,
    );
    const times = results
      .map((row) => (mode === "dense" ? row.dense_ms : row.hybrid_ms))
      .sort((a, b) => a - b);
    return {
      hit_rate_at_5: ranks.filter((rank) => rank > 0).length / ranks.length,
      mrr_at_5:
        ranks.reduce((sum, rank) => sum + (rank > 0 ? 1 / rank : 0), 0) /
        ranks.length,
      p50_search_ms: times[Math.floor(times.length / 2)],
      p95_search_ms:
        times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
    };
  };
  console.log(
    JSON.stringify(
      {
        scope:
          "Eight labeled questions over eight Rex source files; retrieval only, not answer-faithfulness or general production quality",
        profile: getCurrentIndexProfile(),
        corpus_sha256: corpusHash.digest("hex"),
        node_version: process.version,
        questions: results.length,
        chunks: indexed.chunksUpdated,
        indexing_ms: indexingMs,
        dense: metrics("dense"),
        hybrid: metrics("hybrid"),
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await resetDb();
  await disposeEmbedder();
  fs.rmSync(scratch, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env["REX_HOME"];
  else process.env["REX_HOME"] = previousHome;
}
