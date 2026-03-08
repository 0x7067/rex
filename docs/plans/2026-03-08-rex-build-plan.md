# Build Plan: rex

**Date:** 2026-03-08
**Stack:** TypeScript + Commander.js + LanceDB + transformers.js

Each task follows strict red-then-green TDD: write a failing test, run it red, write the minimal implementation, run it green, commit.

---

## Task 1: Project Scaffold

**Goal:** Runnable `rex --version` with test infrastructure in place.

Files:
- `package.json` — dependencies, `bin.rex`, scripts
- `tsconfig.json` — strict mode, ESM, Node20 target
- `vitest.config.ts` — test config with `REX_HOME` isolation
- `bin/rex.ts` — Commander root with `--version`

Test: `test/scaffold.test.ts`
```ts
// rex --version exits 0 and prints a semver string
```

Commands:
```bash
bun install
bun run test -- test/scaffold.test.ts  # red
# implement
bun run test -- test/scaffold.test.ts  # green
git commit -m "feat: project scaffold with rex entry point"
```

---

## Task 2: Config Module

**Goal:** `rexHome()`, `snapshotsDir()`, `lanceDir()`, `registryPath()` all respect `REX_HOME`.

Files:
- `src/core/config.ts`
- `test/core/config.test.ts`

Test cases:
- Default paths resolve under `~/.rex`
- `REX_HOME=/tmp/test-rex` overrides all paths

Commands:
```bash
bun run test -- test/core/config.test.ts  # red → green
git commit -m "feat: config module with REX_HOME support"
```

---

## Task 3: Resource Schema

**Goal:** Zod schemas parse and validate resource objects; UUID generated at creation.

Files:
- `src/core/resource.ts`
- `test/core/resource.test.ts`

Test cases:
- Valid resource parses successfully
- Missing required fields throw `ZodError`
- `createResource(input)` generates a UUID `id` automatically
- `id` is a valid UUID v4

Commands:
```bash
bun run test -- test/core/resource.test.ts  # red → green
git commit -m "feat: resource schema with zod + UUID generation"
```

---

## Task 4: Registry CRUD

**Goal:** Add, remove, list, and get resources persisted to `registry.json`.

Files:
- `src/core/registry.ts`
- `test/core/registry.test.ts`

Test cases:
- `addResource` writes to file and returns the resource
- `addResource` throws on duplicate name
- `removeResource(id)` deletes by UUID not by name
- `getResource(name)` resolves by name to the resource record
- `listResources()` returns all resources
- Atomic writes: concurrent writes don't corrupt the file (use temp file + rename)
- Returns empty list when registry file doesn't exist yet

Commands:
```bash
bun run test -- test/core/registry.test.ts  # red → green
git commit -m "feat: registry CRUD with atomic JSON persistence"
```

---

## Task 5: Local Adapter

**Goal:** `detect`, `normalize`, `materialize`, and `reference` for local paths.

Files:
- `src/adapters/adapter.ts` (interface)
- `src/adapters/local.ts`
- `test/adapters/local.test.ts`

Test cases:
- `detect("./some/path")` → true
- `detect("https://github.com/x/y")` → false
- `normalize("./some/path")` → absolute path
- `normalize("/nonexistent")` → throws
- `materialize(absPath, targetDir)` → resolves successfully (no-op for local)
- `reference(entry, resource)` → `"my-project: src/index.ts"`

Commands:
```bash
bun run test -- test/adapters/local.test.ts  # red → green
git commit -m "feat: local resource adapter"
```

---

## Task 6: Shared Enumerate + Fingerprint

**Goal:** Walk a directory, apply include/exclude rules, hash files.

Files:
- `src/adapters/shared.ts`
- `test/adapters/shared.test.ts`

Test cases:
- `enumerate(dir, [], [])` yields all non-binary files
- `enumerate` respects include globs
- `enumerate` respects exclude globs (default: `node_modules/`, `.git/`)
- `fingerprint(entry)` returns same hash for same content
- `fingerprint(entry)` returns different hash after content change
- Works on a real temp directory fixture

Commands:
```bash
bun run test -- test/adapters/shared.test.ts  # red → green
git commit -m "feat: shared enumerate and fingerprint"
```

---

## Task 7: Chunker

**Goal:** Split file text into fixed-size chunks with overlap.

Files:
- `src/indexing/chunker.ts`
- `test/indexing/chunker.test.ts`

Test cases:
- Short file (<512 tokens) → 1 chunk
- Long file → multiple chunks with `chunk_index` 0, 1, 2...
- Adjacent chunks overlap by ~50 tokens
- Each chunk carries `file_path`, `resource_id`, `resource_name`, `fingerprint`, `chunk_index`
- Empty file → 0 chunks

Commands:
```bash
bun run test -- test/indexing/chunker.test.ts  # red → green
git commit -m "feat: fixed-size chunker with 50-token overlap"
```

---

## Task 8: Embedder

**Goal:** Embed an array of text strings into float32 vectors using `nomic-embed-text-v1.5`.

Files:
- `src/indexing/embedder.ts`
- `test/indexing/embedder.test.ts`

Test cases:
- `embed(["hello world"])` → array of length 1, each vector has 768 dimensions
- Vectors are float32 arrays
- Semantically similar strings produce higher cosine similarity than unrelated strings
- Model loads lazily on first call (singleton pipeline)

Commands:
```bash
bun run test -- test/indexing/embedder.test.ts  # red → green
git commit -m "feat: local embedder via transformers.js nomic-embed-text-v1.5"
```

---

## Task 9: LanceDB Store

**Goal:** Write and read chunks and summaries from LanceDB.

Files:
- `src/indexing/store.ts`
- `test/indexing/store.test.ts`

Test cases:
- `writeChunks([...])` inserts rows
- `deleteChunks(resourceId)` removes all rows for that UUID
- `searchChunks(vector, [resourceId], 5)` returns top 5 by cosine similarity
- `searchChunks` with wrong `resourceId` returns 0 results (isolation)
- `writeSummaries([...])` inserts rows
- `deleteSummaries(resourceId)` removes rows
- `getSummaries([resourceId])` returns summaries for that resource only
- Two resources with identical chunk text but different `resource_id` are kept separate

Commands:
```bash
bun run test -- test/indexing/store.test.ts  # red → green
git commit -m "feat: LanceDB store with resource_id isolation"
```

---

## Task 10: Git Adapter

**Goal:** Clone a git repo to a managed directory; pull on subsequent materialize calls.

Files:
- `src/adapters/git.ts`
- `test/adapters/git.test.ts`

Test cases:
- `detect("https://github.com/org/repo")` → true
- `detect("./local")` → false
- `normalize("https://github.com/org/repo")` → canonical URL with `.git`
- `materialize` clones to `targetDir` when not present
- `materialize` pulls when clone already exists
- `reference(entry, resource)` → `"repo (github.com/org/repo): src/main.ts"`
- Fingerprint uses git object hash when available

Commands:
```bash
bun run test -- test/adapters/git.test.ts  # red → green (uses bare local repos as fixtures)
git commit -m "feat: git adapter with clone/pull via simple-git"
```

---

## Task 11: Package Adapter

**Goal:** Download and extract an npm package to a managed directory.

Files:
- `src/adapters/package.ts`
- `test/adapters/package.test.ts`

Test cases:
- `detect("express")` → true
- `detect("express@4.18.2")` → true
- `detect("npm:express@4.18.2")` → true
- `detect("./local")` → false
- `normalize("express")` → `"npm:express@<resolved-latest-version>"`
- `materialize` extracts to `targetDir`
- `reference(entry, resource)` → `"express@4.18.2: lib/express.js"`

Commands:
```bash
bun run test -- test/adapters/package.test.ts  # red → green
git commit -m "feat: package adapter with registry version resolution"
```

---

## Task 12: Sync Engine

**Goal:** Detect changed files and re-index only what changed.

Files:
- `src/core/sync.ts`
- `test/core/sync.test.ts`

Test cases:
- Unchanged file fingerprint → skip re-embed
- Changed file fingerprint → delete old chunks, write new chunks
- New file → write new chunks
- Deleted file → delete its chunks
- Any change → trigger summary block regeneration
- `--full` flag → delete all chunks and re-index everything
- `last_sync_status` set to `"partial"` if some files fail

Commands:
```bash
bun run test -- test/core/sync.test.ts  # red → green
git commit -m "feat: incremental sync engine with fingerprint diffing"
```

---

## Task 13: Provider Implementations

**Goal:** All three providers call through correctly; `execProvider` dispatches.

Files:
- `src/provider/interface.ts`
- `src/provider/ollama.ts`
- `src/provider/claude.ts`
- `src/provider/codex.ts`
- `test/provider/provider.test.ts`

Test cases:
- `getProvider("ollama")` returns an object with `.call()`
- Ollama provider makes HTTP POST to configured endpoint (mock with `nock` or `msw`)
- Claude provider shells out to `claude` binary (mock with `execa` mock)
- Codex provider shells out to `codex` binary (mock)
- Missing binary → throws typed `ProviderError` with helpful message
- Provider errors propagate as `ProviderError`

Commands:
```bash
bun run test -- test/provider/provider.test.ts  # red → green
git commit -m "feat: provider implementations (ollama, claude, codex)"
```

---

## Task 14: Answerer

**Goal:** Assemble grounded prompt from summaries + chunks and call provider.

Files:
- `src/query/answerer.ts`
- `test/query/answerer.test.ts`

Test cases:
- Prompt includes system instruction
- Prompt has one section per resource, labeled with name and UUID
- Summaries appear before chunks in each resource section
- Chunks are labeled with file path
- Answer + sources parsed from provider response
- Summary generation prompt correctly includes all chunk texts

Commands:
```bash
bun run test -- test/query/answerer.test.ts  # red → green
git commit -m "feat: answerer with per-resource context isolation"
```

---

## Task 15: Retriever

**Goal:** Vector search returning ranked chunks filtered by resource IDs.

Files:
- `src/query/retriever.ts`
- `test/query/retriever.test.ts`

Test cases:
- Returns top-K chunks by cosine similarity
- Filtered to `resource_id[]` — chunks from other resources never returned
- Per-resource cap: max 10 chunks per resource (configurable)
- Total cap: max 40 chunks across all resources
- Empty index → returns empty array (no error)

Commands:
```bash
bun run test -- test/query/retriever.test.ts  # red → green
git commit -m "feat: retriever with per-resource isolation and caps"
```

---

## Task 16: Wire CLI Commands

**Goal:** All 6 Commander commands fully wired to core logic.

Files:
- `src/cli/connect.ts`
- `src/cli/add.ts`
- `src/cli/remove.ts`
- `src/cli/resources.ts`
- `src/cli/sync.ts`
- `src/cli/ask.ts`

Each command:
- Accepts the flags defined in the CLI spec
- Formats human-readable and `--json` output
- Uses correct exit codes from spec
- Delegates to core modules (no business logic in CLI layer)

Test strategy: integration tests using `execa` to invoke `rex` as a subprocess.

Commands:
```bash
bun run test -- test/cli/  # red → green
git commit -m "feat: wire all CLI commands to core logic"
```

---

## Task 17: End-to-End Validation

**Goal:** Verify the full product loop works against a real local project.

```bash
# Configure provider
rex connect ollama --model llama3

# Index local project
rex add ./some-local-project

# Check resource listed
rex resources

# Sync (no changes expected)
rex sync

# Ask a question
rex ask -q "what does this project do?"

# Ask with JSON output
rex ask -q "what is the main entry point?" --json

# Add a git repo
rex add https://github.com/some/public-repo

# Multi-resource ask
rex ask -q "compare the two projects" -r some-local-project -r public-repo

# Remove a resource
rex remove some-local-project
```

This task is manual validation. All automated tests should already be green.

---

## Dependency List

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "@lancedb/lancedb": "^0.9.0",
    "@huggingface/transformers": "^3.0.0",
    "zod": "^3.22.0",
    "simple-git": "^3.27.0",
    "execa": "^9.0.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```
