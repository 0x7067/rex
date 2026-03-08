import type { Command } from "commander";
import { getResourceByName, listResources } from "../core/registry.js";

export function registerResources(program: Command): void {
  program
    .command("resources")
    .description("List all saved resources with type, health, and sync status")
    .option("--name <name>", "Show details for a single resource")
    .action((options: { name?: string }) => {
      const json = (program.opts() as { json?: boolean }).json;

      try {
        if (options.name) {
          const resource = getResourceByName(options.name);
          if (json) {
            console.log(JSON.stringify(resource, null, 2));
          } else {
            printResourceDetail(resource);
          }
          return;
        }

        const resources = listResources();

        if (json) {
          console.log(JSON.stringify(resources, null, 2));
          return;
        }

        if (resources.length === 0) {
          console.log(
            "No resources added yet. Use `rex add <source>` to add one.",
          );
          return;
        }

        const header = pad("NAME", 16) + pad("TYPE", 9) + pad("SOURCE", 28) + pad("CHUNKS", 8) + pad("LAST SYNC", 22) + "STATUS";
        console.log(header);
        for (const r of resources) {
          const syncTime = r.last_sync_at
            ? new Date(r.last_sync_at).toLocaleString()
            : "never";
          const sourceDisplay = r.source.length > 26
            ? r.source.slice(0, 23) + "..."
            : r.source;
          console.log(
            pad(r.name, 16) +
            pad(r.type, 9) +
            pad(sourceDisplay, 28) +
            pad(String(r.chunk_count), 8) +
            pad(syncTime, 22) +
            r.last_sync_status,
          );
        }
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}

function pad(s: string, len: number): string {
  return s.slice(0, len).padEnd(len);
}

function printResourceDetail(resource: ReturnType<typeof getResourceByName>): void {
  console.log(`Name:        ${resource.name}`);
  console.log(`ID:          ${resource.id}`);
  console.log(`Type:        ${resource.type}`);
  console.log(`Source:      ${resource.source}`);
  console.log(`Normalized:  ${resource.normalized_source}`);
  console.log(`Notes:       ${resource.notes || "(none)"}`);
  console.log(`Chunks:      ${resource.chunk_count}`);
  console.log(`Last sync:   ${resource.last_sync_at ?? "never"}`);
  console.log(`Sync status: ${resource.last_sync_status}`);
}
