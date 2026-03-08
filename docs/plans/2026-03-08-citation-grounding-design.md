# Citation Grounding Design

## Goal

Make `rex ask` emit accurate, evidence-backed citations by carrying line spans through indexing, requiring structured model citations, validating those citations against retrieved chunks, and only printing validated cited sources.

## Problem

Today the answer text and the emitted `Sources:` list are only loosely connected. The model can mention one file in the answer, while the CLI prints every retrieved file as a source. This makes the output look grounded even when the displayed source list is broader than the evidence actually used.

## Chosen Approach

We will ground citations in four layers:

1. Indexing will attach `start_line` and `end_line` to every chunk.
2. Prompting will require the model to return a machine-readable citation block containing exact file paths and line spans from the provided context.
3. Answer generation will parse and validate those citations against retrieved chunks before accepting them.
4. CLI output will print only the validated citations, including line ranges.

## Architecture

### Chunk Metadata

`chunkText()` currently tracks file path and chunk index, but not line boundaries. We will add `start_line` and `end_line` to `Chunk`, persist them in LanceDB, and return them in `RetrievedChunk`.

Line spans will be computed from the character slice boundaries already used during chunking. We will count newline boundaries in the original text and assign an inclusive line range to each chunk.

### Structured Citations

The answer prompt will continue to include labeled resource sections, but each chunk header will now include its line span. The model will be instructed to append a hidden machine-readable citation block after the human answer.

The block format should be simple, robust, and easy to strip from the final answer, for example:

```text
<rex_sources>
resource-name|path/to/file.md|12|30
resource-name|another/file.ts|5|18
</rex_sources>
```

This keeps the user-facing answer flexible while giving the application a deterministic structure to parse.

### Citation Validation

Parsed citations are not trusted automatically. A citation is valid only when:

- `resource` matches a retrieved resource name
- `path` matches a retrieved chunk file path
- cited line span overlaps at least one retrieved chunk for that same resource and file

If a citation fails validation, it is dropped. If the model emits no valid citations, the CLI should prefer no printed sources over a misleading expanded source list.

### Output Behavior

Validated citations become the authoritative `answer.sources` payload. Human output will render:

```text
Sources:
  - ravn: office-locations.md (lines 1-18)
```

JSON output will include:

```json
{
  "resource": "ravn",
  "path": "office-locations.md",
  "lines": [1, 18]
}
```

## Testing Strategy

- Add chunker tests for computed line spans.
- Add answerer tests for structured citation parsing, stripping, and validation.
- Add CLI tests for human and JSON output formatting with line ranges.
- Run targeted Vitest coverage for chunker, answerer, and ask command behavior.

## Non-Goals

- Per-sentence citation rendering inside the human answer body
- Re-ranking retrieval in this change
- Recovering citations for claims that rely on summaries only

## Risks

- Models may emit malformed citation blocks.
  Mitigation: use a simple delimiter format and validate strictly.
- Chunk line spans may be off by one around overlap boundaries.
  Mitigation: add precise tests on multiline fixtures.
- Older indexed data will not contain line spans.
  Mitigation: use current sync/index path to regenerate chunks and keep validation limited to retrieved chunks that have line data.
