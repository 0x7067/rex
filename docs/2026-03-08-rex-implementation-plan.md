# rex Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the approved `rex` direction into stack-agnostic product contracts that are ready to map onto a concrete implementation once a runtime and storage stack are chosen.

**Architecture:** This plan is intentionally contract-first. It avoids assuming a language, framework, database, or vector store, and instead locks down the command surface, resource model, state model, sync semantics, and query behavior that any later implementation must satisfy.

**Tech Stack:** Intentionally unspecified. This plan must remain valid before any runtime, storage, indexing, or provider technology is selected.

---

> **Important:** Because the stack is not chosen yet, this is a pre-implementation plan. The output of these tasks is a stable contract set that future implementation work can map onto concrete modules and code paths.

---

### Task 1: Freeze the v1 command contract

**Files:**
- Create: `docs/specs/cli-command-reference.md`
- Modify: `docs/2026-03-08-rex-design.md`
- Test: `docs/specs/cli-command-reference.md`

**Step 1: Write the command reference draft**

Document the exact v1 commands:

- `connect`
- `add`
- `remove`
- `resources`
- `sync`
- `ask`

For each command, define:

- positional arguments
- required flags
- optional flags
- human-readable output behavior
- `--json` output behavior
- failure cases and exit expectations

**Step 2: Review it against the design doc**

Check that every required command in the design doc appears once and only once, with no extra product surface sneaking in.

Expected result: the command reference matches the approved design and does not include MCP, REPL, watch, export, or daemon commands as v1 requirements.

**Step 3: Update the design doc if command wording drifted**

Only make minimal wording changes needed to keep the design and command reference aligned.

**Step 4: Commit**

```bash
git add docs/specs/cli-command-reference.md docs/2026-03-08-rex-design.md
git commit -m "docs: define rex CLI command contract"
```

---

### Task 2: Freeze the resource model contract

**Files:**
- Create: `docs/specs/resource-model.md`
- Modify: `docs/2026-03-08-rex-design.md`
- Test: `docs/specs/resource-model.md`

**Step 1: Define the canonical resource schema**

Document the required resource fields:

- `name`
- `type`
- `source`
- `normalized_source`
- `notes`
- `include_rules`
- `exclude_rules`
- `snapshot_metadata`
- `last_sync_status`

Also define the supported v1 resource types:

- `local`
- `git`
- `package`
- `docs`

**Step 2: Define the resource adapter contract**

Document the required adapter operations:

- `detect`
- `normalize`
- `materialize`
- `enumerate`
- `fingerprint`
- `reference`

Each operation should describe inputs, outputs, and error behavior in plain language.

**Step 3: Validate against the design doc**

Check that the schema supports arbitrary resources without reintroducing repo-only assumptions.

Expected result: the resource contract remains generic and reusable.

**Step 4: Commit**

```bash
git add docs/specs/resource-model.md docs/2026-03-08-rex-design.md
git commit -m "docs: define resource model and adapter contract"
```

---

### Task 3: Freeze the persistent state contract

**Files:**
- Create: `docs/specs/state-schema.md`
- Test: `docs/specs/state-schema.md`

**Step 1: Define the local registry schema**

Document the local persistent structures for:

- provider/profile selection
- saved resources
- snapshot metadata
- last synced revision or fingerprint
- chunk map
- summary blocks
- health and error status

**Step 2: Define lifecycle rules**

Specify what changes when:

- a resource is added
- a resource is removed
- sync succeeds
- sync partially fails
- ask runs successfully

Expected result: a future implementation can persist state consistently without inferring hidden rules.

**Step 3: Commit**

```bash
git add docs/specs/state-schema.md
git commit -m "docs: define persistent registry and sync state schema"
```

---

### Task 4: Freeze sync semantics

**Files:**
- Create: `docs/specs/sync-semantics.md`
- Test: `docs/specs/sync-semantics.md`

**Step 1: Define the sync contract**

Document the exact expected behavior for:

- initial indexing during `add`
- incremental sync
- full sync fallback
- missing content
- deleted content
- changed content
- adapter-specific revision detection

**Step 2: Define invariants**

Write explicit invariants such as:

- sync must preserve source provenance
- incremental sync must not silently drop unchanged content
- full re-index is allowed when change detection is weak
- summary blocks should refresh when content materially changes

**Step 3: Commit**

```bash
git add docs/specs/sync-semantics.md
git commit -m "docs: define sync and reindex semantics"
```

---

### Task 5: Freeze query and answer semantics

**Files:**
- Create: `docs/specs/query-behavior.md`
- Test: `docs/specs/query-behavior.md`

**Step 1: Define `ask` resolution rules**

Document:

- how resources are selected when `-r` is passed
- how resources are selected when no resource is passed
- how failures in some resources affect multi-resource asks
- how one-shot mode differs from future REPL mode

**Step 2: Define grounding requirements**

Specify that answers should:

- consult summary blocks first
- retrieve supporting chunks
- return references to source files, paths, or URLs when possible
- avoid unsupported claims

**Step 3: Define output modes**

Document:

- default human-readable answer shape
- `--json` answer shape
- compact clean output reserved for later sub-agent use

**Step 4: Commit**

```bash
git add docs/specs/query-behavior.md
git commit -m "docs: define one-shot query and answer behavior"
```

---

### Task 6: Freeze provider boundary requirements

**Files:**
- Create: `docs/specs/provider-boundary.md`
- Test: `docs/specs/provider-boundary.md`

**Step 1: Define the provider-neutral interface**

Document the minimal provider responsibilities:

- index or store chunks
- retrieve relevant chunks
- generate answers
- maintain summary blocks if applicable

Do not include provider-specific admin features in the required boundary.

**Step 2: Define replaceability rules**

Document that provider selection must not change:

- CLI command semantics
- resource model
- registry schema
- sync behavior
- answer format guarantees

**Step 3: Commit**

```bash
git add docs/specs/provider-boundary.md
git commit -m "docs: define provider-neutral runtime boundary"
```

---

### Task 7: Choose the first concrete stack and map contracts to code

**Files:**
- Create: `docs/plans/YYYY-MM-DD-rex-stack-mapping.md`
- Modify: `docs/specs/cli-command-reference.md`
- Modify: `docs/specs/resource-model.md`
- Modify: `docs/specs/state-schema.md`
- Modify: `docs/specs/sync-semantics.md`
- Modify: `docs/specs/query-behavior.md`
- Modify: `docs/specs/provider-boundary.md`
- Test: `docs/plans/YYYY-MM-DD-rex-stack-mapping.md`

**Step 1: Select a concrete stack**

Choose:

- CLI runtime
- local state format
- snapshot/cache format
- indexing strategy
- retrieval strategy
- provider integration strategy

**Step 2: Map contracts to code structure**

Define the exact code modules and file layout that will implement:

- CLI command layer
- registry/state layer
- adapter layer
- sync engine
- query engine
- provider layer

**Step 3: Verify no contract breaks**

Check that the selected stack still satisfies all previously frozen product contracts without expanding v1 scope.

**Step 4: Commit**

```bash
git add docs/specs docs/plans/YYYY-MM-DD-rex-stack-mapping.md
git commit -m "docs: map rex contracts to chosen stack"
```

---

### Task 8: Write the actual code implementation plan after stack selection

**Files:**
- Create: `docs/plans/YYYY-MM-DD-rex-build-plan.md`
- Test: `docs/plans/YYYY-MM-DD-rex-build-plan.md`

**Step 1: Translate contracts into code tasks**

Break the chosen implementation into bite-sized build tasks with:

- exact source files
- exact test files
- exact commands
- expected red/green flow

**Step 2: Ensure TDD granularity**

Each task should be small enough to execute safely:

- failing test
- run test red
- minimal implementation
- run test green
- commit

**Step 3: Commit**

```bash
git add docs/plans/YYYY-MM-DD-rex-build-plan.md
git commit -m "docs: write build plan for rex"
```
