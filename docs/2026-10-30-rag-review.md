# Rex RAG review and modernization

Reviewed 2026-10-30 UTC against `0x7067/rex` at `1f38dfbd61eaa57ba84b4d7253dc6d0c275d3b34`. The implementation accompanying this report addresses the confirmed defects below. The review treats Rex as a local code/document knowledge CLI.

Rex's architecture is a reasonable fit: local embeddings and storage, immutable resource IDs, source line spans and a narrow generation interface. The largest problems were correctness and evidence handling. Updating the dependencies made native hybrid retrieval available without adding another database or orchestration framework.

## Findings and resulting changes

| Priority | Confirmed behavior before the change                                                                                                                                                                 | Implemented behavior and verification                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | `org-a/same` and `org-b/same` materialized into the same snapshot directory. A real local Git probe returned project A under project B's reported source URL.                                        | Snapshot paths include a hash of the complete source URL. Existing origins must match. Sync persists fresh snapshot metadata. Native Git regression tests cover both collisions and replaced origins.                                                                                                                          |
| P1       | Document and query strings reached Nomic without its required task prefixes.                                                                                                                         | Apply `search_document:` and `search_query:` at the embedding boundary; include file paths in document inputs and token budgets. Model/context initialization is shared across concurrent calls and retries after initialization failure.                                                                                      |
| P1       | The index/cache identity used a model label independent of the actual GGUF source. Queries did not check profile compatibility.                                                                      | Profile includes actual source URI, encoding protocol, 768-dimensional vectors, chunker and schema versions. Cache keys include the profile and embedded path/text. Queries skip incompatible profiles; the next sync fully rebuilds them. The default GGUF is pinned to HF commit `0188c9bf409793f810680a5a431e7b899c46104c`. |
| P1       | Reindexing deleted old rows before embedding succeeded. A failed rebuild could remove previously usable content.                                                                                     | Prepare and validate all replacement rows first, then replace one resource with a single scoped `mergeInsert` commit. Real-store tests verify failure preservation, empty replacements and isolation from other resources. Sync shares the existing per-resource write lock with add.                                          |
| P1       | Incremental sync replaced project summaries using only changed chunks. Deletion-only sync deleted summaries despite surviving content; summary errors escaped without recording partial state.       | Build bounded overviews from all surviving content, sampling across files. Replace summaries after generation succeeds, record failures as `partial`, preserve the last successful timestamp and repair on the next sync. Summaries are navigation hints rather than citation evidence.                                        |
| P1       | The per-resource cap checked the global selected count. Three resources with enough candidates produced counts `[10, 1, 1]`. A global pool of 80 candidates could contain only the largest resource. | Retrieve candidates independently per resource, preserve distinct spans and interleave ranks before the total cap. The corresponding test now returns `[10, 10, 10]`. Provider choice no longer changes the retrieval policy or applies arbitrary source-path penalties.                                                       |
| P1       | Empty retrieval still called generation. Unsupported prose was returned even when all citations were invalid.                                                                                        | No file evidence means no generation call. Missing/invalid citations or empty output return `insufficient_context`. References are checked against excerpts actually admitted to the bounded prompt.                                                                                                                           |
| P1       | The enumerator included `.env`, private-key files and gitignored content. Claude generation bypassed permission prompts while tools remained available.                                              | Honor nested gitignore rules and default credential exclusions. Treat excerpt strings as untrusted data. Claude uses safe mode, empty tools, denied MCP tools, a strict empty MCP configuration and disabled hooks. Codex receives explicit capability restrictions; its remaining limitation is described below.              |
| P2       | Retrieval was dense-only, and mocked tests did not measure retrieval quality or exercise the real store.                                                                                             | Use native BM25 plus cosine candidates with reciprocal rank fusion, a code tokenizer, bounded evidence and versioned retrieval questions. New native-store, Git, failure-recovery and grounding tests complement unit tests.                                                                                                   |

Nomic's task prefixes are part of the model's documented usage contract. Its embedding library does not infer document/query roles. Correcting the encoding therefore requires rebuilding old vectors, rather than simply changing the query prefix. [Nomic model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), [node-llama-cpp embedding guide](https://node-llama-cpp.withcat.ai/guide/embedding).

A separate probe supplied a valid file/line reference alongside an answer saying PostgreSQL when its excerpt said SQLite. The original validator accepted it. The new checks enforce evidence presence and reference validity, but still do not prove semantic support. ALCE distinguishes support for individual statements from the mere presence of valid citations; that distinction remains part of the evaluation backlog. [ALCE, section 3.3](https://arxiv.org/abs/2305.14627).

## Libraries and runtime

| Component        | Before                            | After   |
| ---------------- | --------------------------------- | ------- |
| LanceDB          | 0.9.0                             | 0.41.0  |
| node-llama-cpp   | 3.17.1                            | 3.22.2  |
| Commander        | 12.1.0                            | 15.0.0  |
| Execa            | 9.6.1                             | 10.2.1  |
| Minimatch        | 10.2.4                            | 11.0.3  |
| Ora              | 9.3.0                             | 9.4.1   |
| simple-git       | 3.32.3                            | 4.0.2   |
| Zod              | 3.25.76                           | 4.6.7   |
| TypeScript       | 5.9.3                             | 7.0.2   |
| Vitest           | 1.6.1                             | 5.0.5   |
| tsx              | 4.21.0                            | 4.23.15 |
| Bun              | package manager declared as 1.3.6 | 1.4.4   |
| Node requirement | 20+                               | 22.12+  |

Arrow 21.2.0 is now an explicit dependency for the database schema, within LanceDB's supported peer range. `ignore` 7.0.14 implements standard gitignore matching. Node types track the minimum supported major, 22. Bun is the single lockfile; the stale npm lockfile is removed. CI covers Node 22/24 on Linux/macOS, and workflow actions are pinned to verified release commits.

Current LanceDB supports full-text search and built-in RRF, but the old TypeScript SDK did not expose those APIs. The upgrade is functional, not just a version refresh. Explicit Arrow schemas eliminate initialization dummy rows; real integration checks caught Arrow row-prototype conversion and merge-filter details that mocked tests missed. [Hybrid search](https://docs.lancedb.com/search/hybrid-search), [FTS options](https://lancedb.github.io/lancedb/js/interfaces/FtsOptions/), [atomic merge API](https://lancedb.github.io/lancedb/js/classes/MergeInsertBuilder/).

The first audit after upgrading still found seven advisory entries through transitive packages: node-llama-cpp required simple-git 3.36, and LanceDB's optional Transformers integration required an older sharp. Targeted overrides select simple-git 4.0.2 and sharp 0.35.5. The final audit returned `{}`. Native Git, CPU embeddings and a sharp encode/decode smoke check passed after these overrides. This records known advisory coverage for the repository install at review time. npm only honors overrides in a root project; a future published CLI installation is a separate dependency-resolution surface and must be audited before release. Upstream range fixes or a supported publication lock are needed to carry these transitive resolutions to consumers. [npm override scope](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides). [simple-git advisory](https://github.com/advisories/GHSA-x6jw-m9v5-85vh), [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

## Retrieval experiment

The checked-in [questions](../test/fixtures/rag-eval.json) select eight Rex source files and label eight questions with expected supporting paths. The [evaluation script](../scripts/eval-rag.ts) copies only those files into an isolated corpus, uses the real pinned Nomic Q8_0 model, and compares dense and hybrid retrieval on identical question embeddings. It does not call a generation provider. Run it with `bun run eval:rag`; `NODE_LLAMA_CPP_GPU=off` selects CPU through the library's existing setting.

[Recorded result](benchmarks/2026-10-30-rag-retrieval.json), Node 26.12.1 on CPU:

| Metric                         | Dense     | Hybrid BM25 + cosine/RRF |
| ------------------------------ | --------- | ------------------------ |
| Expected source found in top 5 | 6/8 (75%) | 7/8 (87.5%)              |
| Mean reciprocal rank at 5      | 0.4000    | 0.71875                  |
| Median search time             | 3.11 ms   | 5.74 ms                  |
| 95th-percentile search time    | 6.77 ms   | 8.58 ms                  |

The corpus produced 18 chunks. Index preparation took 8.63 seconds with cached weights; it includes model initialization, embedding and database/index writes. Search times exclude query embedding and generation. The artifact records the exact corpus SHA-256 and profile. These eight questions are an initial regression fixture, not a representative production benchmark or statistically established improvement. Both retrieval methods missed the question about GGUF source/cache identity; hybrid also ranked the sync-failure question lower than dense.

Future evaluation should separate labeled retrieval quality from groundedness, relevance, completeness and abstention. Add real user questions, missing answers, stale/contradictory evidence, cross-resource comparisons and prompt-injection fixtures before tuning models or adding a learned reranker. Human-reviewed labels remain necessary; an LLM judge is not ground truth. [Microsoft RAG evaluator methodology](https://learn.microsoft.com/en-us/azure/foundry/concepts/evaluation-evaluators/rag-evaluators).

## What remains limited

**Claim support.** Valid file ranges do not establish entailment. The response can still contain a false claim alongside a valid reference. A claim-level evaluation set is needed before adding repair/judging loops. No paid generation calls or live prompt-injection exploit were run.

**Provider isolation.** Claude's bare mode was rejected because it disables subscription/OAuth authentication. Safe mode preserves normal authentication while the provider separately disables tools and MCP. Contract tests check invocation arguments; they are not live proof of every managed policy. Codex 0.164 supports the chosen feature restrictions but has no verified universal zero-tools flag; read-only execution permits reads, and managed configuration needs separate consideration. Ignoring its user config also means custom provider configuration there is not loaded. [Claude headless mode](https://code.claude.com/docs/en/headless), [Claude CLI flags](https://code.claude.com/docs/en/cli-reference), [official OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

**Context sizing.** Embedding token counts include prefixes, paths and special tokens. Generation uses a bounded source-byte budget because the configured providers have different tokenizers. It is not an exact token guarantee for every model. Summaries are bounded hints; they may omit parts of a large resource. Source delimiters and filtering reduce confusion but do not make untrusted content safe on their own. [OWASP RAG security guidance](https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html).

**Transactions and retention.** A resource replacement is atomic within its table. Chunks, full-text indexes, summaries and registry JSON do not share one transaction. Failures after chunk commit become partial state and are excluded from new queries until repaired. Existing readers and concurrent writes to different registry entries need broader concurrency tests. Old cache namespaces and legacy snapshots are retained, so an upgrade does not purge historical sensitive material. [Lance transaction model](https://lance.org/format/table/transaction/).

**Chunk structure and further models.** The chunker preserves line spans, real token limits and Markdown heading boundaries, but it is not an AST parser. Next experiments should compare symbol/heading context, neighboring spans and a local reranker against the same labels. Structure-aware chunking has evidence on code benchmarks, and contextual retrieval addresses isolated chunks; neither establishes a guaranteed gain for Rex. A graph or agent orchestration layer is not justified by the current evidence. [cAST v2](https://arxiv.org/html/2506.15655v2), [Anthropic contextual retrieval](https://www.anthropic.com/research/contextual-retrieval).

## Validation and migration

- 217 tests across 32 files passed locally on Node 26.12.1 and Node 22.23.4, including native LanceDB and Git regression cases.
- TypeScript builds passed on both runtimes. The package dry run and shell syntax check passed.
- A table written with SDK 0.9.0 was read with 0.41.0, retained its source row and supported the new hybrid query after adding the search column.
- The default model file's SHA-256 matched HF's recorded LFS hash, `3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7`.
- The final dependency audit returned no known advisories. Native model inference was exercised on CPU, not the shared GPU. Provider response schemas reject malformed/error payloads; an isolated loopback Ollama HTTP fixture verifies request limits without an external provider.
- macOS coverage is configured in CI; local execution was Linux. Live Claude/Codex/Ollama generation and npm publication were not performed.

Use Node 22.12+ and Bun 1.4.4. After installing, run `rex sync`: old profiles automatically trigger a full rebuild, and `ask` skips them until it succeeds. Default weight identity and the embedding protocol changed, so reusing old vectors is unsafe. Custom weight sources must be immutable, Nomic-compatible and 768-dimensional; replacing a custom file behind the same URI requires a new source identity/full rebuild.

Research used DonSeTch to read primary documentation, model metadata and papers. Some search backends were degraded; direct authoritative pages and exact installed dependency source supplied the material evidence. ALCE methods and cAST's relevant sections were inspected without claiming complete appendix coverage. Vendor benchmark percentages were not transferred to Rex.
