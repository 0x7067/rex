import type { Command } from "commander";
import ora from "ora";
import { isResourceAddLocked } from "../core/locks.js";
import { getProvider, listResources, getResourceByName } from "../core/registry.js";
import { syncResource } from "../core/sync.js";

export function registerSync(program: Command): void {
  program
    .command("sync [names...]")
    .description("Refresh one or more resources (defaults to all)")
    .option("--full", "Force full re-index")
    .action(async (names: string[], options: { full?: boolean }) => {
      const json = (program.opts() as { json?: boolean }).json;

      const providerConfig = getProvider();
      if (!providerConfig) {
        console.error("No provider configured. Run `rex connect` first.");
        process.exit(1);
      }

      let resources;
      if (names.length > 0) {
        resources = names.map((n) => {
          try {
            return getResourceByName(n);
          } catch {
            console.error(`Resource "${n}" not found.`);
            process.exit(2);
          }
        }).filter(Boolean);
      } else {
        resources = listResources();
        if (resources.length === 0) {
          console.error("No resources registered. Use `rex add <source>` first.");
          process.exit(2);
        }
      }

      const results = [];
      let anyFailed = false;

      for (const resource of resources) {
        if (isResourceAddLocked(resource.id)) {
          console.warn(`Skipping "${resource.name}": add is still running.`);
          continue;
        }

        const spinner = json ? null : ora(`Syncing ${resource.name}...`).start();

        const result = await syncResource(
          resource,
          providerConfig,
          options.full ?? false,
          (msg) => { spinner && (spinner.text = `${resource.name}: ${msg}`); },
        );
        results.push(result);
        if (result.status !== "ok") anyFailed = true;

        if (!json) {
          if (result.status !== "ok") {
            spinner?.fail(`${resource.name}: FAILED${result.error ? ` — ${result.error}` : ""}`);
          } else if (result.filesChanged === 0) {
            spinner?.succeed(`${resource.name}: no changes`);
          } else {
            spinner?.succeed(
              `${resource.name}: ${result.filesChanged} file(s) changed, ${result.chunksUpdated} chunks updated`,
            );
          }
        }
      }

      if (json) {
        console.log(JSON.stringify(results, null, 2));
      }

      if (anyFailed) process.exit(1);
    });
}
