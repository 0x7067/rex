import fs from "node:fs";
import type { Command } from "commander";
import { listResources, updateResource } from "../core/registry.js";
import { resolveTargetResources, getMaterializedDir } from "../query/resolve-target.js";
import { indexResourceFiles } from "../indexing/pipeline.js";
import { countChunks } from "../indexing/store.js";
import { createDebouncedBatch } from "../watch/debounce.js";
import { categorizeChange } from "../watch/change-set.js";

export function registerWatch(program: Command): void {
  program
    .command("watch")
    .description("Watch local resources and re-index on file changes")
    .argument("[names...]", "Resource names to watch (default: CWD-detected or all local)")
    .option("--debounce <ms>", "Debounce interval in milliseconds", "500")
    .action(async (names: string[], options: { debounce: string }) => {
      const debounceMs = parseInt(options.debounce, 10);
      const allResources = listResources();

      let resolved;
      try {
        resolved = resolveTargetResources(process.cwd(), allResources, names);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
      }

      const localResources = resolved.filter((r) => r.type === "local");
      const nonLocal = resolved.filter((r) => r.type !== "local");

      for (const r of nonLocal) {
        console.warn(`Skipping "${r.name}": only local resources can be watched.`);
      }

      if (localResources.length === 0) {
        console.error("No local resources to watch.");
        process.exit(1);
      }

      const watchers: fs.FSWatcher[] = [];

      for (const resource of localResources) {
        const rootDir = getMaterializedDir(resource);
        const batch = createDebouncedBatch<string>((f) => f);
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;

        const flush = async (): Promise<void> => {
          const files = batch.flush();
          if (files.length === 0) return;

          try {
            const result = await indexResourceFiles({
              resource,
              materializedDir: rootDir,
              includeRules: resource.include_rules,
              excludeRules: resource.exclude_rules,
              fullSync: false,
            });

            const chunkCount = await countChunks(resource.id);
            updateResource({ ...resource, chunk_count: chunkCount });

            const now = new Date().toLocaleTimeString("en-US", { hour12: false });
            console.log(
              `[${now}] ${files.length} file${files.length !== 1 ? "s" : ""} changed in ${resource.name}, re-indexed (${result.chunksUpdated} chunks updated)`,
            );
          } catch (err) {
            console.error(
              `Error re-indexing ${resource.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        };

        const watcher = fs.watch(
          rootDir,
          { recursive: true },
          (_eventType, filename) => {
            if (!filename) return;
            const change = categorizeChange(_eventType ?? "change", filename, rootDir, resource.exclude_rules);
            if (!change) return;

            batch.add(change.relativePath);
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              void flush();
            }, debounceMs);
          },
        );

        watchers.push(watcher);
        console.log(`Watching ${resource.name} at ${rootDir}`);
      }

      process.on("SIGINT", () => {
        console.log("\nStopping watchers...");
        for (const w of watchers) {
          w.close();
        }
        process.exit(0);
      });
    });
}
