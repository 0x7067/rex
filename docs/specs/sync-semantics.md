# Sync semantics

All adapters feed one local indexing pipeline. Git snapshots are keyed by a hash of the complete source URL, so repositories with the same basename do not share a clone. Existing snapshots must have the expected origin. Sync persists returned snapshot metadata, including a migrated clone path and current commit.

## Preparing and committing chunks

1. Materialize the source. A materialization failure sets the resource to `failed`.
2. Compare the stored index profile with the current embedding source, encoding, dimension, chunker and schema versions. Missing or incompatible profiles, or `--full`, require a full rebuild.
3. Read eligible files once, hashing that buffer and chunking the same text. Default exclusions protect generated output and credential-shaped files; nested `.gitignore` rules apply. Unreadable directories or indexed files fail the preparation instead of silently being treated as deleted.
4. Preserve unchanged rows, prepare changed/new rows and omit deleted files. Token counts include the document prefix, file path and automatic BOS/EOS tokens; oversized chunks are split before embedding. Embedding-cache keys include the profile and actual embedded path/text. Cached vectors must be finite and 768-dimensional.
5. Finish embedding and validating every replacement row before changing stored chunks. An embedding failure preserves the previous rows, including during a full rebuild.
6. Replace the resource's complete desired row set using a single LanceDB `mergeInsert` transaction. Its deletion predicate is scoped to that resource; other resources remain intact. An empty replacement removes the final deleted file. Rebuild the BM25 index over current rows.
7. Generate bounded project overviews from the complete surviving resource, sampling across files. An incremental change to one file does not make that file the entire project summary. Deletion-only changes also regenerate summaries. Summary fingerprints hash only the excerpts actually supplied to generation. Replace all three summary rows in one table transaction.
8. Persist successful metadata, row count, profile and timestamp. `partial` failures retain the previous successful timestamp. A subsequent sync repairs failed summaries even when source files have not changed.

`add` and `sync` share a per-resource write lock. A concurrent writer is skipped. LanceDB transactions cover each table operation; they do not atomically include chunks, summaries, the full-text index and registry JSON together. Failures after chunk commit are marked `partial`, and `ask` excludes such resources until repaired. Concurrent readers already in progress can observe a table commit; summaries remain navigation hints rather than factual evidence.

## Migration and retained data

Run `rex sync` after upgrading. The first sync rebuilds old encoding profiles automatically; another explicit `--full` is unnecessary. Queries skip incompatible profiles until the rebuild succeeds. Current LanceDB can read the previous table format and add the full-text column without deleting rows; this was verified using a table written by SDK 0.9.0.

The default GGUF URI pins a Hugging Face commit. A custom `REX_GGUF_SOURCE` should also identify immutable weights and must be compatible with Nomic's task prefixes and 768 dimensions. Replacing bytes behind the same custom path/URL is not detected by URI comparison: give changed weights a new source identity and run a full sync. Old cache namespaces and legacy snapshot directories are retained; rebuilding does not purge previously indexed sensitive material from all historical storage.
