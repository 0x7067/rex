import path from "node:path";
import fs from "node:fs";
import type { Command } from "commander";
import ora from "ora";
import { localAdapter } from "../adapters/local.js";
import { gitAdapter } from "../adapters/git.js";
import { packageAdapter } from "../adapters/package.js";
import type { ResourceAdapter } from "../adapters/adapter.js";
import { indexResourceFiles } from "../indexing/pipeline.js";
import { generateSummaries } from "../query/answerer.js";
import { acquireResourceAddLock, releaseResourceAddLock } from "../core/locks.js";
import { addResource, getProvider, updateResource } from "../core/registry.js";
import { createResource } from "../core/resource.js";
import { snapshotsDir } from "../core/config.js";

const ADAPTERS: ResourceAdapter[] = [localAdapter, gitAdapter, packageAdapter];

function detectAdapter(source: string): ResourceAdapter {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(source)) return adapter;
  }
  throw new Error(`Cannot detect resource type for: ${source}`);
}

function inferName(source: string): string {
  const cleaned = source.replace(/\.git$/, "").replace(/^npm:/, "");
  const base = path.basename(cleaned).split("@")[0] ?? cleaned;
  return base || "resource";
}

export function registerAdd(program: Command): void {
  program
    .command("add <source>")
    .description("Register and index a resource")
    .option("--name <name>", "Override the inferred resource name")
    .option(
      "--type <type>",
      "Force resource type: local, git, package",
    )
    .option("--include <glob>", "Include glob (repeatable)", collect, [])
    .option("--exclude <glob>", "Exclude glob (repeatable)", collect, [])
    .option("--notes <text>", "Notes to attach to the resource")
    .option("--no-index", "Register without indexing")
    .action(
      async (
        source: string,
        options: {
          name?: string;
          type?: string;
          include: string[];
          exclude: string[];
          notes?: string;
          index: boolean;
        },
      ) => {
        const json = (program.opts() as { json?: boolean }).json;

        // Resolve bare names (e.g. "my-repo") to absolute paths before detection
        // so the local adapter recognises them regardless of CWD depth.
        if (
          !path.isAbsolute(source) &&
          !source.startsWith("./") &&
          !source.startsWith("../") &&
          !source.startsWith("npm:") &&
          !source.startsWith("http") &&
          !source.startsWith("git@")
        ) {
          const abs = path.resolve(source);
          if (fs.existsSync(abs)) {
            source = abs;
          }
        }

        let adapter: ResourceAdapter;
        if (options.type) {
          const found = ADAPTERS.find((a) => a.type === options.type);
          if (!found) {
            console.error(
              `Unknown type: "${options.type}". Valid: local, git, package`,
            );
            process.exit(1);
          }
          adapter = found;
        } else {
          try {
            adapter = detectAdapter(source);
          } catch {
            console.error(`Cannot detect resource type for: "${source}"`);
            process.exit(1);
          }
        }

        let normalizedSource: string;
        try {
          normalizedSource = await adapter.normalize(source);
        } catch (err) {
          console.error(
            `Cannot resolve source: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }

        const name = options.name ?? inferName(source);

        const spinner = json ? null : ora(`Materializing ${name}...`).start();

        let snapshotMetadata;
        try {
          snapshotMetadata = await adapter.materialize(
            normalizedSource,
            snapshotsDir(),
          );
        } catch (err) {
          spinner?.fail(`Materialization failed: ${err instanceof Error ? err.message : String(err)}`);
          if (!spinner) {
            console.error(
              `Materialization failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          process.exit(1);
        }

        const resource = createResource({
          name,
          type: adapter.type,
          source,
          normalized_source: normalizedSource,
          notes: options.notes ?? "",
          include_rules: options.include,
          exclude_rules: options.exclude,
          snapshot_metadata: snapshotMetadata,
        });

        try {
          addResource(resource);
        } catch (err) {
          spinner?.fail(`Failed to register: ${err instanceof Error ? err.message : String(err)}`);
          if (!spinner) {
            console.error(
              `Failed to register: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          process.exit(2);
        }

        if (!options.index) {
          spinner?.succeed(`Registered resource: ${name} (not indexed)`);
          if (json) {
            console.log(JSON.stringify({ name, type: adapter.type, status: "registered" }));
          }
          return;
        }

        if (!acquireResourceAddLock(resource.id)) {
          spinner?.fail(`Add already in progress for "${name}"`);
          if (!spinner) {
            console.error(`Add already in progress for "${name}"`);
          }
          process.exit(1);
        }

        try {
          const providerConfig = getProvider();
          if (!providerConfig) {
            spinner?.fail("No provider configured. Run `rex connect` first.");
            if (!spinner) {
              console.error(
                "No provider configured. Run `rex connect` first. Resource was registered but not indexed.",
              );
            }
            process.exitCode = 1;
            return;
          }

          const materializedDir = getMaterializedDir(snapshotMetadata);
          const indexResult = await indexResourceFiles({
            resource,
            materializedDir,
            includeRules: options.include,
            excludeRules: options.exclude,
            fullSync: true,
            onProgress: (msg) => {
              if (spinner) spinner.text = msg;
            },
          });

          const allChunkTexts = indexResult.changedChunkTexts;
          const summaryBlocks: string[] = [];
          if (allChunkTexts.length > 0) {
            const summaryTypes = ["identity", "architecture", "conventions"];
            let summaryIdx = 0;
            await generateSummaries(resource, allChunkTexts, providerConfig, (msg) => {
              summaryIdx++;
              spinner && (spinner.text = `Generating summaries (${summaryIdx}/${summaryTypes.length}): ${msg}`);
            });
            summaryBlocks.push(...summaryTypes);
          }

          updateResource({
            ...resource,
            last_sync_status: "ok",
            last_sync_at: new Date().toISOString(),
            chunk_count: indexResult.chunksUpdated,
            index_profile: indexResult.indexProfile,
          });

          if (json) {
            spinner?.stop();
            console.log(
              JSON.stringify({
                name,
                type: adapter.type,
                source,
                normalized_source: normalizedSource,
                files_indexed: indexResult.filesScanned,
                chunks_written: indexResult.chunksUpdated,
                summary_blocks: summaryBlocks,
                sync_at: new Date().toISOString(),
              }),
            );
          } else {
            spinner?.succeed(
              `Added ${name} (${adapter.type}): ${indexResult.filesScanned} files, ${indexResult.chunksUpdated} chunks${summaryBlocks.length > 0 ? `, summaries: ${summaryBlocks.join(", ")}` : ""}`,
            );
          }
        } catch (err) {
          spinner?.fail(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`);
          if (!spinner) {
            console.error(
              `Indexing failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          process.exitCode = 1;
        } finally {
          releaseResourceAddLock(resource.id);
        }
      },
    );
}

function getMaterializedDir(meta: { type: string; absolute_path?: string; clone_path?: string; extract_path?: string }): string {
  if (meta.type === "local" && meta.absolute_path) return meta.absolute_path;
  if (meta.type === "git" && meta.clone_path) return meta.clone_path;
  if (meta.type === "package" && meta.extract_path) return meta.extract_path;
  throw new Error(`Cannot determine materialized dir for type: ${meta.type}`);
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}
