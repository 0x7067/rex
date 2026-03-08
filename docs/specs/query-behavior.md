# Query Behavior

**Version:** v1

---

## Overview

`rex ask` is a one-shot grounded question-answering command. It retrieves relevant context from the local index and delegates answer generation to the configured LLM provider.

---

## Resource Resolution

### With `-r <name...>`

Only the named resources are queried. Rules:

- Each named resource must exist in the registry. If any named resource is not found, `ask` exits with code 2.
- If a named resource exists but has `last_sync_status: "pending"` (never synced), a warning is printed but the resource is skipped rather than causing a hard failure.
- If a named resource exists but has `last_sync_status: "failed"`, a warning is printed and the resource is skipped.

### Without `-r`

All resources in the registry are queried. Rules:

- Resources with `last_sync_status: "pending"` or `"failed"` are skipped with a warning.
- If all resources are skipped (e.g., nothing has been synced), `ask` exits with code 4.

### Multi-Resource Queries

When multiple resources are targeted:

- Summary blocks and chunks from all target resources are pooled into the context.
- The LLM prompt identifies which resource each piece of context came from.
- The answer may draw from any combination of target resources.
- Source references in the output are tagged per-resource.

---

## Answer Resolution Pipeline

For each `ask` call:

1. **Resolve resources.** Apply the rules above. Resolve each resource name to its stable `id`.
2. **Load summary blocks.** Retrieve all summary block rows from the `summaries` table filtered by `resource_id IN [...]`. Group by resource.
3. **Vector retrieval.** Embed the question using the same embedding model used at index time (nomic-embed-text-v1.5). Run ANN search in LanceDB against the `chunks` table filtered by `resource_id IN [...]`. Retrieve top-K chunks (default K=10 per resource, capped at 40 total). **Filter by `resource_id`, not `resource_name`, to guarantee isolation.**
4. **Build prompt.** Assemble the grounded prompt with strict per-resource sections:
   ```
   [System]: You are a helpful assistant. Answer based only on the provided context.
   Each context section is labeled with its resource. Cite sources by resource name and file path.
   Do not blend information across resources without explicitly attributing each claim.

   [Resource: <name-A> (id: <uuid-A>)]
   Summary (identity): ...
   Summary (architecture): ...
   --- File: src/index.ts ---
   <chunk text>
   --- File: src/routes.ts ---
   <chunk text>

   [Resource: <name-B> (id: <uuid-B>)]
   ...

   [Question]: <user question>
   ```
5. **Provider call.** Shell out to the configured provider with the assembled prompt.
6. **Return answer.** Parse the provider response and format output.

### Context Isolation

Each resource's context is wrapped in a clearly labeled section. The UUID is included in the prompt section header so the LLM cannot confuse two resources that happen to share a name. Chunks never appear without their resource label.

---

## Grounding Requirements

Answers must:

- Draw only from the provided summary blocks and retrieved chunks.
- Cite sources by resource name and file path when making specific claims.
- Acknowledge when the indexed context is insufficient to answer confidently.
- Not synthesize information that cannot be traced to the provided context.

The grounding is enforced by prompt construction, not post-processing. The system prompt instructs the LLM to cite sources and avoid unsupported claims.

---

## Output Modes

### Human-readable (default)

```
Answer:
<LLM-generated answer text, possibly multi-paragraph>

Sources:
- <resource>: <file-path> [lines N-M]
- <resource>: <file-path> [lines N-M]
```

If no chunks were retrieved (empty knowledge base), output:
```
No indexed content found for the selected resources. Run `rex sync` first.
```

### `--json`

```json
{
  "answer": "<LLM-generated answer text>",
  "sources": [
    {
      "resource": "<resource-name>",
      "path": "<relative-file-path>",
      "lines": [<start>, <end>]
    }
  ],
  "resources_queried": ["<name>", ...],
  "resources_skipped": [
    { "name": "<name>", "reason": "pending | failed" }
  ]
}
```

---

## One-Shot Mode

v1 `ask` is one-shot only:

- Each call is stateless with respect to prior calls. There is no conversational memory between invocations.
- The indexed knowledge base (chunks and summary blocks) persists across calls, but the LLM conversation context does not.
- A future REPL mode should reuse the same retrieval and grounding pipeline. It must not introduce a second architecture.

---

## Failure Modes

| Condition | Behavior |
|-----------|---------|
| No provider configured | Exit 1 with "No provider configured. Run `rex connect` first." |
| Named resource not found | Exit 2 with list of unknown names |
| Provider call fails | Exit 3 with provider error message |
| No resources indexed | Exit 4 with instructions to run `rex sync` |
| All target resources skipped (pending/failed) | Exit 4 with list of skipped resources and reasons |
