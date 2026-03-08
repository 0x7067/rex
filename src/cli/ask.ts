import type { Command } from "commander";
import ora, { type Ora } from "ora";
import { getProvider, listResources, getResourceByName } from "../core/registry.js";
import { getSummaries } from "../indexing/store.js";
import { retrieve } from "../query/retriever.js";
import { generateAnswer } from "../query/answerer.js";
import type { Resource } from "../core/resource.js";
import { RetryableProviderError } from "../provider/interface.js";

const FAST_CODEX_RETRIEVE_OPTIONS = {
  perResourceCap: 4,
  totalCap: 12,
  collapseByFile: true,
  pathBias: "codex-fast" as const,
};

const CLEAN_CODEX_RETRIEVE_OPTIONS = {
  perResourceCap: 10,
  totalCap: 40,
};

export function registerAsk(program: Command): void {
  program
    .command("ask")
    .description("Ask a one-shot question against indexed resources")
    .argument("<question>", "The question to answer")
    .option("-r, --resource <name>", "Resource name to query (repeatable)", collect, [])
    .action(
      async (question: string, options: { resource: string[] }) => {
        const json = (program.opts() as { json?: boolean }).json;

        const providerConfig = getProvider();
        if (!providerConfig) {
          console.error(
            "No provider configured. Run `rex connect` first.",
          );
          process.exit(1);
        }

        // Resolve resources
        const targetResources: Resource[] = [];
        const skipped: Array<{ name: string; reason: string }> = [];

        if (options.resource.length > 0) {
          for (const name of options.resource) {
            let r: Resource;
            try {
              r = getResourceByName(name);
            } catch {
              console.error(`Resource "${name}" not found.`);
              process.exit(2);
            }
            if (r.last_sync_status === "pending") {
              console.warn(`Warning: resource "${name}" has never been synced.`);
              skipped.push({ name, reason: "pending" });
            } else if (r.last_sync_status === "failed") {
              console.warn(`Warning: resource "${name}" last sync failed.`);
              skipped.push({ name, reason: "failed" });
            } else {
              targetResources.push(r);
            }
          }
        } else {
          const all = listResources();
          for (const r of all) {
            if (r.last_sync_status === "pending" || r.last_sync_status === "failed") {
              skipped.push({ name: r.name, reason: r.last_sync_status });
            } else {
              targetResources.push(r);
            }
          }
        }

        if (targetResources.length === 0) {
          const msg = "No indexed resources available. Run `rex sync` first.";
          if (json) {
            console.log(JSON.stringify({ error: msg, resources_skipped: skipped }));
          } else {
            console.error(msg);
          }
          process.exit(4);
        }

        const resourceIds = targetResources.map((r) => r.id);

        const spinner = json ? null : ora("Retrieving context...").start();

        try {
          const summaries = await getSummaries(resourceIds);
          const answer = await answerQuestion({
            question,
            providerConfig,
            resourceIds,
            resources: targetResources,
            summaries,
            spinner,
          });

          spinner?.stop();

          if (json) {
            console.log(
              JSON.stringify({
                answer: answer.answer,
                sources: answer.sources,
                resources_queried: targetResources.map((r) => r.name),
                resources_skipped: skipped,
              }),
            );
          } else {
            console.log(`\nAnswer:\n${answer.answer}`);
            if (answer.sources.length > 0) {
              console.log("\nSources:");
              for (const s of answer.sources) {
                const lines = s.lines ? ` (lines ${s.lines[0]}-${s.lines[1]})` : "";
                console.log(`  - ${s.resource}: ${s.path}${lines}`);
              }
            }
          }
        } catch (err) {
          spinner?.fail(`Provider error: ${err instanceof Error ? err.message : String(err)}`);
          if (!spinner) {
            console.error(
              `Provider error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          process.exit(3);
        }
      },
    );
}

async function answerQuestion(opts: {
  question: string;
  providerConfig: NonNullable<ReturnType<typeof getProvider>>;
  resourceIds: string[];
  resources: Resource[];
  summaries: Awaited<ReturnType<typeof getSummaries>>;
  spinner: Ora | null;
}) {
  const attempts = opts.providerConfig.name === "codex"
    ? [
      { profile: "fast" as const, retrieveOptions: FAST_CODEX_RETRIEVE_OPTIONS },
      { profile: "clean" as const, retrieveOptions: CLEAN_CODEX_RETRIEVE_OPTIONS },
    ]
    : [{ profile: "clean" as const, retrieveOptions: undefined }];

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    opts.spinner && (opts.spinner.text = index === 0 ? "Retrieving context..." : "Retrying with cleaner context...");
    const chunks = await retrieve(
      opts.question,
      opts.resourceIds,
      attempt.retrieveOptions,
    );

    opts.spinner && (opts.spinner.text = "Thinking...");

    try {
      return await generateAnswer(
        opts.resources,
        opts.summaries,
        chunks,
        opts.question,
        opts.providerConfig,
        { profile: attempt.profile },
      );
    } catch (err) {
      lastError = err;
      if (!(err instanceof RetryableProviderError) || index === attempts.length - 1) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}
