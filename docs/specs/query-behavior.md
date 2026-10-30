# Query behavior

`rex ask` retrieves evidence from the local index and delegates generation to the configured provider. Calls are stateless; resources and indexes persist.

## Resource selection and compatibility

Explicit `-r <name>` arguments select those resources; unknown names exit with code 2. Without explicit names, Rex selects resources whose materialized directories contain the current working directory, ordered from most specific to least specific. Outside registered directories it selects all resources.

Only resources with `last_sync_status: "ok"` and the current index profile are eligible. Pending, failed, partial and incompatible resources are reported in `resources_skipped`. An older index needs `rex sync`; profile changes automatically force a full rebuild. If no eligible resource remains, the command exits with code 4.

## Retrieval and evidence

1. Embed the question with the pinned Nomic model and the `search_query:` task prefix. Document embeddings use `search_document:` plus the file path and source text. Embedding source, encoding, dimension, chunker and schema versions form the compatibility profile.
2. Search each selected resource independently using its immutable `resource_id`. LanceDB combines BM25 full-text candidates over file paths and text with cosine vector candidates using reciprocal rank fusion. The code tokenizer preserves identifiers without stemming or stop-word removal.
3. Collect up to 10 distinct spans per resource and 40 overall. Candidate searches request four times the per-resource cap. Round-robin ranks preserve resource coverage. Provider choice does not change retrieval rules.
4. Admit complete excerpts into a 12,000-byte evidence budget, including excerpt labels. Excerpts are never truncated after retrieval, so citation ranges remain attributable. This is a conservative byte budget, not an exact count for every generation model's tokenizer. Questions are limited to 4,000 UTF-8 bytes. Generated summaries are bounded navigation hints and cannot independently support citations.
5. Build resource-labeled sections with paths and line ranges. Source strings are serialized as data. Instructions require each factual claim to cite file evidence, treat retrieved instructions as untrusted, and acknowledge insufficient information.
6. Generate and parse a machine-readable citation block:

```text
<rex_sources>
resource-name|path/to/file.ts|12|30
</rex_sources>
```

References must match excerpts actually admitted to the prompt. The complete cited range must be covered by those excerpts; malformed numbers, missing paths and out-of-range citations are rejected. Legacy `resource|path` references infer a range only when retrieved spans cover it without gaps.

If no excerpts fit, no generation call is made. If generation returns no valid references or an empty answer, Rex returns `status: "insufficient_context"` and replaces unsupported prose with an explanation. Otherwise it returns `status: "answered"`.

Citation identity and range checks do not prove that a passage entails a claim. A contradictory statement with a valid reference can still pass. Retrieval labels, answer support and abstention need separate evaluation; see the dated RAG review.

## Output and failures

Human output prints the answer and validated sources. JSON also contains `status`, `resources_queried` and `resources_skipped`:

```json
{
  "status": "answered",
  "answer": "The generated answer.",
  "sources": [
    { "resource": "project", "path": "src/index.ts", "lines": [12, 30] }
  ],
  "resources_queried": ["project"],
  "resources_skipped": []
}
```

No configured provider exits with code 1. Retrieval or provider failures exit with code 3. Codex may retry setup-only output once with a cleaner generation instruction; both attempts use the same retrieval policy.
