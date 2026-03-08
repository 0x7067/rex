# CLI Command Reference

**Tool name:** `rex`
**Version:** v1

---

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output machine-readable JSON instead of human-readable text |
| `--help` | Show help for any command |
| `--version` | Print version string |

All commands support `--json`. Unknown top-level commands exit with code 1 and print a suggestion.

---

## `rex connect <provider>`

Configure or select the active LLM provider.

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `provider` | Yes | Provider name: `ollama`, `claude`, or `codex` |

### Flags

| Flag | Description |
|------|-------------|
| `--model <model>` | Model name or endpoint override (provider-specific) |
| `--endpoint <url>` | Custom API endpoint (for `ollama`) |

### Behavior

- Writes provider config to the local registry.
- Validates that the provider is reachable if possible (e.g., Ollama HTTP ping).
- Does not affect any indexed resources.

### Human Output

```
Provider set: ollama (model: nomic-embed-text, endpoint: http://localhost:11434)
```

### `--json` Output

```json
{
  "provider": "ollama",
  "model": "llama3",
  "endpoint": "http://localhost:11434"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Provider configured successfully |
| 1 | Unknown provider name |
| 2 | Provider unreachable (non-fatal; config is still saved with a warning) |

---

## `rex add <source>`

Register a resource and perform initial indexing.

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `source` | Yes | Path, URL, or package identifier. Type is auto-detected. |

### Flags

| Flag | Description |
|------|-------------|
| `--name <name>` | Override the inferred resource name |
| `--type <type>` | Force resource type: `local`, `git`, `package` |
| `--include <glob>` | File glob to include (repeatable) |
| `--exclude <glob>` | File glob to exclude (repeatable) |
| `--notes <text>` | Free-text notes attached to the resource |
| `--no-index` | Register the resource without performing initial indexing |

### Behavior

1. Detect resource type from `source` (unless `--type` is given).
2. Normalize the source to a canonical form.
3. Materialize the resource to a local directory (clone for git, extract for package, resolve for local).
4. Enumerate files matching include/exclude rules.
5. Fingerprint each file.
6. Chunk, embed, and write chunks to the vector store.
7. Generate summary blocks via the configured provider.
8. Persist the resource entry and sync state to the registry.

If a resource with the same name already exists, `add` fails with exit code 2.

### Human Output

```
Added resource: my-project (local, 142 files indexed)
Summary blocks generated: identity, architecture, conventions
```

### `--json` Output

```json
{
  "name": "my-project",
  "type": "local",
  "source": "./my-project",
  "normalized_source": "/Users/user/projects/my-project",
  "files_indexed": 142,
  "chunks_written": 891,
  "summary_blocks": ["identity", "architecture", "conventions"],
  "sync_at": "2026-03-08T12:00:00Z"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Resource added and indexed successfully |
| 1 | Source not found or unresolvable |
| 2 | Resource with that name already exists |
| 3 | Indexing failed (partial index may exist) |

---

## `rex remove <name>`

Remove a resource from the local registry and delete its indexed data.

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Resource name as shown in `rex resources` |

### Flags

| Flag | Description |
|------|-------------|
| `--keep-data` | Remove from registry but keep materialized snapshot on disk |
| `--force` | Skip confirmation prompt |

### Behavior

1. Confirm deletion (unless `--force`).
2. Delete all chunks for this resource from the vector store.
3. Remove summary blocks for this resource.
4. Remove the resource entry from the registry.
5. If the resource was materialized to a managed cache dir (git clone, package extract), delete it unless `--keep-data`.

### Human Output

```
Removed resource: my-project (891 chunks deleted)
```

### `--json` Output

```json
{
  "name": "my-project",
  "chunks_deleted": 891,
  "snapshot_deleted": true
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Resource removed successfully |
| 1 | Resource not found |

---

## `rex resources`

List all saved resources with type, health, and last sync status.

### Flags

| Flag | Description |
|------|-------------|
| `--name <name>` | Show details for a single resource |

### Behavior

- Reads the registry without touching the vector store or provider.
- Shows each resource's name, type, source, chunk count, last sync time, and sync status.

### Human Output

```
NAME            TYPE     SOURCE                      CHUNKS  LAST SYNC             STATUS
my-project      local    /Users/user/projects/my     891     2026-03-08 12:00      ok
some-repo       git      https://github.com/org/r    1203    2026-03-08 11:45      ok
express         package  npm:express@4.18.2          456     2026-03-07 09:00      ok
```

### `--json` Output

```json
[
  {
    "name": "my-project",
    "type": "local",
    "source": "./my-project",
    "normalized_source": "/Users/user/projects/my-project",
    "chunks": 891,
    "last_sync": "2026-03-08T12:00:00Z",
    "sync_status": "ok",
    "notes": ""
  }
]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | List returned (even if empty) |
| 1 | Registry unreadable |

---

## `rex sync [name...]`

Refresh one or more resources. If no names are given, syncs all resources.

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `name...` | No | Resource names to sync. Defaults to all resources. |

### Flags

| Flag | Description |
|------|-------------|
| `--full` | Force full re-index even if incremental sync is possible |

### Behavior

1. For each named resource:
   a. Re-materialize the resource (pull latest for git, check mtime/hash for local, check version for package).
   b. Compare fingerprints to stored state.
   c. Re-chunk and re-embed only changed files.
   d. Regenerate summary blocks if indexed content changed materially.
   e. Update sync state in the registry.
2. Report per-resource results.

### Human Output

```
Syncing 2 resources...
  my-project: 3 files changed, 18 chunks updated (ok)
  some-repo:  no changes detected (ok)
Done.
```

### `--json` Output

```json
[
  {
    "name": "my-project",
    "files_changed": 3,
    "chunks_updated": 18,
    "status": "ok"
  },
  {
    "name": "some-repo",
    "files_changed": 0,
    "chunks_updated": 0,
    "status": "ok"
  }
]
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All resources synced successfully |
| 1 | One or more resources failed to sync (partial success reported in output) |
| 2 | No resources registered |

---

## `rex ask -q <question> [-r <name...>]`

Ask a one-shot grounded question against selected resources.

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `-q <question>` | Yes | The question to answer |
| `-r <name>` | No | Resource name to query (repeatable). Defaults to all resources. |

### Behavior

1. Resolve target resources (all if `-r` not given).
2. Load summary blocks for each target resource.
3. Perform vector retrieval from LanceDB for relevant chunks.
4. Build a grounded prompt: summary blocks + retrieved chunks + question.
5. Shell out to the configured provider with the prompt.
6. Return the answer with source references.

If a target resource has never been synced, `ask` warns but continues with any available resources.

### Human Output

```
Answer:
The main entry point is src/index.ts. It initializes the Express server and registers
routes from src/routes/.

Sources:
- my-project: src/index.ts (lines 1-45)
- my-project: src/routes/index.ts (lines 1-20)
```

### `--json` Output

```json
{
  "answer": "The main entry point is src/index.ts...",
  "sources": [
    {
      "resource": "my-project",
      "path": "src/index.ts",
      "lines": [1, 45]
    },
    {
      "resource": "my-project",
      "path": "src/routes/index.ts",
      "lines": [1, 20]
    }
  ]
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Answer returned |
| 1 | No provider configured |
| 2 | Named resource not found |
| 3 | Provider call failed |
| 4 | No resources have been indexed |
