# Resource Model

**Version:** v1

---

## Resource Schema

A resource is a user-managed unit of knowledge. Every resource in the registry has the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID string | Yes | **Stable unique identifier.** Generated at `add` time, never changes, never reused. This is the canonical key used in all vector store rows and internal joins. |
| `name` | string | Yes | Human-readable alias. Used in CLI commands. Must be unique within the registry. Can be set with `--name`; defaults to the basename of the source. |
| `type` | `"local" \| "git" \| "package"` | Yes | Resource type. Determines which adapter handles materialization. |
| `source` | string | Yes | The raw source as provided by the user (path, URL, or package identifier). |
| `normalized_source` | string | Yes | Canonical, adapter-resolved form of the source (absolute path, full git URL, `npm:<name>@<version>`). |
| `notes` | string | No | Free-text notes the user attached at add time. Included in summary context. |
| `include_rules` | string[] | No | Glob patterns. Only matching files are indexed. If empty, all files are included (subject to default excludes). |
| `exclude_rules` | string[] | No | Glob patterns. Matching files are always skipped. Defaults applied by adapter if empty. |
| `snapshot_metadata` | object | Yes | Adapter-specific materialization state (see per-type sections below). |
| `last_sync_status` | `"ok" \| "failed" \| "partial" \| "pending"` | Yes | Result of the most recent sync attempt. `"pending"` means never synced. |
| `last_sync_at` | ISO 8601 string \| null | Yes | Timestamp of the most recent successful sync. `null` if never synced. |
| `chunk_count` | number | Yes | Number of chunks currently indexed for this resource. |
| `index_profile` | object \| null | Yes | Compatibility marker for stored chunks. Records the embed model, chunker version, and index schema version currently backing this resource. Missing or `null` means the next sync must do a full re-index. |

### Unique Identity Rules

- `id` (UUID) is the **immutable** primary key. It is generated once at `add` time and never changes even if the resource is renamed or its source moves.
- `name` is a **mutable** human alias used in CLI commands (`-r my-project`). It must be unique at any point in time, but a deleted resource's name can be reused by a later `add`.
- All rows in the vector store use `resource_id` (the UUID) as the foreign key, not `name`. This means renaming a resource (future `rex rename`) requires only a registry update, not a vector store migration.
- When displaying results to the user, `name` is always shown. `id` is only shown in `--json` output.

### v1 Resource Types

- `local` — a local filesystem path (directory or subtree)
- `git` — a remote git repository (HTTP/SSH URL, optionally branch/ref-pinned)
- `package` — an npm package, optionally version-pinned (`express`, `express@4.18.2`)

The `docs` type is deferred to a future release.

---

## Snapshot Metadata

Each type stores adapter-specific state inside `snapshot_metadata`:

### `local`

```ts
{
  absolute_path: string;       // resolved absolute path at add time
}
```

### `git`

```ts
{
  clone_path: string;          // path to the managed local clone
  remote_url: string;          // canonical remote URL
  branch: string;              // tracked branch or ref
  last_commit_sha: string;     // SHA of the HEAD commit at last sync
}
```

### `package`

```ts
{
  extract_path: string;        // path to the extracted package directory
  package_name: string;        // e.g. "express"
  resolved_version: string;    // e.g. "4.18.2"
  registry_url: string;        // resolved registry URL
}
```

---

## Resource Adapter Contract

Every resource type is handled by an adapter. Adapters implement this contract:

### `detect(source: string): boolean`

- **Input:** raw source string as typed by the user
- **Output:** `true` if this adapter can handle the source
- **Behavior:** Must be fast and non-destructive. Should not touch the network or filesystem. Pattern matching on the source string is sufficient.
- **Error behavior:** Never throws. Returns `false` on any unexpected input.

### `normalize(source: string): string`

- **Input:** raw source string
- **Output:** canonical, stable form of the source
- **Examples:** `"./my-project"` → `"/Users/user/projects/my-project"`, `"express"` → `"npm:express@4.18.2"`, `"https://github.com/org/repo"` → `"https://github.com/org/repo.git"`
- **Error behavior:** Throws a typed error if the source is invalid or cannot be resolved.

### `materialize(normalizedSource: string, targetDir: string): Promise<SnapshotMetadata>`

- **Input:** canonical source, target directory for materialization
- **Output:** populated `snapshot_metadata` for this resource
- **Behavior:** For `local`, validates the path exists and resolves it. For `git`, clones the repository to `targetDir` if not already present, or pulls latest. For `package`, downloads and extracts to `targetDir`.
- **Error behavior:** Throws a typed error if materialization fails. Must not leave a partial state in `targetDir` without marking the resource as failed.

### `enumerate(materializedDir: string, includeRules: string[], excludeRules: string[]): AsyncIterable<FileEntry>`

- **Input:** absolute path to the materialized directory, include/exclude glob rules
- **Output:** async iterable of `FileEntry` objects
- **FileEntry shape:** `{ absolutePath: string; relativePath: string; sizeBytes: number }`
- **Behavior:** Walks the directory and yields one entry per file that matches include rules and does not match exclude rules. Default excludes (applied when `excludeRules` is empty): `.git/`, `node_modules/`, `dist/`, `*.lock`, binary files.
- **Error behavior:** Skips unreadable files and logs a warning. Does not throw.

### `fingerprint(entry: FileEntry): Promise<string>`

- **Input:** a `FileEntry` from `enumerate`
- **Output:** a stable string fingerprint for the file's current content
- **Behavior:** For `local` and materialized dirs: `sha256(content)`. For git resources, the git object hash is preferred when available. The fingerprint must change if and only if the file content changes.
- **Error behavior:** Throws if the file cannot be read.

### `reference(entry: FileEntry, resource: Resource): string`

- **Input:** a `FileEntry` and the owning `Resource`
- **Output:** a human-readable citation string for the file
- **Examples:** `"my-project: src/index.ts"`, `"some-repo (github.com/org/repo): lib/core.ts"`, `"express@4.18.2: lib/express.js"`
- **Behavior:** Purely synchronous string construction. No I/O.

---

## Shared Indexing Pattern

Git and package resources materialize into local directories. After materialization, all three types use the same indexing pipeline:

```
[local adapter]   → (already on disk) → shared indexer → LanceDB
[git adapter]     → clone/pull         → shared indexer → LanceDB
[package adapter] → download/extract   → shared indexer → LanceDB
```

The adapter is responsible for `detect`, `normalize`, and `materialize`. The shared indexing pipeline handles read-once file preparation, fingerprinting, chunking, embedding-cache reuse, embedding, and storage.

This means the indexer is adapter-agnostic: it receives a local directory and operates identically for all resource types.
