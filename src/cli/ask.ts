import type { Command } from "commander";
import ora, { type Ora } from "ora";
import { getProvider, listResources } from "../core/registry.js";
import { getSummaries } from "../indexing/store.js";
import { retrieve } from "../query/retriever.js";
import { generateAnswer } from "../query/answerer.js";
import type { Resource } from "../core/resource.js";
import { RetryableProviderError } from "../provider/interface.js";
import { resolveTargetResources } from "../query/resolve-target.js";
import { addExamples } from "./help.js";

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
  addExamples(
    program
    .command("ask")
    .description("Ask a grounded question against indexed resources")
    .argument("<question>", "The question to answer")
    .option("-r, --resource <name>", "Resource name to query (repeatable)", collect, []),
    [
      'rex ask "How does the sync pipeline work?"',
      'rex ask "How does the sync pipeline work?" -r some-project',
    ],
  )
    .action(
      async (question: string, options: { resource: string[] }) => {
        const json = (program.opts() as { json?: boolean }).json;

        const providerConfig = getProvider();
        if (!providerConfig) {
          console.error("No provider configured.");
          console.error("Next: rex connect claude");
          process.exit(1);
        }

        // Resolve resources
        const targetResources: Resource[] = [];
        const skipped: Array<{ name: string; reason: string }> = [];

        let resolved: Resource[];
        try {
          resolved = resolveTargetResources(process.cwd(), listResources(), options.resource);
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
          process.exit(2);
        }

        for (const r of resolved) {
          if (r.last_sync_status === "pending") {
            if (options.resource.length > 0) {
              console.warn(`Warning: resource "${r.name}" has never been synced.`);
            }
            skipped.push({ name: r.name, reason: "pending" });
          } else if (r.last_sync_status === "failed") {
            if (options.resource.length > 0) {
              console.warn(`Warning: resource "${r.name}" last sync failed.`);
            }
            skipped.push({ name: r.name, reason: "failed" });
          } else {
            targetResources.push(r);
          }
        }

        if (targetResources.length === 0) {
          const msg = "No indexed resources available.";
          if (json) {
            console.log(JSON.stringify({ error: `${msg} Run \`rex sync\` first.`, resources_skipped: skipped }));
          } else {
            console.error(msg);
            console.error("Next: rex sync");
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
            if (skipped.length > 0) {
              console.log("\nSkipped resources:");
              for (const resource of skipped) {
                console.log(`  - ${resource.name}: ${resource.reason}`);
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
