import type { Command } from "commander";
import { listResources } from "../core/registry.js";
import { retrieve } from "../query/retriever.js";
import { resolveTargetResources } from "../query/resolve-target.js";
import { findCallers, findCallees } from "../analysis/callgraph.js";

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Search indexed resources for relevant chunks")
    .option("-q, --query <query>", "Search query")
    .option("-r, --resource <name>", "Resource name to query (repeatable)", collect, [])
    .option("--limit <n>", "Maximum number of results", "10")
    .option("--threshold <n>", "Minimum relevance (max cosine distance, default 1.0)", "1.0")
    .option("--callers <symbol>", "Find callers of a symbol")
    .option("--callees <symbol>", "Find callees of a symbol")
    .action(
      async (options: {
        query?: string;
        resource: string[];
        limit: string;
        threshold: string;
        callers?: string;
        callees?: string;
      }) => {
        const json = (program.opts() as { json?: boolean }).json;

        let resolved;
        try {
          resolved = resolveTargetResources(process.cwd(), listResources(), options.resource, { requireMatch: true });
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(2);
        }

        const targetResources = resolved.filter(
          (r) => r.last_sync_status !== "pending" && r.last_sync_status !== "failed",
        );
        const skipped = resolved
          .filter((r) => r.last_sync_status === "pending" || r.last_sync_status === "failed")
          .map((r) => ({ name: r.name, reason: r.last_sync_status }));

        const symbol = options.callers ?? options.callees;
        const query = options.query ?? symbol;

        if (!query) {
          console.error("Either -q/--query, --callers, or --callees is required.");
          process.exit(1);
        }

        const limit = parseInt(options.limit, 10);
        const threshold = parseFloat(options.threshold);
        const resourceIds = targetResources.map((r) => r.id);

        const allChunks = await retrieve(query, resourceIds, {
          totalCap: limit,
          perResourceCap: limit,
        });
        const chunks = allChunks.filter((c) => c.score <= threshold);

        if (options.callers) {
          const hits = findCallers(options.callers, chunks);
          if (json) {
            console.log(
              JSON.stringify({
                hits,
                resources_queried: targetResources.map((r) => r.name),
                resources_skipped: skipped,
              }),
            );
          } else {
            console.log(`Callers of "${options.callers}":`);
            for (const hit of hits) {
              console.log(`  ${hit.file_path}:${hit.line}\t${hit.context}`);
            }
          }
          return;
        }

        if (options.callees) {
          const hits = findCallees(options.callees, chunks);
          if (json) {
            console.log(
              JSON.stringify({
                hits,
                resources_queried: targetResources.map((r) => r.name),
                resources_skipped: skipped,
              }),
            );
          } else {
            console.log(`Callees of "${options.callees}":`);
            for (const hit of hits) {
              console.log(`  ${hit.file_path}:${hit.line}\t${hit.context}`);
            }
          }
          return;
        }

        if (json) {
          const results = chunks.map((c) => ({
            resource: c.resource_name,
            file: c.file_path,
            lines: [c.start_line, c.end_line],
            score: c.score,
            snippet: c.text.split("\n").slice(0, 2).join("\n"),
          }));
          console.log(
            JSON.stringify({
              results,
              resources_queried: targetResources.map((r) => r.name),
              resources_skipped: skipped,
            }),
          );
        } else {
          if (chunks.length === 0) {
            console.log("No relevant results found.");
          } else {
            for (const c of chunks) {
              const lines = !isNaN(c.start_line) ? `${c.start_line}-${c.end_line}` : "?";
              const score = c.score.toFixed(2);
              console.log(`${c.resource_name}:${c.file_path}:${lines} (${score})`);
              const snippet = c.text.split("\n").slice(0, 2).join("\n").trim();
              if (snippet) {
                console.log(`  ${snippet}`);
              }
            }
          }
        }
      },
    );
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}
