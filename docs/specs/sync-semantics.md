# Sync Semantics

**Version:** v1

---

## Overview

Sync is the process of bringing the local index up to date with the current state of a resource. It is incremental by default and falls back to a full re-index only when necessary.

If a resource currently has an active `add` lock, `sync` skips it instead of attempting to index it concurrently.

---

## Initial Indexing (during `rex add`)

When a resource is first added:

1. The resource is materialized (see resource model for adapter specifics).
2. All files are enumerated according to include/exclude rules.
3. Every file is read once, fingerprinted from that same buffer, and chunked.
4. Only uncached chunks are embedded; cached chunk hashes reuse their stored local embedding.
5. All chunks are written to the vector store.
6. Summary blocks are generated from the full indexed content.
7. The resource's `index_profile` is persisted in registry sync state.

Initial indexing is always a full index. There is no prior state to diff against.

---

## Incremental Sync

On subsequent `rex sync` calls:

1. Re-materialize the resource to pick up upstream changes.
   - **local:** No-op (files are already on disk). Mtime is used as a quick pre-filter before hashing.
   - **git:** Run `git pull` (or `git fetch + reset`) on the managed clone.
   - **package:** Compare current resolved version to stored version.
2. Enumerate all files under the current include/exclude rules.
3. For each file, read it once, compute its fingerprint, and derive chunk hashes from the same content.
4. Diff fingerprints against the stored state:
   - **unchanged:** Skip. Old chunks remain. Do not re-embed.
   - **changed:** Delete old chunks for this file, re-chunk the new content, reuse cached chunk embeddings where possible, and embed only cache misses.
   - **new:** Chunk, reuse any cached embeddings, and write new chunks.
   - **deleted:** Delete all chunks whose `file_path` matched this file.
5. If any file changed, regenerate summary blocks.
6. Update sync state.

### Change Detection by Adapter

| Adapter | Primary signal | Fallback |
|---------|---------------|---------|
| `local` | SHA-256 of file content | mtime pre-filter |
| `git` | git commit SHA (HEAD) | per-file git object hash |
| `package` | resolved version string | full re-index if version differs |

---

## Full Re-index Fallback

A full re-index replaces all existing chunks for a resource with freshly computed ones. It is triggered when:

- `rex sync --full` is passed explicitly.
- The adapter cannot provide incremental change detection (e.g., version string changed for a package).
- The stored fingerprint map is missing or corrupt.
- The LanceDB chunks table has inconsistent row counts for the resource.
- The stored `index_profile` is missing or no longer matches the current embed model, chunker version, or index schema version.

Full re-index procedure:

1. Delete all chunks for the resource from the vector store.
2. Delete all summary blocks for the resource.
3. Re-run the complete initial indexing procedure.

---

## Handling Missing or Deleted Content

- **File deleted upstream:** All chunks whose `file_path` maps to the deleted file are removed from the vector store.
- **Resource source gone (e.g., git repo deleted):** `sync` fails with a clear error and sets `last_sync_status: "failed"`. Existing indexed data is preserved until the user explicitly removes the resource.
- **Managed snapshot dir missing:** Treated as a materialization failure. `sync` re-materializes and falls back to full re-index.

---

## Provenance Preservation

Every chunk stores:
- `resource_name`: which resource it belongs to
- `file_path`: relative path within the resource
- `fingerprint`: content hash of the source file when the chunk was written
- `indexed_at`: when the chunk was last written

These fields are never stripped or overwritten except during an explicit re-index of that chunk's file.

**Invariant:** After sync, every chunk in the store must have a `fingerprint` that matches the current on-disk state of its source file, or the file must have been explicitly detected as unchanged (in which case the stored fingerprint is still valid).

---

## Summary Block Refresh

Summary blocks are regenerated when the sync detects that any file changed. The threshold is intentionally low:

- Any file fingerprint change triggers summary block regeneration.
- Summary blocks for a resource are always regenerated together (not per-file).
- Stale summary blocks are deleted before new ones are written, so the store never holds both old and new simultaneously.

---

## Invariants

1. **Provenance is always preserved.** Every chunk can be traced back to its source file and resource.
2. **Incremental sync does not drop unchanged content.** Only files with changed fingerprints are re-indexed.
3. **Full re-index is always safe.** It produces the same logical result as repeated incremental syncs.
4. **No silent data loss.** If sync fails mid-run, `last_sync_status` is set to `"partial"` or `"failed"`, never `"ok"`.
5. **Summary blocks reflect indexed content.** Summary blocks are always regenerated after any file change, so they never describe a resource state that no longer exists in the chunk store.
6. **Include/exclude rule changes require a full re-index.** If include or exclude rules are modified (future `rex edit` command), `sync` must perform a full re-index to remove chunks for newly excluded files.
