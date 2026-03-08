# rex Stack Selection Brief

**Date:** 2026-03-08
**Status:** Draft

## Purpose

This document isolates the next major decision for the rewrite: choosing the first concrete implementation stack without changing the approved product shape.

It exists separately so that:

- the design doc stays focused on product behavior
- the implementation plan stays focused on sequencing
- stack discussions can evolve without rewriting the core spec

## Fixed Inputs

The following are already decided and should not be reopened during stack selection:

- the product is CLI-only in v1
- the product is stateful and persistent
- the product supports arbitrary resources
- MCP is removed
- REPL is out of scope for v1
- the core commands are `connect`, `add`, `remove`, `resources`, `sync`, and `ask`

## What The Stack Must Support

Any chosen stack must support these product requirements:

- a local persistent registry
- materialized snapshots or caches for arbitrary resources
- incremental sync when adapters can detect changes
- chunk indexing with provenance
- one-shot grounded query execution
- provider abstraction, so the provider does not define the product model
- machine-readable CLI output via `--json`

## Decision Areas

The first concrete stack choice should cover:

- CLI runtime
- local state format
- snapshot/cache storage format
- indexing strategy
- retrieval strategy
- provider integration boundary

## Selection Criteria

The first stack should optimize for:

1. Fast iteration
2. Low operational complexity
3. Easy local persistence
4. Good fit for arbitrary resource adapters
5. Easy testing of sync and query behavior
6. Replaceable provider layer

The first stack should not optimize for:

- perfect long-term scalability
- distributed infrastructure
- multi-user operation
- background orchestration
- UI concerns

## Recommended Selection Process

### Step 1: Choose the CLI runtime

Pick the runtime and command framework that make it easiest to implement:

- stable command parsing
- readable help output
- structured JSON output
- filesystem and process access
- testable command handlers

### Step 2: Choose the persistence model

Pick the simplest durable local format that can represent:

- resources
- snapshots
- sync metadata
- chunk maps
- summary blocks

This should favor transparency and easy migration over premature sophistication.

### Step 3: Choose the snapshot strategy

Decide how each resource type is locally materialized:

- local resources
- git resources
- package resources
- docs resources

The important requirement is consistency across resource adapters, not identical internal mechanics.

### Step 4: Choose the indexing and retrieval baseline

Pick the smallest retrieval approach that can:

- index chunks
- preserve source provenance
- answer grounded questions
- be incrementally refreshed

The first version does not need the most advanced retrieval system. It needs one that is easy to reason about and replace later.

### Step 5: Choose the provider boundary

Define the narrowest possible runtime boundary so provider changes do not force CLI or state-model rewrites.

## Constraints

The stack decision must not:

- reintroduce MCP
- turn the product back into a repo-only tool
- require a REPL to make the product usable
- make provider-specific admin APIs part of the core UX
- force background watchers or daemons into v1

## Deliverable

After the stack is chosen, the next document should be a stack-mapping plan that translates the approved product contracts into:

- module boundaries
- internal service responsibilities
- state files and cache locations
- adapter layout
- sync engine structure
- query engine structure

## Exit Condition

Stack selection is complete when:

- the chosen stack can implement the approved product contracts without adding scope
- the stack is simple enough to build incrementally
- the resulting architecture still keeps product logic separate from transport and provider details
