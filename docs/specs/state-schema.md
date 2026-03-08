# State Schema

**Version:** v1

---

## Overview

rex persists two kinds of state:

1. **JSON registry** — resource metadata, provider config, and sync state. Stored at `~/.rex/registry.json`.
2. **LanceDB tables** — chunks with vector embeddings and summary blocks. Stored at `~/.rex/lance/`.

Both are owned by the user's home directory and survive across sessions. No state is stored in the current working directory.

---

## File Layout

```
~/.rex/
  registry.json          # Resource registry and provider config
  lance/                 # LanceDB data directory
    chunks/              # Main chunk table (vectors + metadata)
    summaries/           # Summary block table
  cache/
    embeddings/          # Local chunk-embedding cache, keyed by model + chunk hash
  snapshots/             # Managed materialization cache
    <resource-name>/     # Git clone or package extract per resource
```

---

## `registry.json`

Top-level structure:

```ts
{
  version: 1,
  provider: ProviderConfig | null,
  resources: Record<string, Resource>
}
```

### `ProviderConfig`

```ts
{
  name: "ollama" | "claude" | "codex",
  model: string | null,         // provider-specific model name
  endpoint: string | null       // custom endpoint (ollama only)
}
```

### `Resource`

See `docs/specs/resource-model.md` for the full field list. Serialized as-is to JSON.

Example:

```json
{
  "name": "my-project",
  "type": "local",
  "source": "./my-project",
  "normalized_source": "/Users/user/projects/my-project",
  "notes": "",
  "include_rules": [],
  "exclude_rules": [],
  "snapshot_metadata": {
    "absolute_path": "/Users/user/projects/my-project"
  },
  "last_sync_status": "ok",
  "last_sync_at": "2026-03-08T12:00:00Z",
  "chunk_count": 891,
  "index_profile": {
    "embed_model": "nomic-ai/nomic-embed-text-v1.5",
    "chunker_version": "boundary-v2",
    "index_schema_version": "2"
  }
}
```

---

## LanceDB Tables

### `chunks` table

Stores indexed file chunks with their vector embeddings and provenance metadata.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string (UUID) | Unique chunk identifier |
| `resource_id` | string (UUID) | **Stable foreign key** — the owning resource's `id`. Never the name. |
| `resource_name` | string | Denormalized name at index time. Used for display only; not the join key. |
| `file_path` | string | Relative path of the source file within the resource |
| `fingerprint` | string | SHA-256 hash of the source file at index time |
| `chunk_index` | int | Zero-based position of this chunk within the file |
| `text` | string | Raw text content of the chunk |
| `vector` | float32[768] | Embedding vector (nomic-embed-text-v1.5, 768 dims) |
| `indexed_at` | string (ISO 8601) | Timestamp when this chunk was written |

**Note:** `resource_id` is the authoritative join key. All delete, filter, and retrieval operations in the vector store use `resource_id`, not `resource_name`. This ensures correct isolation even if two resources happen to share the same name at different times.

### `summaries` table

Stores LLM-generated summary blocks per resource.

| Column | Type | Description |
|--------|------|-------------|
| `id` | string (UUID) | Unique summary block identifier |
| `resource_id` | string (UUID) | **Stable foreign key** — the owning resource's `id`. |
| `resource_name` | string | Denormalized name at generation time. Used for display only. |
| `block_type` | string | Block type: `"identity"`, `"architecture"`, `"conventions"` |
| `content` | string | LLM-generated summary text |
| `generated_at` | string (ISO 8601) | Timestamp when this block was generated |
| `based_on_fingerprints` | string[] | List of file fingerprints that were input to generation |

---

## Lifecycle Rules

### When a resource is added (`rex add`)

1. A new `Resource` record is created in `registry.json` with `last_sync_status: "pending"`.
2. The resource is materialized (cloned/extracted/resolved).
3. Files are enumerated, read once, fingerprinted, chunked, and cache-checked.
4. Chunks are written to the `chunks` table with `resource_name` set.
5. Summary blocks are generated and written to the `summaries` table.
6. `registry.json` is updated: `last_sync_status: "ok"`, `last_sync_at: <now>`, `chunk_count: <n>`, `index_profile: <current-profile>`.

### When a resource is removed (`rex remove`)

1. All rows in `chunks` where `resource_id = <id>` are deleted.
2. All rows in `summaries` where `resource_id = <id>` are deleted.
3. If the resource has a managed snapshot dir, it is deleted (unless `--keep-data`).
4. The `Resource` record is removed from `registry.json`.

### When sync succeeds (`rex sync`)

1. Changed files are detected by comparing current fingerprints to stored ones.
2. Old chunks for changed files are deleted from `chunks`.
3. New chunks for changed files are written to `chunks`, reusing cached local embeddings by `chunk_hash` when available.
4. If any chunk changed, summary blocks are regenerated and the old ones replaced.
5. `registry.json` is updated: `last_sync_status: "ok"`, `last_sync_at: <now>`, `chunk_count: <n>`, `index_profile: <current-profile>`.

### When sync partially fails (`rex sync`)

1. Successfully re-indexed files are committed.
2. Failed files are logged; their old chunks remain.
3. `registry.json` is updated: `last_sync_status: "partial"`, `last_sync_at: <now>`.

### When `rex ask` runs

- State is read-only. `ask` reads from `chunks` and `summaries` but does not write to them.
- No state changes occur during a query.

---

## Migration

The `version` field in `registry.json` supports future schema migrations. v1 tools must reject registries with `version > 1` with a clear error message prompting an upgrade.
