# Design: rex

**Date:** 2026-03-08
**Branch:** main
**Status:** Approved

## Context

The current application is centered on persistent repository memory, but the surface area has grown around that core. It includes MCP transport, provider admin tooling, watcher and daemon flows, and several operational commands that are helpful but not fundamental to the product idea.

The rewrite direction is:

- keep the main idea
- drop MCP entirely
- make the product CLI-only
- keep persistence across sessions
- expand from repo-only memory to arbitrary resources
- avoid assuming any implementation stack yet

BTCA is useful inspiration for CLI shape and docs style, but the rewrite should preserve the differentiator of this app: persistent knowledge that is refreshed over time instead of reloaded from scratch on every question.

## Goal

Define a smaller, cleaner product core for a future rewrite: a persistent CLI that indexes arbitrary resources into a local knowledge registry and answers one-shot questions against that saved knowledge base.

## Product Definition

`rex` is a resource-first knowledge CLI.

Users add resources, the CLI normalizes and indexes them, and later ask questions against one or more named resources. The system persists local state so it can incrementally sync changes instead of rebuilding everything every time.

The first rewrite does not include:

- MCP
- REPL or TUI
- background daemons
- provider admin/debug surfaces as core product features

## Core Product Loop

The core loop has four stages:

1. Connect a provider profile.
2. Add one or more resources.
3. Sync and maintain indexed knowledge for those resources.
4. Ask one-shot questions against selected resources.

Everything else is optional or future-facing.

## CLI Surface

### Required v1 Commands

- `tool connect`
  - Configure or select the default model/provider profile.
- `tool add <source>`
  - Register a resource and perform initial indexing.
- `tool remove <name>`
  - Remove a resource from the local registry and optionally delete indexed data.
- `tool resources`
  - List saved resources, type, health, and last sync status.
- `tool sync [name...]`
  - Refresh one or more resources.
- `tool ask -q <question> [-r <name...>]`
  - Ask a grounded one-shot question against chosen resources.

### Required v1 Behavior

- If `ask` is called without `-r`, it should query all saved resources.
- `add` should auto-detect resource type when possible.
- `add` should perform initial indexing by default.
- All commands should support `--json`.
- Unknown top-level commands should fail with a non-zero exit and a suggestion.

### Useful but Non-Core Later Commands

- `tool init`
- `tool doctor`
- `tool export`
- `tool watch`
- `tool repl`

These are intentionally outside the minimal rewrite core.

## Domain Model

### Resource

A user-managed unit of knowledge.

Required fields:

- `name`
- `type`
- `source`
- `normalized_source`
- `notes`
- `include_rules`
- `exclude_rules`

### Snapshot

A locally materialized version of the resource used for extraction and syncing.

Examples:

- a checked out git repository
- a resolved local folder
- downloaded package contents or metadata
- fetched documentation pages

### Chunk

A normalized indexed unit of content with provenance metadata.

Required metadata:

- resource name
- source path or origin URL
- revision or fingerprint
- chunk id

### Summary Blocks

Small persistent summaries that speed up grounding before retrieval.

Recommended default blocks:

- `identity`
- `architecture`
- `conventions`

### Registry

The local persistent record of every saved resource and its sync state.

## Resource Types

The rewrite should support arbitrary resources through adapters, not through one-off command logic.

### Local

Examples:

- local folder
- local documentation directory
- local project subtree

### Git

Examples:

- remote git repository
- hosted git URL
- branch- or ref-pinned source

### Package

Examples:

- package name
- package name plus version
- package registry URL

### Docs

Examples:

- documentation home page
- docs index page
- documentation manifest such as `llms.txt`

## Resource Adapter Contract

The important abstraction is `resource adapter`, not `repo agent`.

Each adapter should support the same contract:

- `detect`
- `normalize`
- `materialize`
- `enumerate`
- `fingerprint`
- `reference`

This keeps the CLI surface simple while allowing different source types behind the scenes.

## Persistence Model

The rewrite must remain stateful.

The persistent local state should track:

- configured provider/profile
- resource registry
- snapshot metadata
- last synced revision or fingerprint
- chunk map
- summary blocks
- health and error status

The key product property is that a question asked tomorrow should benefit from knowledge indexed today.

## Sync Model

Sync should be incremental whenever the adapter can provide stable change detection.

Required behavior:

- detect whether content changed
- re-index only affected content when possible
- fall back to full re-index when incremental diff is not trustworthy
- preserve provenance for citations and debugging
- refresh summary blocks when indexed content materially changes

## Ask Model

`ask` should be resource-scoped retrieval plus answer generation.

Recommended sequence:

1. Resolve target resources.
2. Read summary blocks first.
3. Retrieve relevant chunks from indexed content.
4. Generate a grounded answer.
5. Return answer plus references to source files, URLs, or resource paths.

`ask` is one-shot only in v1. A future REPL should reuse the same registry, sync engine, and query engine rather than introducing a second architecture.

## Output Principles

The CLI should optimize for clarity over verbosity.

Recommended output modes:

- default human-readable output
- `--json` machine-readable output
- compact clean mode for sub-agent usage later

Answers should prefer grounded references over unsupported synthesis.

## Non-Goals

The v1 rewrite should explicitly avoid:

- MCP compatibility
- interactive chat mode
- workspace-specific UI concerns
- background daemon infrastructure as a requirement
- cross-resource orchestration as a first-class feature
- provider-specific admin/debug capabilities in the main UX

## Architecture Shape

At a high level, the rewrite should separate:

- CLI command layer
- registry/state layer
- resource adapter layer
- indexing and sync layer
- retrieval and answer layer
- provider layer

This mirrors the strongest part of the current codebase: the core product logic is small when separated from transport and operations.

## Why This Is The Right Core

This design preserves what is actually distinctive about the current application:

- persistent knowledge instead of stateless querying
- incremental maintenance instead of repeated full scans
- grounded answers over saved resources

At the same time, it removes most of the accidental complexity:

- no MCP transport
- no CLI commands whose main job is maintaining MCP config
- no repo-only mental model
- no requirement to choose a stack before defining the product contract

## Future Extensions

The following should remain easy to add later without changing the product core:

- REPL or TUI
- background watch mode
- export/report commands
- richer resource types
- team/shared registries
- secondary transports on top of the same engine
