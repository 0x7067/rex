# Citation Grounding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `rex ask` return only validated cited sources, including line ranges, instead of every retrieved file.

**Architecture:** Add `start_line` and `end_line` to indexed chunks, require a machine-readable citation block from the model, parse and validate citations against retrieved chunks, and emit only validated citations through the CLI.

**Tech Stack:** TypeScript, Vitest, Commander, LanceDB

---

### Task 1: Add Chunk Line Span Coverage

**Files:**
- Modify: `test/indexing/chunker.test.ts`
- Modify: `src/indexing/chunker.ts`

**Step 1: Write the failing test**

Add a multiline chunking test that asserts the resulting chunk includes the correct inclusive `start_line` and `end_line`.

**Step 2: Run test to verify it fails**

Run: `bun run test -- test/indexing/chunker.test.ts`
Expected: FAIL because chunk metadata does not yet include line spans.

**Step 3: Write minimal implementation**

Add `start_line` and `end_line` to the `Chunk` type and compute them during chunking from slice boundaries.

**Step 4: Run test to verify it passes**

Run: `bun run test -- test/indexing/chunker.test.ts`
Expected: PASS

### Task 2: Persist Line Spans Through Storage and Retrieval

**Files:**
- Modify: `src/indexing/store.ts`
- Modify: `src/query/retriever.ts`
- Modify: `test/query/retriever.test.ts`

**Step 1: Write the failing test**

Add retrieval coverage asserting `RetrievedChunk` includes the stored `start_line` and `end_line`.

**Step 2: Run test to verify it fails**

Run: `bun run test -- test/query/retriever.test.ts`
Expected: FAIL because retrieved chunks do not yet carry line spans.

**Step 3: Write minimal implementation**

Extend `ChunkRow`, write path, and retrieval mapping to preserve line span fields.

**Step 4: Run test to verify it passes**

Run: `bun run test -- test/query/retriever.test.ts`
Expected: PASS

### Task 3: Add Structured Citation Parsing and Validation Tests

**Files:**
- Modify: `test/query/answerer.test.ts`
- Modify: `src/query/answerer.ts`

**Step 1: Write the failing test**

Add tests that:
- require the model output to include a `<rex_sources>` block
- strip that block from the final human answer
- accept only citations that match retrieved chunks
- reject unrelated file citations
- preserve validated line ranges in `answer.sources`

**Step 2: Run test to verify it fails**

Run: `bun run test -- test/query/answerer.test.ts`
Expected: FAIL because answer generation currently returns all retrieved files and does not parse citations.

**Step 3: Write minimal implementation**

Update prompt construction to include chunk line spans and instructions for the citation block. Parse citations, validate them against retrieved chunks, and return only validated citations.

**Step 4: Run test to verify it passes**

Run: `bun run test -- test/query/answerer.test.ts`
Expected: PASS

### Task 4: Update CLI Output Formatting

**Files:**
- Modify: `src/cli/ask.ts`
- Modify: `test/cli/ask.test.ts`

**Step 1: Write the failing test**

Add CLI tests for:
- human-readable output rendering `lines X-Y`
- JSON output including `lines`
- omission of unrelated uncited files

**Step 2: Run test to verify it fails**

Run: `bun run test -- test/cli/ask.test.ts`
Expected: FAIL because the CLI currently prints only `resource: path`.

**Step 3: Write minimal implementation**

Format `Sources:` output with line ranges when present and rely on validated `answer.sources`.

**Step 4: Run test to verify it passes**

Run: `bun run test -- test/cli/ask.test.ts`
Expected: PASS

### Task 5: Verify End-to-End Citation Grounding

**Files:**
- Modify: `src/query/answerer.ts`
- Modify: `src/indexing/chunker.ts`
- Modify: `src/indexing/store.ts`
- Modify: `src/query/retriever.ts`
- Modify: `src/cli/ask.ts`

**Step 1: Run targeted suite**

Run: `bun run test -- test/indexing/chunker.test.ts test/query/retriever.test.ts test/query/answerer.test.ts test/cli/ask.test.ts`
Expected: PASS

**Step 2: Sanity-check no stale assumptions**

Review source output paths and line ranges in test assertions to confirm the system never reverts to “all retrieved files.”

**Step 3: Optional broader verification**

Run: `bun run test`
Expected: PASS or a clearly documented unrelated failure
