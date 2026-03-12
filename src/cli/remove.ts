import fs from "node:fs";
import readline from "node:readline";
import type { Command } from "commander";
import ora from "ora";
import { getResourceByName, removeResource } from "../core/registry.js";
import { deleteChunks, deleteSummaries } from "../indexing/store.js";
import { addExamples } from "./help.js";

export function registerRemove(program: Command): void {
  addExamples(
    program
    .command("remove <name>")
    .description("Remove a resource and delete its indexed data")
    .option("--keep-data", "Keep materialized snapshot on disk")
    .option("--force", "Skip confirmation prompt"),
    ["rex remove some-project", "rex remove some-project --force"],
  )
    .action(
      async (
        name: string,
        options: { keepData?: boolean; force?: boolean },
      ) => {
        const json = (program.opts() as { json?: boolean }).json;

        let resource;
        try {
          resource = getResourceByName(name);
        } catch {
          console.error(`Resource "${name}" not found.`);
          process.exit(1);
        }

        if (!options.force) {
          const confirmed = await confirm(
            `Remove resource "${name}"? This deletes ${resource.chunk_count} indexed chunks. [y/N] `,
          );
          if (!confirmed) {
            console.log("Aborted.");
            return;
          }
        }

        const spinner = json ? null : ora(`Removing ${name}...`).start();

        await deleteChunks(resource.id);
        await deleteSummaries(resource.id);
        removeResource(resource.id);

        let snapshotDeleted = false;
        if (!options.keepData) {
          snapshotDeleted = deleteSnapshot(resource);
        }

        if (json) {
          spinner?.stop();
          console.log(
            JSON.stringify({
              name,
              chunks_deleted: resource.chunk_count,
              snapshot_deleted: snapshotDeleted,
            }),
          );
        } else {
          spinner?.succeed(`Removed "${name}". Deleted ${resource.chunk_count} indexed chunks.`);
        }
      },
    );
}

function deleteSnapshot(resource: { snapshot_metadata: { type: string; clone_path?: string; extract_path?: string } }): boolean {
  let snapshotPath: string | undefined;
  if (resource.snapshot_metadata.type === "git") {
    snapshotPath = (resource.snapshot_metadata as { clone_path: string }).clone_path;
  } else if (resource.snapshot_metadata.type === "package") {
    snapshotPath = (resource.snapshot_metadata as { extract_path: string }).extract_path;
  }

  if (snapshotPath && fs.existsSync(snapshotPath)) {
    try {
      fs.rmSync(snapshotPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
